use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware,
    response::{Html, IntoResponse, Redirect},
    routing::{delete, get, patch, post},
    Extension, Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use redis::AsyncCommands;
use sha1::{Digest, Sha1};
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{
        claims_match_current_token_version, require_auth, token_from_request, Claims,
    },
    models::{
        AuthResponse, ForgotPasswordRequest, LoginRequest, RegisterRequest, ResetPasswordRequest,
        User, UserPublic,
    },
    services::auth::{generate_token, hash_password, verify_password},
    services::rate_limit::enforce_rate_limit,
    ws::WsEvent,
    AppState,
};

/// Build Set-Cookie value for auth token (httpOnly, SameSite=Lax; Secure when configured).
fn auth_cookie_header(state: &AppState, token: &str) -> HeaderMap {
    let max_age = state.jwt_expiration.max(0) as usize;
    let mut cookie = format!(
        "{}={}; HttpOnly; Path=/; SameSite=Lax; Max-Age={}",
        state.cookie_name, token, max_age
    );
    if state.cookie_secure {
        cookie.push_str("; Secure");
    }
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        headers.insert(header::SET_COOKIE, v);
    }
    headers
}

const DESKTOP_OAUTH_ORIGIN: &str = "voxpery://auth";
const DESKTOP_OAUTH_CODE_TTL_SECS: u64 = 90;

/// Build Set-Cookie value to clear auth cookie.
fn clear_auth_cookie_header(state: &AppState) -> HeaderMap {
    let cookie = format!(
        "{}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
        state.cookie_name
    );
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        headers.insert(header::SET_COOKIE, v);
    }
    headers
}

fn is_desktop_oauth_origin(origin: &str) -> bool {
    origin.trim_end_matches('/') == DESKTOP_OAUTH_ORIGIN
}

fn normalize_oauth_origin(state: &AppState, origin: &str) -> String {
    let requested = origin.trim();
    if is_desktop_oauth_origin(requested) {
        return DESKTOP_OAUTH_ORIGIN.to_string();
    }
    if state
        .cors_origins
        .iter()
        .any(|allowed| allowed == requested)
    {
        return requested.to_string();
    }
    tracing::warn!(
        "Rejecting unapproved origin for Google OAuth: {}",
        requested
    );
    state
        .cors_origins
        .first()
        .cloned()
        .unwrap_or_else(|| "http://localhost:5173".to_string())
}

fn oauth_state_cookie_header(state: &AppState, nonce: &str) -> String {
    let mut cookie = format!("oauth_state={nonce}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax");
    if state.cookie_secure {
        cookie.push_str("; Secure");
    }
    cookie
}

fn clear_oauth_state_cookie_header(state: &AppState) -> String {
    let mut cookie = "oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax".to_string();
    if state.cookie_secure {
        cookie.push_str("; Secure");
    }
    cookie
}

fn append_query_param(path: &str, key: &str, value: &str) -> String {
    let (base, fragment) = match path.split_once('#') {
        Some((before, after)) => (before, Some(after)),
        None => (path, None),
    };
    let separator = if base.contains('?') { '&' } else { '?' };
    let mut out = format!(
        "{}{}{}={}",
        base,
        separator,
        key,
        urlencoding::encode(value)
    );
    if let Some(fragment) = fragment {
        out.push('#');
        out.push_str(fragment);
    }
    out
}

fn desktop_oauth_code_key(code: &str) -> String {
    format!("auth:oauth:desktop_code:{code}")
}

async fn issue_desktop_oauth_code(state: &Arc<AppState>, token: &str) -> Result<String, AppError> {
    let code = Uuid::new_v4().simple().to_string();
    let key = desktop_oauth_code_key(&code);
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Redis connection failed: {e}")))?;
    let _: () = conn
        .set_ex(&key, token, DESKTOP_OAUTH_CODE_TTL_SECS)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to store desktop OAuth code: {e}")))?;
    Ok(code)
}

async fn consume_desktop_oauth_code(
    state: &Arc<AppState>,
    code: &str,
) -> Result<Option<String>, AppError> {
    let key = desktop_oauth_code_key(code);
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Redis connection failed: {e}")))?;

    let token = match redis::cmd("GETDEL")
        .arg(&key)
        .query_async::<Option<String>>(&mut conn)
        .await
    {
        Ok(v) => v,
        Err(_) => {
            let fallback: Option<String> = conn
                .get(&key)
                .await
                .map_err(|e| AppError::Internal(format!("Redis get failed: {e}")))?;
            if fallback.is_some() {
                let _: i64 = conn
                    .del(&key)
                    .await
                    .map_err(|e| AppError::Internal(format!("Redis delete failed: {e}")))?;
            }
            fallback
        }
    };
    Ok(token)
}

fn visible_presence_from_preference(status: &str) -> &'static str {
    match status.to_ascii_lowercase().as_str() {
        "dnd" => "dnd",
        "invisible" | "offline" => "offline",
        _ => "online",
    }
}

fn extract_client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("cf-connecting-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .and_then(|raw| raw.split(',').next().map(str::trim))
        .and_then(|candidate| candidate.parse::<IpAddr>().ok())
        .map(|ip| ip.to_string())
}

fn login_failure_user_key(identifier: &str) -> String {
    format!("auth:login_fail:user:{identifier}")
}

fn login_failure_ip_key(ip: &str) -> String {
    format!("auth:login_fail:ip:{ip}")
}

async fn ensure_login_not_temporarily_locked(
    state: &Arc<AppState>,
    identifier: &str,
    client_ip: Option<&str>,
) -> Result<(), AppError> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Redis connection failed: {e}")))?;

    let user_key = login_failure_user_key(identifier);
    let user_failures: i64 = conn.get(&user_key).await.unwrap_or(0);
    if user_failures >= state.login_failure_max_attempts as i64 {
        return Err(AppError::TooManyRequests(
            "Too many login attempts. Please wait and try again.".into(),
        ));
    }

    if let Some(ip) = client_ip {
        let ip_key = login_failure_ip_key(ip);
        let ip_failures: i64 = conn.get(&ip_key).await.unwrap_or(0);
        if ip_failures >= state.login_failure_ip_max_attempts as i64 {
            return Err(AppError::TooManyRequests(
                "Too many login attempts. Please wait and try again.".into(),
            ));
        }
    }

    Ok(())
}

async fn record_login_failure(
    state: &Arc<AppState>,
    identifier: &str,
    client_ip: Option<&str>,
) -> Result<(), AppError> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Redis connection failed: {e}")))?;

    let user_key = login_failure_user_key(identifier);
    let user_failures: i64 = conn
        .incr(&user_key, 1)
        .await
        .map_err(|e| AppError::Internal(format!("Redis increment failed: {e}")))?;
    if user_failures == 1 {
        let _: bool = conn
            .expire(&user_key, state.login_failure_window_secs as i64)
            .await
            .map_err(|e| AppError::Internal(format!("Redis expire failed: {e}")))?;
    }

    if let Some(ip) = client_ip {
        let ip_key = login_failure_ip_key(ip);
        let ip_failures: i64 = conn
            .incr(&ip_key, 1)
            .await
            .map_err(|e| AppError::Internal(format!("Redis increment failed: {e}")))?;
        if ip_failures == 1 {
            let _: bool = conn
                .expire(&ip_key, state.login_failure_window_secs as i64)
                .await
                .map_err(|e| AppError::Internal(format!("Redis expire failed: {e}")))?;
        }
    }

    Ok(())
}

async fn clear_login_failures(
    state: &Arc<AppState>,
    identifier: &str,
    client_ip: Option<&str>,
) -> Result<(), AppError> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Redis connection failed: {e}")))?;

    let user_key = login_failure_user_key(identifier);
    let _: i64 = conn
        .del(&user_key)
        .await
        .map_err(|e| AppError::Internal(format!("Redis delete failed: {e}")))?;

    if let Some(ip) = client_ip {
        let ip_key = login_failure_ip_key(ip);
        let _: i64 = conn
            .del(&ip_key)
            .await
            .map_err(|e| AppError::Internal(format!("Redis delete failed: {e}")))?;
    }

    Ok(())
}

#[derive(Debug, serde::Deserialize)]
struct UpdateStatusRequest {
    status: String,
}

#[derive(Debug, serde::Deserialize)]
struct UpdateProfileRequest {
    avatar_url: Option<String>,
    clear_avatar: Option<bool>,
    dm_privacy: Option<String>,
    username: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ChangePasswordRequest {
    old_password: String,
    new_password: String,
}

#[derive(Debug, serde::Deserialize)]
struct SetPasswordRequest {
    new_password: String,
}

#[derive(Debug, serde::Deserialize)]
struct DeleteAccountRequest {
    confirm: String,
    password: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ExportAccountRow {
    id: Uuid,
    username: String,
    email: String,
    avatar_url: Option<String>,
    status: String,
    dm_privacy: String,
    created_at: chrono::DateTime<chrono::Utc>,
    google_connected: bool,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ExportMembershipRow {
    server_name: String,
    joined_at: chrono::DateTime<chrono::Utc>,
    role: String,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ExportFriendRow {
    username: String,
    avatar_url: Option<String>,
    status: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ExportFriendRequestRow {
    direction: String,
    other_username: String,
    status: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ExportServerMessageRow {
    channel_name: String,
    server_name: String,
    content: String,
    attachments: Option<serde_json::Value>,
    created_at: chrono::DateTime<chrono::Utc>,
    edited_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ExportDmMessageRow {
    peer_username: Option<String>,
    content: String,
    attachments: Option<serde_json::Value>,
    created_at: chrono::DateTime<chrono::Utc>,
    edited_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    let protected = Router::new()
        .route("/me", get(get_me))
        .route("/status", patch(update_status))
        .route("/profile", patch(update_profile))
        .route("/check-username", get(check_username))
        .route("/set-password", post(set_password))
        .route("/change-password", post(change_password))
        .route("/data-export", get(export_my_data))
        .route("/account", delete(delete_my_account))
        .route_layer(middleware::from_fn_with_state(state, require_auth));

    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/forgot-password", post(forgot_password))
        .route("/reset-password", post(reset_password))
        .route("/google", get(google_oauth_start))
        .route(
            "/google/desktop-exchange",
            post(google_oauth_desktop_exchange),
        )
        .route("/google/callback", get(google_oauth_callback))
        .merge(protected)
}

/// POST /api/auth/register
async fn register(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    let email = body.email.trim().to_lowercase();

    // 1) Email-based rate limit
    enforce_rate_limit(
        &state.redis,
        format!("auth:register:{}", email),
        state.auth_rate_limit_max,
        Duration::from_secs(state.auth_rate_limit_window_secs),
        "Too many register attempts for this email. Please wait and try again.",
    )
    .await?;

    // 2) IP-based rate limit (Flood protection)
    let client_ip = extract_client_ip(&headers);

    // Allow max 5 accounts per IP per hour as basic flood protection
    if let Some(ip) = client_ip.as_deref() {
        enforce_rate_limit(
            &state.redis,
            format!("auth:register_ip:{}", ip),
            5,
            Duration::from_secs(3600), // 1 hour
            "Too many accounts created from this IP address. Please try again later.",
        )
        .await?;
    }

    // 3) CAPTCHA validation (if configured)
    if let Some(secret_key) = &state.turnstile_secret_key {
        let token = body.captcha_token.as_deref().unwrap_or("");
        if token.is_empty() {
            return Err(AppError::Validation("CAPTCHA token is required".into()));
        }

        let client = reqwest::Client::new();
        let mut verify_form = vec![
            ("secret", secret_key.to_string()),
            ("response", token.to_string()),
        ];
        if let Some(ip) = client_ip.as_deref() {
            verify_form.push(("remoteip", ip.to_string()));
        }
        let res = client
            .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
            .form(&verify_form)
            .send()
            .await
            .map_err(|e| {
                tracing::warn!("Turnstile verify request failed: {}", e);
                AppError::Validation(
                    "CAPTCHA verification service is temporarily unavailable. Please try again."
                        .into(),
                )
            })?;

        #[derive(serde::Deserialize)]
        struct TurnstileResponse {
            success: bool,
            #[serde(default)]
            error_codes: Vec<String>,
        }

        let status = res.status();
        let raw = res.text().await.map_err(|e| {
            tracing::warn!("Turnstile verify response read failed: {}", e);
            AppError::Validation(
                "CAPTCHA verification service is temporarily unavailable. Please try again.".into(),
            )
        })?;

        if !status.is_success() {
            tracing::warn!("Turnstile verify non-success status: {}", status);
            return Err(AppError::Validation(
                "CAPTCHA verification service is temporarily unavailable. Please try again.".into(),
            ));
        }

        let verify_result = serde_json::from_str::<TurnstileResponse>(&raw).map_err(|e| {
            tracing::warn!("Turnstile verify JSON parse failed: {}", e);
            AppError::Validation(
                "CAPTCHA verification service is temporarily unavailable. Please try again.".into(),
            )
        })?;

        if !verify_result.success {
            tracing::warn!(
                "Turnstile verification failed for register request: {:?}",
                verify_result.error_codes
            );
            return Err(AppError::Validation(
                "CAPTCHA verification failed. Please retry the challenge.".into(),
            ));
        }
    }

    // Validate input
    let username = body.username.trim();
    if username.len() < 3 || username.len() > 32 {
        return Err(AppError::Validation(
            "Username must be 3-32 characters".into(),
        ));
    }
    if username.starts_with('_')
        || username.starts_with('.')
        || username.ends_with('_')
        || username.ends_with('.')
    {
        return Err(AppError::Validation(
            "Username cannot start or end with an underscore or period".into(),
        ));
    }
    if username.contains("__")
        || username.contains("..")
        || username.contains("_.")
        || username.contains("._")
    {
        return Err(AppError::Validation(
            "Username cannot contain consecutive underscores or periods".into(),
        ));
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
    {
        return Err(AppError::Validation(
            "Username may only contain lowercase letters, numbers, underscores, and periods".into(),
        ));
    }
    if email.len() > 255 {
        return Err(AppError::Validation(
            "Email must be at most 255 characters".into(),
        ));
    }
    if !email.contains('@') || email.find('@').map(|i| i > 0 && i < email.len() - 1) != Some(true) {
        return Err(AppError::Validation(
            "Email must be a valid format (e.g. user@domain)".into(),
        ));
    }
    if body.password.len() < 8 {
        return Err(AppError::Validation(
            "Password must be at least 8 characters".into(),
        ));
    }

    // Check if user already exists
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE email = $1 OR username = $2",
    )
    .bind(&email)
    .bind(&username)
    .fetch_one(&state.db)
    .await?;

    if existing > 0 {
        return Err(AppError::UserAlreadyExists);
    }

    // Hash password
    let password_hash = hash_password(&body.password)?;

    // Insert user (use validated trimmed values)
    let user = sqlx::query_as::<_, User>(
        r#"INSERT INTO users (id, username, email, password_hash, status, created_at)
           VALUES ($1, $2, $3, $4, 'online', NOW())
           RETURNING *"#,
    )
    .bind(Uuid::new_v4())
    .bind(&username)
    .bind(&email)
    .bind(&password_hash)
    .fetch_one(&state.db)
    .await?;

    // Auto-join default Voxpery server
    ensure_default_server_join(&state.db, user.id).await?;

    // Generate JWT
    let token = generate_token(
        user.id,
        &user.username,
        user.token_version,
        &state.jwt_secret,
        state.jwt_expiration,
    )?;

    let headers = auth_cookie_header(&state, &token);
    Ok((
        headers,
        Json(AuthResponse {
            token,
            user: UserPublic::from(user),
        }),
    ))
}

/// Default Voxpery server invite code.
/// Users auto-join this official community server on register/login.
const DEFAULT_SERVER_INVITE_CODE: &str = "voxpery";
// Keep in sync with routes/servers.rs seeding.
const PERM_VIEW_SERVER: i64 = 1 << 0;
const PERM_KICK_MEMBERS: i64 = 1 << 4;
const PERM_BAN_MEMBERS: i64 = 1 << 5;
const PERM_VIEW_AUDIT_LOG: i64 = 1 << 6;
const PERM_SEND_MESSAGES: i64 = 1 << 7;
const PERM_MANAGE_MESSAGES: i64 = 1 << 8;
const PERM_MANAGE_PINS: i64 = 1 << 9;
const PERM_CONNECT_VOICE: i64 = 1 << 10;
const PERM_MUTE_MEMBERS: i64 = 1 << 11;
const PERM_DEAFEN_MEMBERS: i64 = 1 << 12;

/// Env vars to resolve default Voxpery server owner: ADMIN_EMAIL or ADMIN_USERNAME (seeded admin).
fn official_owner_lookup() -> (Option<String>, Option<String>) {
    let email = std::env::var("ADMIN_EMAIL").ok().filter(|s| !s.is_empty());
    let username = std::env::var("ADMIN_USERNAME")
        .ok()
        .filter(|s| !s.is_empty());
    (email, username)
}

async fn resolve_official_owner_id(db: &sqlx::PgPool) -> Result<Option<Uuid>, AppError> {
    let (email, username) = official_owner_lookup();
    if let Some(owner_email) = email {
        let id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE email = $1")
            .bind(owner_email)
            .fetch_optional(db)
            .await?;
        if id.is_some() {
            return Ok(id);
        }
    }
    if let Some(owner_username) = username {
        let id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = $1")
            .bind(owner_username)
            .fetch_optional(db)
            .await?;
        if id.is_some() {
            return Ok(id);
        }
    }
    Ok(None)
}

/// Create the default admin user at startup if ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD are all set.
/// If a user with that email already exists, returns their id. Otherwise creates the user and returns the new id.
/// Used so the default Voxpery server has a dedicated owner instead of the first random registrant.
pub async fn ensure_seed_admin(
    db: &sqlx::PgPool,
    email: &str,
    username: &str,
    password: &str,
) -> Result<Option<Uuid>, AppError> {
    let username = username.trim();
    if username.len() < 3 || username.len() > 32 {
        tracing::error!(
            "Seed admin username must be 3-32 characters. Check your ADMIN_USERNAME env var."
        );
        return Err(AppError::Validation("Invalid seed admin username".into()));
    }
    if username.starts_with('_')
        || username.starts_with('.')
        || username.ends_with('_')
        || username.ends_with('.')
    {
        tracing::error!("Seed admin username cannot start or end with an underscore or period. Check your ADMIN_USERNAME env var.");
        return Err(AppError::Validation("Invalid seed admin username".into()));
    }
    if username.contains("__")
        || username.contains("..")
        || username.contains("_.")
        || username.contains("._")
    {
        tracing::error!("Seed admin username cannot contain consecutive underscores or periods. Check your ADMIN_USERNAME env var.");
        return Err(AppError::Validation("Invalid seed admin username".into()));
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
    {
        tracing::error!("Seed admin username may only contain lowercase letters, numbers, underscores, and periods. Check your ADMIN_USERNAME env var.");
        return Err(AppError::Validation("Invalid seed admin username".into()));
    }
    if password.len() < 8 {
        tracing::warn!("Seed admin password must be at least 8 characters; skipping seed");
        return Ok(None);
    }
    let existing_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE email = $1")
        .bind(email)
        .fetch_optional(db)
        .await?;
    if let Some(id) = existing_id {
        tracing::info!("Seed admin user already exists (email), skipping create");
        return Ok(Some(id));
    }
    let password_hash = hash_password(password)?;
    let id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO users (id, username, email, password_hash, status, created_at)
           VALUES ($1, $2, $3, $4, 'invisible', NOW())"#,
    )
    .bind(id)
    .bind(&username)
    .bind(email)
    .bind(&password_hash)
    .execute(db)
    .await?;
    tracing::info!("Seed admin user created: {} ({})", username, email);
    Ok(Some(id))
}

/// Ensure the official Voxpery community server exists and add the user to it.
/// Called on register/login for every user, and at startup with the seeded admin id to create the server.
pub async fn ensure_default_server_join(db: &sqlx::PgPool, user_id: Uuid) -> Result<(), AppError> {
    let mut server_id_opt: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM servers WHERE invite_code = $1")
            .bind(DEFAULT_SERVER_INVITE_CODE)
            .fetch_optional(db)
            .await?;

    // Auto-create default Voxpery server when missing: use official owner if configured, else current user (CI/dev).
    if server_id_opt.is_none() {
        let owner_id = resolve_official_owner_id(db).await?.unwrap_or(user_id);
        let server_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO servers (id, name, icon_url, owner_id, invite_code, created_at)
               VALUES ($1, $2, NULL, $3, $4, NOW())"#,
        )
        .bind(server_id)
        .bind("Voxpery")
        .bind(owner_id)
        .bind(DEFAULT_SERVER_INVITE_CODE)
        .execute(db)
        .await?;

        sqlx::query(
            "INSERT INTO server_members (server_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', NOW())",
        )
        .bind(server_id)
        .bind(owner_id)
        .execute(db)
        .await?;

        sqlx::query(
            r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
               VALUES ($1, $2, 'general', 'text', 'General', 0, NOW())"#,
        )
        .bind(Uuid::new_v4())
        .bind(server_id)
        .execute(db)
        .await?;

        sqlx::query(
            r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
               VALUES ($1, $2, 'General', 'voice', 'General', 1, NOW())"#,
        )
        .bind(Uuid::new_v4())
        .bind(server_id)
        .execute(db)
        .await?;

        sqlx::query(
            r#"INSERT INTO server_channel_categories (server_id, name, position)
               VALUES ($1, 'General', 0)
               ON CONFLICT (server_id, name) DO NOTHING"#,
        )
        .bind(server_id)
        .execute(db)
        .await?;

        server_id_opt = Some(server_id);
    }

    if let Some(server_id) = server_id_opt {
        // Ensure default Voxpery server has the seeded Moderator role.
        // This also backfills older default servers that were created without it.
        let moderator_perms = PERM_MANAGE_MESSAGES
            | PERM_MANAGE_PINS
            | PERM_KICK_MEMBERS
            | PERM_BAN_MEMBERS
            | PERM_MUTE_MEMBERS
            | PERM_DEAFEN_MEMBERS
            | PERM_VIEW_AUDIT_LOG;
        sqlx::query(
            r#"INSERT INTO server_roles (id, server_id, name, color, position, permissions)
                   VALUES ($1, $2, 'Moderator', '#5865F2', 0, $3)
                   ON CONFLICT (server_id, LOWER(name))
                   DO UPDATE SET permissions = (server_roles.permissions | EXCLUDED.permissions)"#,
        )
        .bind(Uuid::new_v4())
        .bind(server_id)
        .bind(moderator_perms)
        .execute(db)
        .await?;

        // Ensure default Voxpery server has an "@everyone" baseline role.
        // Baseline member access: can view server, send messages, and connect voice.
        let everyone_perms = PERM_VIEW_SERVER | PERM_SEND_MESSAGES | PERM_CONNECT_VOICE;
        sqlx::query(
            r#"INSERT INTO server_roles (id, server_id, name, color, position, permissions)
                   VALUES ($1, $2, 'Everyone', NULL, 9999, $3)
                   ON CONFLICT (server_id, LOWER(name)) DO NOTHING"#,
        )
        .bind(Uuid::new_v4())
        .bind(server_id)
        .bind(everyone_perms)
        .execute(db)
        .await?;

        let already = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_one(db)
        .await?;
        let is_banned = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM server_bans WHERE server_id = $1 AND user_id = $2",
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_one(db)
        .await?;
        if already == 0 && is_banned == 0 {
            sqlx::query(
                    "INSERT INTO server_members (server_id, user_id, role, joined_at) VALUES ($1, $2, 'member', NOW())",
                )
                .bind(server_id)
                .bind(user_id)
                .execute(db)
                .await?;
        }

        // "@everyone" is implicit in permission resolution; no explicit member assignment needed.
    }
    Ok(())
}

/// POST /api/auth/login
async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    let identifier = body.identifier.trim().to_lowercase();
    let client_ip = extract_client_ip(&headers);

    enforce_rate_limit(
        &state.redis,
        format!("auth:login:{identifier}"),
        state.auth_rate_limit_max,
        Duration::from_secs(state.auth_rate_limit_window_secs),
        "Too many login attempts. Please wait and try again.",
    )
    .await?;

    if let Some(ip) = client_ip.as_deref() {
        enforce_rate_limit(
            &state.redis,
            format!("auth:login_ip:{ip}"),
            state.login_failure_ip_max_attempts,
            Duration::from_secs(state.login_failure_window_secs),
            "Too many login attempts. Please wait and try again.",
        )
        .await?;
    }

    ensure_login_not_temporarily_locked(&state, &identifier, client_ip.as_deref()).await?;

    // Find user by email or username (case-insensitive)
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)",
    )
    .bind(&identifier)
    .fetch_optional(&state.db)
    .await?;

    let Some(user) = user else {
        record_login_failure(&state, &identifier, client_ip.as_deref()).await?;
        return Err(AppError::InvalidCredentials);
    };

    // OAuth-only accounts do not have a local password yet.
    if user.password_hash == "oauth" {
        record_login_failure(&state, &identifier, client_ip.as_deref()).await?;
        return Err(AppError::InvalidCredentials);
    }

    // Verify password
    if !verify_password(&body.password, &user.password_hash)? {
        record_login_failure(&state, &identifier, client_ip.as_deref()).await?;
        return Err(AppError::InvalidCredentials);
    }

    clear_login_failures(&state, &identifier, client_ip.as_deref()).await?;

    // Ensure user is in official Voxpery community on login as well
    ensure_default_server_join(&state.db, user.id).await?;

    // Generate JWT
    let token = generate_token(
        user.id,
        &user.username,
        user.token_version,
        &state.jwt_secret,
        state.jwt_expiration,
    )?;

    let headers = auth_cookie_header(&state, &token);
    let user_public = UserPublic::from(user);
    Ok((
        headers,
        Json(AuthResponse {
            token,
            user: user_public,
        }),
    ))
}

/// POST /api/auth/set-password
/// Allows Google-only users to add a local password for the first time.
async fn set_password(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SetPasswordRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:set_password:{}", claims.sub),
        5,
        Duration::from_secs(60 * 60),
        "Too many password set attempts. Please wait.",
    )
    .await?;

    if body.new_password.len() < 8 {
        return Err(AppError::Validation(
            "New password must be at least 8 characters".into(),
        ));
    }

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    if user.google_id.is_none() {
        return Err(AppError::Validation(
            "This account is not connected to Google Sign-In.".into(),
        ));
    }
    if user.password_hash != "oauth" {
        return Err(AppError::Validation(
            "Password is already set. Use change password.".into(),
        ));
    }

    let password_hash = hash_password(&body.new_password)?;
    sqlx::query(
        "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
    )
    .bind(&password_hash)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    let updated = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;

    let token = generate_token(
        updated.id,
        &updated.username,
        updated.token_version,
        &state.jwt_secret,
        state.jwt_expiration,
    )?;
    let headers = auth_cookie_header(&state, &token);

    Ok((
        headers,
        Json(AuthResponse {
            token,
            user: UserPublic::from(updated),
        }),
    ))
}

/// POST /api/auth/logout — clears auth cookie (web) and revokes current token when provided.
/// No auth required; idempotent.
async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Some(token) = token_from_request(&headers, &state.cookie_name) {
        if let Ok(data) = jsonwebtoken::decode::<Claims>(
            &token,
            &jsonwebtoken::DecodingKey::from_secret(state.jwt_secret.as_bytes()),
            &jsonwebtoken::Validation::default(),
        ) {
            let _ = crate::services::jwt_blacklist::blacklist_until_exp(
                &state.redis,
                &token,
                data.claims.exp,
            )
            .await;
        }
    }

    let headers = clear_auth_cookie_header(&state);
    (StatusCode::OK, headers, Json(serde_json::json!({})))
}

/// Query for GET /api/auth/google
#[derive(Debug, serde::Deserialize)]
struct GoogleOAuthStartQuery {
    /// Frontend path to redirect after login (e.g. /app/friends)
    redirect: Option<String>,
    /// Frontend origin (e.g. http://localhost:5173) for redirect after callback
    origin: Option<String>,
}

/// GET /api/auth/google — redirect to Google OAuth. Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_API_URL.
async fn google_oauth_start(
    State(state): State<Arc<AppState>>,
    Query(q): Query<GoogleOAuthStartQuery>,
) -> impl IntoResponse {
    let (client_id, _secret) = match (
        state.google_client_id.as_ref(),
        state.google_client_secret.as_ref(),
    ) {
        (Some(id), Some(sec)) if !id.is_empty() && !sec.is_empty() => (id.as_str(), sec.as_str()),
        _ => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "Google sign-in is not configured" })),
            )
                .into_response()
        }
    };
    let public_url = state
        .public_api_url
        .as_deref()
        .unwrap_or("http://localhost:3001")
        .trim_end_matches('/');
    let redirect_uri = format!("{}/api/auth/google/callback", public_url);
    let redirect_path = q.redirect.as_deref().unwrap_or("/").trim();
    let redirect_path = if redirect_path.starts_with('/') {
        redirect_path
    } else {
        "/"
    };
    let origin = q
        .origin
        .as_deref()
        .unwrap_or("http://localhost:5173")
        .trim()
        .to_string();
    let origin = normalize_oauth_origin(&state, &origin);

    let nonce = Uuid::new_v4().to_string();
    let state_param = BASE64.encode(format!("{}\n{}\n{}", nonce, origin, redirect_path));
    let scope = "openid email profile";
    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&access_type=offline&prompt=consent",
        urlencoding::encode(client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scope),
        urlencoding::encode(&state_param),
    );

    let cookie = oauth_state_cookie_header(&state, &nonce);
    let mut response = Redirect::temporary(&url).into_response();
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, v);
    }
    response
}

/// Query for GET /api/auth/google/callback
#[derive(Debug, serde::Deserialize)]
struct GoogleOAuthCallbackQuery {
    code: String,
    state: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct GoogleOAuthDesktopExchangeRequest {
    code: String,
}

/// POST /api/auth/google/desktop-exchange — exchange short-lived desktop OAuth code for JWT.
async fn google_oauth_desktop_exchange(
    State(state): State<Arc<AppState>>,
    Json(body): Json<GoogleOAuthDesktopExchangeRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let code = body.code.trim();
    if code.len() != 32 || !code.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::Validation("Invalid desktop OAuth code".into()));
    }

    let token = consume_desktop_oauth_code(&state, code)
        .await?
        .ok_or(AppError::Unauthorized)?;

    match crate::services::jwt_blacklist::is_blacklisted(&state.redis, &token).await {
        Ok(true) => return Err(AppError::Unauthorized),
        Ok(false) => {}
        Err(e) => {
            tracing::warn!("Redis JWT blacklist check failed: {}", e);
            return Err(AppError::Unauthorized);
        }
    }

    let claims = jsonwebtoken::decode::<Claims>(
        &token,
        &jsonwebtoken::DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &jsonwebtoken::Validation::default(),
    )
    .map_err(|_| AppError::Unauthorized)?
    .claims;

    let version_ok = claims_match_current_token_version(&state.db, claims.sub, claims.ver)
        .await
        .map_err(|_| AppError::Unauthorized)?;
    if !version_ok {
        return Err(AppError::Unauthorized);
    }

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::Unauthorized)?;

    Ok(Json(AuthResponse {
        token,
        user: UserPublic::from(user),
    }))
}

#[derive(Debug, serde::Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
}

#[derive(Debug, serde::Deserialize)]
struct GoogleUserInfo {
    id: String,
    email: Option<String>,
    verified_email: Option<bool>,
    name: Option<String>,
    #[serde(rename = "given_name")]
    given_name: Option<String>,
}

/// GET /api/auth/google/callback — exchange code for token, get user, create or login, set cookie, redirect to frontend.
async fn google_oauth_callback(
    State(state): State<Arc<AppState>>,
    Query(q): Query<GoogleOAuthCallbackQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let (client_id, client_secret) = match (
        state.google_client_id.as_ref(),
        state.google_client_secret.as_ref(),
    ) {
        (Some(id), Some(sec)) if !id.is_empty() && !sec.is_empty() => (id.clone(), sec.clone()),
        _ => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "Google sign-in is not configured" })),
            )
                .into_response()
        }
    };
    let public_url = state
        .public_api_url
        .as_deref()
        .unwrap_or("http://localhost:3001")
        .trim_end_matches('/');
    let redirect_uri = format!("{}/api/auth/google/callback", public_url);

    let decoded_state = q
        .state
        .as_ref()
        .and_then(|s| BASE64.decode(s.as_bytes()).ok());
    let state_string = decoded_state.and_then(|b| String::from_utf8(b).ok());

    let (nonce, origin, redirect_path) = match state_string {
        Some(ref s) => {
            let mut parts = s.splitn(3, '\n');
            let n = parts.next().unwrap_or("").trim().to_string();
            let o = parts.next().unwrap_or("").trim().to_string();
            let r = parts.next().unwrap_or("").trim().to_string();
            if n.is_empty() || o.is_empty() || !r.starts_with('/') {
                tracing::warn!(
                    "OAuth state parsing failed. Parts: n='{}', o='{}', r='{}'",
                    n,
                    o,
                    r
                );
                (
                    "".to_string(),
                    "http://localhost:5173".to_string(),
                    "/app/friends".to_string(),
                )
            } else {
                (n, o, r)
            }
        }
        None => {
            tracing::warn!("OAuth state was None or decoding failed.");
            (
                "".to_string(),
                "http://localhost:5173".to_string(),
                "/app/friends".to_string(),
            )
        }
    };
    let origin = normalize_oauth_origin(&state, &origin);

    let mut is_csrf_valid = false;
    let mut found_oauth_state = None;
    if let Some(cookie_header) = headers.get(header::COOKIE) {
        if let Ok(cookie_str) = cookie_header.to_str() {
            for part in cookie_str.split(';') {
                let part = part.trim();
                let prefix = "oauth_state=";
                if let Some(cookie_val) = part.strip_prefix(prefix) {
                    found_oauth_state = Some(cookie_val.to_string());
                    if !nonce.is_empty() && nonce == cookie_val {
                        is_csrf_valid = true;
                    }
                    break;
                }
            }
        }
    }

    if !is_csrf_valid {
        tracing::warn!(
            "OAuth CSRF check failed. Expected Nonce: '{}', Found Cookie: '{:?}'",
            nonce,
            found_oauth_state
        );
        let redirect_error = format!("{}?error=oauth_failed_csrf", redirect_path);
        let clear_cookie = clear_oauth_state_cookie_header(&state);
        let mut response =
            Redirect::temporary(&format!("{}{}", origin, redirect_error)).into_response();
        if let Ok(v) = HeaderValue::from_str(&clear_cookie) {
            response.headers_mut().insert(header::SET_COOKIE, v);
        }
        return response;
    }

    let token_url = "https://oauth2.googleapis.com/token";
    let body = [
        ("code", q.code.as_str()),
        ("client_id", &client_id),
        ("client_secret", &client_secret),
        ("redirect_uri", &redirect_uri),
        ("grant_type", "authorization_code"),
    ];
    let client = reqwest::Client::new();
    let token_res = match client.post(token_url).form(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Google token exchange failed: {}", e);
            let redirect_error = format!("{}?error=oauth_failed", redirect_path);
            return Redirect::temporary(&format!("{}{}", origin, redirect_error)).into_response();
        }
    };
    if !token_res.status().is_success() {
        let status = token_res.status();
        let _body = token_res.text().await;
        tracing::warn!("Google token response error: {} body={:?}", status, _body);
        let redirect_error = format!("{}?error=oauth_failed", redirect_path);
        return Redirect::temporary(&format!("{}{}", origin, redirect_error)).into_response();
    }
    let token_data: GoogleTokenResponse = match token_res.json().await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("Google token parse failed: {}", e);
            let redirect_error = format!("{}?error=oauth_failed", redirect_path);
            return Redirect::temporary(&format!("{}{}", origin, redirect_error)).into_response();
        }
    };

    let userinfo_res = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&token_data.access_token)
        .send()
        .await;
    let userinfo: GoogleUserInfo = match userinfo_res {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(u) => u,
            Err(e) => {
                tracing::warn!("Google userinfo parse failed: {}", e);
                let redirect_error = format!("{}?error=oauth_failed", redirect_path);
                return Redirect::temporary(&format!("{}{}", origin, redirect_error))
                    .into_response();
            }
        },
        _ => {
            tracing::warn!("Google userinfo request failed");
            let redirect_error = format!("{}?error=oauth_failed", redirect_path);
            return Redirect::temporary(&format!("{}{}", origin, redirect_error)).into_response();
        }
    };

    let google_id = userinfo.id;
    let email = userinfo
        .email
        .filter(|e| e.contains('@'))
        .unwrap_or_else(|| format!("{}@oauth.local", google_id));
    let email = email.trim().to_lowercase();

    if let Some(false) = userinfo.verified_email {
        tracing::warn!("Google OAuth login rejected: unverified email ({})", email);
        let redirect_error = format!("{}?error=oauth_unverified_email", redirect_path);
        return Redirect::temporary(&format!("{}{}", origin, redirect_error)).into_response();
    }

    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE google_id = $1 OR (google_id IS NULL AND lower(email) = $2)",
    )
    .bind(&google_id)
    .bind(&email)
    .fetch_optional(&state.db)
    .await;

    let user = match user {
        Ok(Some(mut u)) => {
            if u.google_id.is_none() {
                let _ = sqlx::query("UPDATE users SET google_id = $1 WHERE id = $2")
                    .bind(&google_id)
                    .bind(u.id)
                    .execute(&state.db)
                    .await;
                u.google_id = Some(google_id.clone());
            }
            u
        }
        Ok(None) => {
            // New user: create account
            let name = userinfo
                .name
                .or(userinfo.given_name)
                .unwrap_or_else(|| email.split('@').next().unwrap_or("user").to_string())
                .to_lowercase();
            let base_username = name
                .chars()
                .map(|c| {
                    if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect::<String>();
            let base_username = base_username.trim_matches('_');
            let base_username: String = if base_username.len() >= 3 {
                base_username.chars().take(32).collect()
            } else {
                email.split('@').next().unwrap_or("user").to_string()
            };
            let mut username = base_username.clone();
            let mut n = 0u32;
            while sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE username = $1")
                .bind(&username)
                .fetch_one(&state.db)
                .await
                .unwrap_or(1)
                != 0
            {
                n += 1;
                username = format!("{}{}", base_username, n);
                username = username.chars().take(32).collect();
            }
            let password_hash = "oauth"; // not a valid Argon2 hash; OAuth-only users cannot password-login
            let id = Uuid::new_v4();
            if let Err(e) = sqlx::query(
                r#"INSERT INTO users (id, username, email, password_hash, status, dm_privacy, google_id, created_at)
               VALUES ($1, $2, $3, $4, 'online', 'friends', $5, NOW())"#,
            )
            .bind(id)
            .bind(&username)
            .bind(&email)
            .bind(password_hash)
            .bind(&google_id)
            .execute(&state.db)
            .await
            {
                tracing::warn!("Google OAuth insert user failed: {}", e);
                let redirect_error = format!("{}?error=oauth_failed", redirect_path);
                return Redirect::temporary(&format!("{}{}", origin, redirect_error)).into_response();
            }
            let user = match sqlx::query_as::<_, User>("SELECT * FROM users WHERE google_id = $1")
                .bind(&google_id)
                .fetch_one(&state.db)
                .await
            {
                Ok(u) => u,
                Err(_) => {
                    let redirect_error = format!("{}?error=oauth_failed", redirect_path);
                    return Redirect::temporary(&format!("{}{}", origin, redirect_error))
                        .into_response();
                }
            };
            if let Err(e) = ensure_default_server_join(&state.db, user.id).await {
                tracing::warn!("Default server join failed for OAuth user: {}", e);
            }
            user
        }
        Err(e) => {
            tracing::warn!("Google OAuth db lookup failed: {}", e);
            let redirect_error = format!("{}?error=oauth_failed", redirect_path);
            return Redirect::temporary(&format!("{}{}", origin, redirect_error)).into_response();
        }
    };

    let token = match generate_token(
        user.id,
        &user.username,
        user.token_version,
        &state.jwt_secret,
        state.jwt_expiration,
    ) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("JWT generate failed: {}", e);
            let redirect_error = format!("{}?error=oauth_failed", redirect_path);
            return Redirect::temporary(&format!("{}{}", origin, redirect_error)).into_response();
        }
    };

    let cookie_headers = auth_cookie_header(&state, &token);
    let is_desktop = is_desktop_oauth_origin(&origin);
    let redirect_url = if is_desktop {
        let exchange_code = match issue_desktop_oauth_code(&state, &token).await {
            Ok(code) => code,
            Err(e) => {
                tracing::warn!("Failed to issue desktop OAuth code: {}", e);
                let redirect_error = format!("{}?error=oauth_failed", redirect_path);
                return Redirect::temporary(&format!("{}{}", origin, redirect_error))
                    .into_response();
            }
        };
        let path_with_code = append_query_param(&redirect_path, "code", &exchange_code);
        format!("{}{}", DESKTOP_OAUTH_ORIGIN, path_with_code)
    } else {
        format!("{}{}", origin, redirect_path)
    };

    let mut response = if is_desktop {
        // Desktop UX: Return a nice HTML page that triggers the deep link and tells user to close tab.
        let html = format!(
            r#"<!DOCTYPE html>
    <html>
    <head>
    <title>Authenticating...</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #1e1e2e; color: #cdd6f4; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }}
        .card {{ background: #313244; padding: 2rem; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); max-width: 400px; }}
        h1 {{ color: #89b4fa; margin-bottom: 1rem; }}
        p {{ line-height: 1.5; color: #a6adc8; }}
        .btn {{ display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.5rem; background: #89b4fa; color: #1e1e2e; text-decoration: none; border-radius: 6px; font-weight: bold; transition: opacity 0.2s; }}
        .btn:hover {{ opacity: 0.9; }}
    </style>
    </head>
    <body>
    <div class="card">
        <h1>Login Successful!</h1>
        <p>You are being redirected to the Voxpery desktop app.</p>
        <p>If the app doesn't open, you can click the button below or safely close this tab.</p>
        <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 1.5rem;">
            <a href="{}" class="btn" style="margin-top: 0;">Back to App</a>
        </div>
    </div>
    <script>
        // Try to redirect automatically
        window.location.href = "{}";
        // Close window after a delay (often blocked by browsers but worth a try)
        setTimeout(() => {{
            // Some browsers allow closing if opened via script, though OAuth is usually not the case.
            // window.close();
        }}, 3000);
    </script>
    </body>
    </html>"#,
            redirect_url, redirect_url
        );
        Html(html).into_response()
    } else {
        Redirect::temporary(&redirect_url).into_response()
    };

    let clear_oauth_state = clear_oauth_state_cookie_header(&state);
    if let Ok(v) = HeaderValue::from_str(&clear_oauth_state) {
        response.headers_mut().insert(header::SET_COOKIE, v);
    }

    for (k, v) in cookie_headers.iter() {
        if let Ok(v) = v.to_str() {
            response.headers_mut().insert(
                k.clone(),
                HeaderValue::from_str(v).unwrap_or(HeaderValue::from_static("")),
            );
        }
    }
    response
}
/// GET /api/auth/me — current user from token (for desktop secure-storage restore).
async fn get_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserPublic>, AppError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;
    Ok(Json(UserPublic::from(user)))
}

#[derive(Debug, serde::Deserialize)]
struct CheckUsernameQuery {
    username: Option<String>,
}

/// GET /api/auth/check-username?username=xxx — returns { "available": bool } (true if no other user has that username).
/// Rate limited to prevent user enumeration (brute-force discovery of registered usernames).
async fn check_username(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<CheckUsernameQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:check_username:{}", claims.sub),
        10,
        Duration::from_secs(60),
        "Too many username checks. Please wait a moment.",
    )
    .await?;
    let username = q
        .username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("Missing username query".into()))?;
    if username.len() < 3 || username.len() > 32 {
        return Ok(Json(serde_json::json!({ "available": false })));
    }
    if username.starts_with('_')
        || username.starts_with('.')
        || username.ends_with('_')
        || username.ends_with('.')
    {
        return Ok(Json(serde_json::json!({ "available": false })));
    }
    if username.contains("__")
        || username.contains("..")
        || username.contains("_.")
        || username.contains("._")
    {
        return Ok(Json(serde_json::json!({ "available": false })));
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
    {
        return Ok(Json(serde_json::json!({ "available": false })));
    }
    let taken = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE lower(username) = lower($1) AND id <> $2",
    )
    .bind(username)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "available": taken == 0 })))
}

/// PATCH /api/auth/status
async fn update_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateStatusRequest>,
) -> Result<Json<UserPublic>, AppError> {
    let input = body.status.trim().to_lowercase();
    let status = match input.as_str() {
        "online" => "online",
        "dnd" => "dnd",
        "invisible" | "offline" => "invisible", // backward-compatible old client value
        _ => {
            return Err(AppError::Validation(
                "Status must be one of: online, dnd, invisible".into(),
            ))
        }
    };
    if !matches!(status, "online" | "dnd" | "invisible") {
        return Err(AppError::Validation(
            "Status must be one of: online, dnd, invisible".into(),
        ));
    }

    let user = sqlx::query_as::<_, User>(
        r#"UPDATE users
           SET status = $1
           WHERE id = $2
           RETURNING *"#,
    )
    .bind(status)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    let visible_presence = visible_presence_from_preference(status).to_string();
    let _ = state.tx.send(WsEvent::PresenceUpdate {
        user_id: claims.sub,
        status: visible_presence,
    });

    Ok(Json(UserPublic::from(user)))
}

/// PATCH /api/auth/profile
async fn update_profile(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<Json<UserPublic>, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:profile:{}", claims.sub),
        12,
        Duration::from_secs(60),
        "Too many profile update attempts. Please wait and try again.",
    )
    .await?;

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    let mut next_avatar = user.avatar_url.clone();
    let mut next_dm_privacy = user.dm_privacy.clone();
    let mut next_username = user.username.clone();

    if let Some(raw_username) = body.username {
        let username = raw_username.trim();
        if username != user.username {
            // Enforce at most one username change per 30 days
            if let Some(changed_at) = user.username_changed_at {
                let since = chrono::Utc::now().signed_duration_since(changed_at);
                if since.num_days() < 30 {
                    return Err(AppError::Validation(
                        "You can only change your username once every 30 days. Please try again later.".into(),
                    ));
                }
            }
            if username.len() < 3 || username.len() > 32 {
                return Err(AppError::Validation(
                    "Username must be 3–32 characters".into(),
                ));
            }
            if username.starts_with('_')
                || username.starts_with('.')
                || username.ends_with('_')
                || username.ends_with('.')
            {
                return Err(AppError::Validation(
                    "Username cannot start or end with an underscore or period".into(),
                ));
            }
            if username.contains("__")
                || username.contains("..")
                || username.contains("_.")
                || username.contains("._")
            {
                return Err(AppError::Validation(
                    "Username cannot contain consecutive underscores or periods".into(),
                ));
            }
            if !username
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
            {
                return Err(AppError::Validation(
                    "Username may only contain lowercase letters, numbers, underscores, and periods".into(),
                ));
            }
            let taken = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM users WHERE lower(username) = lower($1) AND id <> $2",
            )
            .bind(&username)
            .bind(claims.sub)
            .fetch_one(&state.db)
            .await?;
            if taken > 0 {
                return Err(AppError::Validation(
                    "That username is already taken".into(),
                ));
            }
            next_username = username.to_string();
        }
    }

    if body.clear_avatar.unwrap_or(false) {
        next_avatar = None;
    } else if let Some(url) = body.avatar_url {
        let trimmed = url.trim().to_string();
        if trimmed.is_empty() {
            return Err(AppError::Validation("Avatar URL cannot be empty".into()));
        }
        if trimmed.len() > 3_000_000 {
            return Err(AppError::Validation("Avatar image is too large".into()));
        }
        let valid_scheme = trimmed.starts_with("data:image/")
            || trimmed.starts_with("http://")
            || trimmed.starts_with("https://");
        if !valid_scheme {
            return Err(AppError::Validation(
                "Avatar must be an image URL or data URL".into(),
            ));
        }
        if trimmed.to_lowercase().starts_with("data:image/svg+xml") {
            return Err(AppError::Validation(
                "SVG images are not allowed for avatars (security)".into(),
            ));
        }
        next_avatar = Some(trimmed);
    }

    if let Some(dm_privacy) = body.dm_privacy {
        let value = dm_privacy.trim().to_lowercase();
        if !matches!(value.as_str(), "everyone" | "friends") {
            return Err(AppError::Validation(
                "DM privacy must be one of: everyone, friends".into(),
            ));
        }
        next_dm_privacy = value;
    }

    let username_changed = next_username != user.username;
    let updated = sqlx::query_as::<_, User>(
        r#"UPDATE users
            SET avatar_url = $1, dm_privacy = $2, username = $3,
                username_changed_at = CASE WHEN $5 THEN NOW() ELSE username_changed_at END
            WHERE id = $4
           RETURNING *"#,
    )
    .bind(next_avatar)
    .bind(next_dm_privacy)
    .bind(&next_username)
    .bind(claims.sub)
    .bind(username_changed)
    .fetch_one(&state.db)
    .await?;

    let public_user = UserPublic::from(updated);
    let _ = state.tx.send(WsEvent::UserUpdated {
        user: public_user.clone(),
    });

    Ok(Json(public_user))
}

/// POST /api/auth/change-password
async fn change_password(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<(HeaderMap, Json<serde_json::Value>), AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:change_password:{}", claims.sub),
        5,
        Duration::from_secs(60 * 60), // max 5 attempts per hour
        "Too many password change attempts. Please wait.",
    )
    .await?;

    if body.new_password.len() < 8 {
        return Err(AppError::Validation(
            "New password must be at least 8 characters".into(),
        ));
    }

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    if !verify_password(&body.old_password, &user.password_hash)? {
        return Err(AppError::InvalidCredentials);
    }

    let password_hash = hash_password(&body.new_password)?;

    sqlx::query(
        "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
    )
    .bind(&password_hash)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    // Invalidate the current token if it can be extracted
    if let Some(token) = crate::middleware::auth::token_from_request(&headers, &state.cookie_name) {
        crate::services::jwt_blacklist::blacklist_until_exp(&state.redis, &token, claims.exp)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to revoke JWT token: {e}")))?;
    }

    let out_headers = clear_auth_cookie_header(&state);
    Ok((
        out_headers,
        Json(serde_json::json!({ "message": "Password changed successfully" })),
    ))
}

async fn ensure_deleted_placeholder_user(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Uuid, AppError> {
    let existing = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE email = $1")
        .bind("deleted@system.local")
        .fetch_optional(&mut **tx)
        .await?;
    if let Some(id) = existing {
        return Ok(id);
    }

    let base = "deleted_system";
    let mut username = base.to_string();
    let mut n = 0u32;
    loop {
        let taken = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE lower(username) = lower($1)",
        )
        .bind(&username)
        .fetch_one(&mut **tx)
        .await?;
        if taken == 0 {
            break;
        }
        n += 1;
        username = format!("{base}{n}");
    }

    let id = Uuid::new_v4();
    let password_hash = hash_password(&Uuid::new_v4().to_string())?;
    sqlx::query(
        r#"INSERT INTO users
           (id, username, email, password_hash, avatar_url, status, dm_privacy, created_at, google_id, username_changed_at, token_version)
           VALUES ($1, $2, $3, $4, NULL, 'invisible', 'friends', NOW(), NULL, NULL, 0)"#,
    )
    .bind(id)
    .bind(username)
    .bind("deleted@system.local")
    .bind(password_hash)
    .execute(&mut **tx)
    .await?;

    Ok(id)
}

/// GET /api/auth/data-export
/// GDPR/KVKK: returns JSON export for the authenticated user.
async fn export_my_data(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<(HeaderMap, Json<serde_json::Value>), AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:data_export:{}", claims.sub),
        3,
        Duration::from_secs(15 * 60),
        "Too many data export requests. Please wait and try again.",
    )
    .await?;

    let account = sqlx::query_as::<_, ExportAccountRow>(
        r#"SELECT id, username, email, avatar_url, status, dm_privacy, created_at,
                  (google_id IS NOT NULL) AS google_connected
           FROM users
           WHERE id = $1"#,
    )
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("User not found".into()))?;

    let memberships = sqlx::query_as::<_, ExportMembershipRow>(
        r#"SELECT s.name AS server_name,
                  sm.joined_at,
                  sm.role
           FROM server_members sm
           INNER JOIN servers s ON s.id = sm.server_id
           WHERE sm.user_id = $1
           ORDER BY sm.joined_at DESC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let friends = sqlx::query_as::<_, ExportFriendRow>(
        r#"SELECT u.username,
                  u.avatar_url,
                  u.status,
                  f.created_at
           FROM friendships f
           INNER JOIN users u
                   ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
           WHERE f.user_a = $1 OR f.user_b = $1
           ORDER BY f.created_at DESC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let friend_requests = sqlx::query_as::<_, ExportFriendRequestRow>(
        r#"SELECT CASE WHEN fr.requester_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction,
                  CASE WHEN fr.requester_id = $1 THEN ur.username ELSE uq.username END AS other_username,
                  fr.status,
                  fr.created_at
           FROM friend_requests fr
           INNER JOIN users uq ON uq.id = fr.requester_id
           INNER JOIN users ur ON ur.id = fr.receiver_id
           WHERE fr.requester_id = $1 OR fr.receiver_id = $1
           ORDER BY fr.created_at DESC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let server_messages = sqlx::query_as::<_, ExportServerMessageRow>(
        r#"SELECT c.name AS channel_name,
                  s.name AS server_name,
                  m.content,
                  m.attachments,
                  m.created_at,
                  m.edited_at
           FROM messages m
           INNER JOIN channels c ON c.id = m.channel_id
           INNER JOIN servers s ON s.id = c.server_id
           WHERE m.user_id = $1
           ORDER BY m.created_at DESC
           LIMIT 20000"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let dm_messages = sqlx::query_as::<_, ExportDmMessageRow>(
        r#"SELECT peer.username AS peer_username,
                  m.content,
                  m.attachments,
                  m.created_at,
                  m.edited_at
           FROM dm_messages m
           LEFT JOIN LATERAL (
               SELECT u.id, u.username
               FROM dm_channel_members dcm
               INNER JOIN users u ON u.id = dcm.user_id
               WHERE dcm.channel_id = m.channel_id AND dcm.user_id <> $1
               LIMIT 1
           ) AS peer ON TRUE
           WHERE m.user_id = $1
           ORDER BY m.created_at DESC
           LIMIT 20000"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let payload = serde_json::json!({
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "account": account,
        "memberships": memberships,
        "friends": friends,
        "friend_requests": friend_requests,
        "server_messages": server_messages,
        "dm_messages": dm_messages,
    });

    let date = chrono::Utc::now().format("%Y-%m-%d");
    let filename = format!("voxpery-data-export-{date}.json");
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{filename}\"")) {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );

    Ok((headers, Json(payload)))
}

/// DELETE /api/auth/account
/// GDPR/KVKK:
/// - permanently remove account + authored content.
async fn delete_my_account(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<DeleteAccountRequest>,
) -> Result<(HeaderMap, Json<serde_json::Value>), AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:delete_account:{}", claims.sub),
        5,
        Duration::from_secs(60 * 60),
        "Too many account deletion attempts. Please wait and try again.",
    )
    .await?;

    if body.confirm.trim() != "DELETE" {
        return Err(AppError::Validation(
            "Confirmation text must be exactly DELETE".into(),
        ));
    }

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    let is_oauth_only = user.google_id.is_some() && user.password_hash == "oauth";
    if !is_oauth_only {
        let password = body
            .password
            .as_deref()
            .ok_or_else(|| AppError::Validation("Password is required".into()))?;
        if !verify_password(password, &user.password_hash)? {
            return Err(AppError::InvalidCredentials);
        }
    }

    let mut tx = state.db.begin().await?;
    let deleted_placeholder_id = ensure_deleted_placeholder_user(&mut tx).await?;

    sqlx::query("UPDATE servers SET owner_id = $1 WHERE owner_id = $2")
        .bind(deleted_placeholder_id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"INSERT INTO server_members (server_id, user_id, role, joined_at)
           SELECT id, $1, 'owner', NOW()
           FROM servers
           WHERE owner_id = $1
           ON CONFLICT (server_id, user_id)
           DO UPDATE SET role = 'owner'"#,
    )
    .bind(deleted_placeholder_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE audit_log SET actor_id = $1 WHERE actor_id = $2")
        .bind(deleted_placeholder_id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE server_bans SET banned_by = $1 WHERE banned_by = $2")
        .bind(deleted_placeholder_id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE channel_pins SET pinned_by_id = $1 WHERE pinned_by_id = $2")
        .bind(deleted_placeholder_id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE dm_channel_pins SET pinned_by_id = $1 WHERE pinned_by_id = $2")
        .bind(deleted_placeholder_id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM message_reactions WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM dm_message_reactions WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM messages WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM dm_messages WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM friend_requests WHERE requester_id = $1 OR receiver_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM friendships WHERE user_a = $1 OR user_b = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM dm_channel_members WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM dm_channels c WHERE NOT EXISTS (SELECT 1 FROM dm_channel_members m WHERE m.channel_id = c.id)")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM server_member_roles WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM server_members WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM server_bans WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    if let Some(token) = token_from_request(&headers, &state.cookie_name) {
        let _ =
            crate::services::jwt_blacklist::blacklist_until_exp(&state.redis, &token, claims.exp)
                .await;
    }

    state.sessions.remove(&claims.sub);
    state.voice_sessions.remove(&claims.sub);
    state.voice_controls.remove(&claims.sub);
    let _ = state.tx.send(WsEvent::PresenceUpdate {
        user_id: claims.sub,
        status: "offline".to_string(),
    });

    let out_headers = clear_auth_cookie_header(&state);
    Ok((
        out_headers,
        Json(serde_json::json!({
            "message": "Account permanently deleted"
        })),
    ))
}

/// POST /api/auth/forgot-password
async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ForgotPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let email = body.email.trim().to_lowercase();
    let generic_ok = || {
        Json(
            serde_json::json!({ "message": "If an account with that email exists, we have sent a password reset link." }),
        )
    };

    enforce_rate_limit(
        &state.redis,
        format!("auth:forgot_password:{}", email),
        3,
        Duration::from_secs(3600), // max 3 attempts per hour
        "Too many password reset requests. Please check your email or try again later.",
    )
    .await?;

    #[derive(sqlx::FromRow)]
    struct ResetCandidate {
        id: Uuid,
        email: String,
        google_id: Option<String>,
    }

    let user = sqlx::query_as::<_, ResetCandidate>(
        "SELECT id, email, google_id FROM users WHERE lower(email) = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await?;

    // Always return generic success to prevent account enumeration.
    let Some(user) = user else {
        return Ok(generic_ok());
    };

    // Google Sign-In accounts have no local password to reset.
    if user.google_id.is_some() {
        return Ok(generic_ok());
    }

    // Generate token
    let token_plain = Uuid::new_v4().to_string();
    let mut hasher = Sha1::new();
    hasher.update(token_plain.as_bytes());
    let token_hash = BASE64.encode(hasher.finalize());
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);

    // Delete any existing token for this user to respect UNIQUE(user_id) constraint
    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(user.id)
        .execute(&state.db)
        .await?;

    // Insert new token
    sqlx::query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(user.id)
    .bind(&token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    // Send email
    if let (Some(host), Some(smtp_user), Some(smtp_pass)) =
        (&state.smtp_host, &state.smtp_user, &state.smtp_password)
    {
        let frontend_url = state
            .cors_origins
            .first()
            .cloned()
            .unwrap_or_else(|| "http://localhost:5173".to_string());
        let frontend_url = frontend_url.trim_end_matches('/');
        let reset_link = format!("{}/reset-password?token={}", frontend_url, token_plain);

        if let Err(e) = crate::services::email::send_password_reset_email(
            &user.email,
            &reset_link,
            host,
            smtp_user,
            smtp_pass,
        )
        .await
        {
            tracing::error!("Failed to send password reset email: {}", e);
        }
    } else {
        tracing::warn!("SMTP is not configured! Password reset email not sent.");
    }

    Ok(generic_ok())
}

/// POST /api/auth/reset-password
async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:reset_password_attempt:{}", body.token), // limit attempts per token to prevent brute force
        5,
        Duration::from_secs(3600),
        "Too many password reset attempts. Please request a new token.",
    )
    .await?;

    if body.new_password.len() < 8 {
        return Err(AppError::Validation(
            "New password must be at least 8 characters".into(),
        ));
    }

    let mut hasher = Sha1::new();
    hasher.update(body.token.as_bytes());
    let token_hash = BASE64.encode(hasher.finalize());

    // Find the token
    #[derive(sqlx::FromRow)]
    struct TokenRow {
        user_id: Uuid,
        expires_at: chrono::DateTime<chrono::Utc>,
    }

    let token_row = sqlx::query_as::<_, TokenRow>(
        "SELECT user_id, expires_at FROM password_reset_tokens WHERE token_hash = $1",
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await?;

    if let Some(row) = token_row {
        if chrono::Utc::now() > row.expires_at {
            // Delete expired token
            sqlx::query("DELETE FROM password_reset_tokens WHERE token_hash = $1")
                .bind(&token_hash)
                .execute(&state.db)
                .await?;
            return Err(AppError::Validation(
                "Password reset token has expired".into(),
            ));
        }

        // Token is valid, update password
        let password_hash = hash_password(&body.new_password)?;

        // Use a transaction to update password and delete token
        let mut tx = state.db.begin().await?;

        sqlx::query(
            "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
        )
        .bind(&password_hash)
        .bind(row.user_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
            .bind(row.user_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        Ok(Json(
            serde_json::json!({ "message": "Password has been successfully reset. You can now log in." }),
        ))
    } else {
        Err(AppError::Validation("Invalid password reset token".into()))
    }
}
