use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware,
    response::{Html, IntoResponse, Redirect},
    routing::{get, patch, post},
    Extension, Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use sha1::{Digest, Sha1};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, token_from_request, Claims},
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

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    let protected = Router::new()
        .route("/me", get(get_me))
        .route("/status", patch(update_status))
        .route("/profile", patch(update_profile))
        .route("/check-username", get(check_username))
        .route("/change-password", post(change_password))
        .route_layer(middleware::from_fn_with_state(state, require_auth));

    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/forgot-password", post(forgot_password))
        .route("/reset-password", post(reset_password))
        .route("/google", get(google_oauth_start))
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
    let ip = headers
        .get("cf-connecting-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown_ip");

    // Allow max 5 accounts per IP per hour as basic flood protection
    if ip != "unknown_ip" {
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
        let res = client
            .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
            .form(&[
                ("secret", secret_key.as_str()),
                ("response", token),
                ("remoteip", ip),
            ])
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("CAPTCHA service error: {}", e)))?;

        #[derive(serde::Deserialize)]
        struct TurnstileResponse {
            success: bool,
        }

        let verify_result = res
            .json::<TurnstileResponse>()
            .await
            .map_err(|e| AppError::Internal(format!("CAPTCHA parse error: {}", e)))?;

        if !verify_result.success {
            return Err(AppError::Validation(
                "CAPTCHA verification failed. Are you a robot?".into(),
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
           VALUES ($1, $2, $3, $4, 'offline', NOW())"#,
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
            | PERM_MUTE_MEMBERS
            | PERM_DEAFEN_MEMBERS
            | PERM_VIEW_AUDIT_LOG;
        sqlx::query(
            r#"INSERT INTO server_roles (id, server_id, name, color, position, permissions)
                   VALUES ($1, $2, 'Moderator', '#5865F2', 0, $3)
                   ON CONFLICT (server_id, LOWER(name)) DO NOTHING"#,
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
    Json(body): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:login:{}", body.identifier.trim().to_lowercase()),
        state.auth_rate_limit_max,
        Duration::from_secs(state.auth_rate_limit_window_secs),
        "Too many login attempts. Please wait and try again.",
    )
    .await?;

    // Find user by email or username (case-insensitive)
    let identifier = body.identifier.trim();
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)",
    )
    .bind(identifier)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::InvalidCredentials)?;

    // Verify password
    if !verify_password(&body.password, &user.password_hash)? {
        return Err(AppError::InvalidCredentials);
    }

    // Set status to 'online' on login only if user did not explicitly choose 'offline' (respect last choice).
    let status_after_login = if user.status.eq_ignore_ascii_case("offline") {
        user.status.clone()
    } else {
        sqlx::query("UPDATE users SET status = 'online' WHERE id = $1")
            .bind(user.id)
            .execute(&state.db)
            .await?;
        "online".to_string()
    };

    // Ensure user is in official Voxpery community on login as well
    ensure_default_server_join(&state.db, user.id).await?;

    // Generate JWT
    let token = generate_token(
        user.id,
        &user.username,
        &state.jwt_secret,
        state.jwt_expiration,
    )?;

    let headers = auth_cookie_header(&state, &token);
    let user_public = UserPublic {
        id: user.id,
        username: user.username.clone(),
        avatar_url: user.avatar_url.clone(),
        status: status_after_login,
        dm_privacy: user.dm_privacy.clone(),
        username_changed_at: user.username_changed_at,
    };
    Ok((
        headers,
        Json(AuthResponse {
            token,
            user: user_public,
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
    let mut origin = q
        .origin
        .as_deref()
        .unwrap_or("http://localhost:5173")
        .trim()
        .to_string();
    if !state.cors_origins.contains(&origin) {
        tracing::warn!("Rejecting unapproved origin for Google OAuth: {}", origin);
        origin = state
            .cors_origins
            .first()
            .cloned()
            .unwrap_or_else(|| "http://localhost:5173".to_string());
    }

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

    let cookie = format!(
        "oauth_state={}; HttpOnly; Path=/; Max-Age=600; SameSite=None; Secure",
        nonce
    );
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
        if !state.cookie_secure && found_oauth_state.is_none() {
            tracing::debug!(
                "OAuth CSRF cookie missing on insecure localhost, allowing bypass for local dev."
            );
        } else {
            tracing::warn!(
                "OAuth CSRF check failed. Expected Nonce: '{}', Found Cookie: '{:?}'",
                nonce,
                found_oauth_state
            );
            let redirect_error = format!("{}?error=oauth_failed_csrf", redirect_path);
            let clear_cookie = "oauth_state=; HttpOnly; Path=/; Max-Age=0";
            let mut response =
                Redirect::temporary(&format!("{}{}", origin, redirect_error)).into_response();
            if let Ok(v) = HeaderValue::from_str(clear_cookie) {
                response.headers_mut().insert(header::SET_COOKIE, v);
            }
            return response;
        }
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
    // Put token in fragment so frontend can restore session when cookie is not sent (e.g. cross-origin redirect).
    let redirect_url = format!(
        "{}{}#token={}",
        origin,
        redirect_path,
        urlencoding::encode(&token)
    );

    let mut response = if origin.starts_with("voxpery://") {
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

    let clear_oauth_state = "oauth_state=; HttpOnly; Path=/; Max-Age=0";
    if let Ok(v) = HeaderValue::from_str(clear_oauth_state) {
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
    let status = body.status.trim().to_lowercase();
    if !matches!(status.as_str(), "online" | "dnd" | "offline") {
        return Err(AppError::Validation(
            "Status must be one of: online, dnd, offline".into(),
        ));
    }

    let user = sqlx::query_as::<_, User>(
        r#"UPDATE users
           SET status = $1
           WHERE id = $2
           RETURNING *"#,
    )
    .bind(&status)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    let _ = state.tx.send(WsEvent::PresenceUpdate {
        user_id: claims.sub,
        status,
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

    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
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
        tracing::warn!(
            "SMTP is not configured! Password reset email not sent. Token: {}",
            token_plain
        );
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

        sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
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
