use axum::{
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Query, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode},
    middleware,
    response::{Html, IntoResponse, Redirect, Response},
    routing::{delete, get, patch, post},
    Extension, Json, Router,
};
use base64::{
    engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD as BASE64URL},
    Engine,
};
use redis::AsyncCommands;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Write};
use std::net::SocketAddr;
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{
        claims_match_current_token_version, require_auth,
        require_auth_and_current_legal_consent_unverified_ok, token_from_request, Claims,
    },
    models::{
        AuthResponse, ForgotPasswordRequest, LoginRequest, RegisterRequest, ResetPasswordRequest,
        User, UserBroadcastProfile, UserPublic,
    },
    services::auth::{
        ensure_password_within_limit, generate_token, hash_password, hash_password_async,
        revoke_pending_account_tokens, run_password_work, verify_password, verify_password_async,
    },
    services::avatar_images::validate_profile_avatar_url,
    services::client_ip::resolve_client_ip,
    services::privacy::{
        has_current_legal_consent, record_privacy_event, validate_current_legal_documents,
        CURRENT_KVKK_NOTICE_VERSION, CURRENT_PRIVACY_NOTICE_VERSION, CURRENT_TERMS_VERSION,
        DATA_EXPORT_MAX_ARCHIVE_BYTES, DATA_EXPORT_MESSAGE_LIMIT, DATA_EXPORT_REAUTH_MAX_AGE_SECS,
    },
    services::rate_limit::enforce_rate_limit,
    services::server_membership,
    ws::WsEvent,
    AppState,
};

#[path = "captcha_frame.rs"]
mod captcha_frame;
#[path = "desktop_registration.rs"]
mod desktop_registration;
#[path = "google_registration.rs"]
mod google_registration;
#[path = "registration_pages.rs"]
mod registration_pages;

#[path = "auth_oauth.rs"]
mod oauth;
use oauth::*;
#[path = "auth_account.rs"]
mod account;
use account::*;
#[path = "auth_account_data.rs"]
mod account_data;
use account_data::*;
#[path = "auth_password_reset.rs"]
mod password_reset;
use password_reset::*;

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

static DUMMY_PASSWORD_HASH: LazyLock<String> = LazyLock::new(|| {
    let dummy_password = Uuid::new_v4().to_string();
    hash_password(&dummy_password).expect("dummy Argon2 hash should be generated successfully")
});

/// Build Set-Cookie value to clear auth cookie.
fn clear_auth_cookie_header(state: &AppState) -> HeaderMap {
    let mut cookie = format!(
        "{}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
        state.cookie_name
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

fn feature_disabled(message: &str) -> AppError {
    AppError::FeatureDisabled(message.to_string())
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

fn escape_html_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn javascript_string_literal(value: &str) -> String {
    serde_json::to_string(value)
        .unwrap_or_else(|_| "\"voxpery://auth/\"".to_string())
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
}

fn visible_presence_from_preference(status: &str) -> &'static str {
    match status.to_ascii_lowercase().as_str() {
        "dnd" => "dnd",
        "invisible" | "offline" => "offline",
        _ => "online",
    }
}

fn extract_client_ip(
    state: &AppState,
    headers: &HeaderMap,
    connect_info: Option<&ConnectInfo<SocketAddr>>,
) -> Option<String> {
    resolve_client_ip(
        headers,
        connect_info.map(|info| info.ip()),
        &state.trusted_proxies,
    )
}

async fn perform_dummy_password_verification(password: &str) -> Result<(), AppError> {
    let password = password.to_string();
    run_password_work(move || {
        let _ = verify_password(&password, DUMMY_PASSWORD_HASH.as_str())?;
        Ok(())
    })
    .await
}

/// Domain of the internal account that keeps deleted users' servers and history; no user
/// account may use an address in it.
const RESERVED_SYSTEM_EMAIL_DOMAIN: &str = "system.local";

fn is_valid_email(email: &str) -> bool {
    email.len() <= 255
        && email.contains('@')
        && email.find('@').map(|i| i > 0 && i < email.len() - 1) == Some(true)
        && !email.rsplit_once('@').is_some_and(|(_, domain)| {
            domain
                .trim()
                .eq_ignore_ascii_case(RESERVED_SYSTEM_EMAIL_DOMAIN)
        })
}

fn frontend_base_url(state: &AppState) -> String {
    if let Some(frontend_url) = state.frontend_url.as_deref() {
        return frontend_url.trim_end_matches('/').to_string();
    }

    state
        .cors_origins
        .iter()
        .find(|origin| origin.starts_with("http://") || origin.starts_with("https://"))
        .cloned()
        .map(|origin| origin.trim_end_matches('/').to_string())
        .unwrap_or_else(|| "http://localhost:5173".to_string())
}

fn validate_username(username: &str) -> Result<(), &'static str> {
    if username.len() < 3 || username.len() > 32 {
        return Err("Username must be 3-32 characters");
    }
    if username.starts_with('_')
        || username.starts_with('.')
        || username.ends_with('_')
        || username.ends_with('.')
    {
        return Err("Username cannot start or end with an underscore or period");
    }
    if username.contains("__")
        || username.contains("..")
        || username.contains("_.")
        || username.contains("._")
    {
        return Err("Username cannot contain consecutive underscores or periods");
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphabetic() || c.is_ascii_digit() || c == '_' || c == '.')
    {
        return Err("Username may only contain letters, numbers, underscores, and periods");
    }
    Ok(())
}

fn validate_profile_text(
    value: String,
    field_name: &str,
    max_chars: usize,
) -> Result<String, AppError> {
    let normalized = value.trim().to_string();
    if normalized.chars().count() > max_chars {
        return Err(AppError::Validation(format!(
            "{field_name} must be {max_chars} characters or fewer"
        )));
    }
    if normalized.chars().any(|ch| ch.is_control() && ch != '\n') {
        return Err(AppError::Validation(format!(
            "{field_name} cannot contain control characters"
        )));
    }
    Ok(normalized)
}

fn token_hash_base64(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    BASE64.encode(hasher.finalize())
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let max_len = left.len().max(right.len());
    let mut diff = left.len() ^ right.len();

    for i in 0..max_len {
        let left_byte = left.get(i).copied().unwrap_or(0);
        let right_byte = right.get(i).copied().unwrap_or(0);
        diff |= (left_byte ^ right_byte) as usize;
    }

    diff == 0
}

fn redact_email_for_log(email: &str) -> String {
    let Some((local, domain)) = email.split_once('@') else {
        return "[redacted-email]".to_string();
    };
    let first = local.chars().next().unwrap_or('*');
    format!("{}***@{}", first, domain)
}

fn login_failure_user_key(identifier: &str) -> String {
    crate::services::rate_limit::bounded_redis_key("auth:login_fail:user", identifier)
}

/// Failures against an account share one counter, whichever of its identifiers was typed.
/// Kept apart from `login_failure_user_key`, whose value is whatever the client sends.
fn login_failure_account_key(user_id: Uuid) -> String {
    format!("auth:login_fail:account:{user_id}")
}

fn login_failure_ip_key(ip: &str) -> String {
    format!("auth:login_fail:ip:{ip}")
}

async fn ensure_login_not_temporarily_locked(
    state: &Arc<AppState>,
    user_key: &str,
    client_ip: Option<&str>,
) -> Result<(), AppError> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Redis connection failed: {e}")))?;

    let user_failures: i64 = conn.get(user_key).await.unwrap_or(0);
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
    user_key: &str,
    client_ip: Option<&str>,
) -> Result<(), AppError> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Redis connection failed: {e}")))?;

    let user_failures: i64 = conn
        .incr(user_key, 1)
        .await
        .map_err(|e| AppError::Internal(format!("Redis increment failed: {e}")))?;
    if user_failures == 1 {
        let _: bool = conn
            .expire(user_key, state.login_failure_window_secs as i64)
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
    user_key: &str,
    client_ip: Option<&str>,
) -> Result<(), AppError> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Redis connection failed: {e}")))?;

    let _: i64 = conn
        .del(user_key)
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

/// Emails are stored and validated with at most this many characters.
const MAX_EMAIL_LEN: usize = 255;
/// Public (unauthenticated) auth requests are small forms; the global limit is for uploads.
const PUBLIC_AUTH_BODY_LIMIT: usize = 64 * 1024;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    let legal_exempt = Router::new()
        .route("/me", get(get_me))
        .route("/session", get(get_session))
        .route(
            "/legal-consent",
            get(get_legal_consent).post(acknowledge_legal_consent),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    let small_requests = Router::new()
        .route("/status", patch(update_status))
        .route("/check-username", get(check_username))
        .route("/set-password", post(set_password))
        .route("/change-password", post(change_password))
        .route(
            "/email/request-verification",
            post(request_email_verification),
        )
        .route("/data-export", post(export_my_data))
        .route("/account", delete(delete_my_account))
        .layer(DefaultBodyLimit::max(PUBLIC_AUTH_BODY_LIMIT));

    let protected = small_requests
        .route("/profile", patch(update_profile))
        .route_layer(middleware::from_fn_with_state(
            state,
            require_auth_and_current_legal_consent_unverified_ok,
        ));

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
        .route("/desktop-exchange", post(desktop_auth_exchange))
        .route("/google/callback", get(google_oauth_callback))
        .route("/legal-documents", get(public_legal_documents))
        .route(
            "/google/registration",
            get(google_registration::show).post(google_registration::complete),
        )
        .route(
            "/desktop-registration",
            get(desktop_registration::show).post(desktop_registration::complete),
        )
        .route("/captcha-frame", get(captcha_frame::show))
        .route("/email/confirm", post(confirm_email_verification))
        .layer(DefaultBodyLimit::max(PUBLIC_AUTH_BODY_LIMIT))
        .merge(legal_exempt)
        .merge(protected)
}

async fn validate_registration_captcha(
    state: &AppState,
    token: Option<&str>,
    client_ip: Option<&str>,
) -> Result<(), AppError> {
    if let Some(secret_key) = &state.turnstile_secret_key {
        let token = token.unwrap_or("");
        if token.is_empty() {
            return Err(AppError::Validation("CAPTCHA token is required".into()));
        }

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| AppError::Internal("Could not initialize CAPTCHA verification".into()))?;
        let mut verify_form = vec![
            ("secret", secret_key.to_string()),
            ("response", token.to_string()),
        ];
        if let Some(ip) = client_ip {
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
    Ok(())
}

/// POST /api/auth/register
async fn register(
    State(state): State<Arc<AppState>>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    let email = body.email.trim().to_lowercase();
    // v0.2.13 clients used one explicit checkbox labelled for both Privacy and KVKK.
    // Preserve that proof during a rolling deploy while newer clients send both fields.
    let kvkk_notice_acknowledged = body
        .kvkk_notice_acknowledged
        .unwrap_or(body.privacy_notice_acknowledged);
    let kvkk_notice_version = body
        .kvkk_notice_version
        .as_deref()
        .unwrap_or(body.privacy_notice_version.as_str());

    validate_current_legal_documents(
        body.terms_accepted,
        body.terms_version.trim(),
        body.privacy_notice_acknowledged,
        body.privacy_notice_version.trim(),
        kvkk_notice_acknowledged,
        kvkk_notice_version.trim(),
    )?;

    if email.len() > MAX_EMAIL_LEN || !is_valid_email(&email) {
        return Err(AppError::Validation(
            "Email must be a valid format (e.g. user@domain)".into(),
        ));
    }

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
    let client_ip = extract_client_ip(
        &state,
        &headers,
        connect_info.as_ref().map(|Extension(info)| info),
    );

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

    validate_registration_captcha(&state, body.captcha_token.as_deref(), client_ip.as_deref())
        .await?;

    // Validate input
    let username = body.username.trim();
    validate_username(username).map_err(|message| AppError::Validation(message.into()))?;
    if email.len() > 255 {
        return Err(AppError::Validation(
            "Email must be at most 255 characters".into(),
        ));
    }
    if !is_valid_email(&email) {
        return Err(AppError::Validation(
            "Email must be a valid format (e.g. user@domain)".into(),
        ));
    }
    if body.password.len() < 8 {
        return Err(AppError::Validation(
            "Password must be at least 8 characters".into(),
        ));
    }
    ensure_password_within_limit(&body.password)?;

    // Check if user already exists
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($2)",
    )
    .bind(&email)
    .bind(username)
    .fetch_one(&state.db)
    .await?;

    if existing > 0 {
        return Err(AppError::UserAlreadyExists);
    }

    // Hash password
    let password_hash = hash_password_async(&body.password).await?;

    // Insert the account and legal acknowledgement proof atomically.
    let mut tx = state.db.begin().await?;
    let user = sqlx::query_as::<_, User>(
        r#"INSERT INTO users
           (id, username, email, password_hash, status, dm_privacy, email_verified, created_at,
            terms_version, terms_accepted_at, privacy_notice_version,
            privacy_notice_acknowledged_at, kvkk_notice_version,
            kvkk_notice_acknowledged_at)
           VALUES ($1, $2, $3, $4, 'online', 'everyone', FALSE, NOW(),
                   $5, NOW(), $6, NOW(), $7, NOW())
           RETURNING *"#,
    )
    .bind(Uuid::new_v4())
    .bind(username)
    .bind(&email)
    .bind(&password_hash)
    .bind(CURRENT_TERMS_VERSION)
    .bind(CURRENT_PRIVACY_NOTICE_VERSION)
    .bind(CURRENT_KVKK_NOTICE_VERSION)
    .fetch_one(&mut *tx)
    .await?;

    record_privacy_event(
        &mut tx,
        user.id,
        "account_registered",
        Some(CURRENT_TERMS_VERSION),
        Some(CURRENT_PRIVACY_NOTICE_VERSION),
        Some(CURRENT_KVKK_NOTICE_VERSION),
    )
    .await?;
    tx.commit().await?;

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
pub(crate) const DEFAULT_SERVER_INVITE_CODE: &str = "voxpery";
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
const PERM_MOVE_MEMBERS: i64 = 1 << 13;
const DEFAULT_COMMUNITY_ONBOARDING_TITLE: &str = "Welcome to the Voxpery Community";
const DEFAULT_COMMUNITY_ONBOARDING_BODY: &str =
    "Start here, say hello, and jump into voice when you are ready.";
const DEFAULT_COMMUNITY_ONBOARDING_TASKS: [&str; 3] = [
    "Send your first message in #general",
    "Join the General voice channel",
    "Explore the open-source project on GitHub",
];

/// Create the default admin user at startup if ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD are all set.
/// If a user with that email already exists, returns their id. Otherwise creates the user and returns the new id.
/// The seeded account is the only one that can own the default Voxpery server.
pub async fn ensure_seed_admin(
    db: &sqlx::PgPool,
    email: &str,
    username: &str,
    password: &str,
) -> Result<Option<Uuid>, AppError> {
    let username = username.trim();
    if let Err(message) = validate_username(username) {
        tracing::error!(
            "Invalid seed admin username: {}. Check your ADMIN_USERNAME env var.",
            message
        );
        return Err(AppError::Validation("Invalid seed admin username".into()));
    }
    let weak_password = crate::is_weak_seed_admin_password(password);
    let existing =
        sqlx::query_as::<_, (Uuid, String)>("SELECT id, password_hash FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(db)
            .await?;
    if let Some((id, password_hash)) = existing {
        // An account seeded earlier may still have the example password everyone can read.
        if weak_password && verify_password(password, &password_hash).unwrap_or(false) {
            tracing::error!(
                "The seed admin account still uses the weak ADMIN_PASSWORD from .env; sign in and change its password"
            );
        } else {
            tracing::info!("Seed admin user already exists (email), skipping create");
        }
        return Ok(Some(id));
    }
    if weak_password {
        tracing::warn!(
            "ADMIN_PASSWORD is the .env.example placeholder or shorter than 12 characters; the seed admin was not created"
        );
        return Ok(None);
    }
    let password_hash = hash_password(password)?;
    let id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO users (id, username, email, password_hash, status, created_at)
           VALUES ($1, $2, $3, $4, 'online', NOW())"#,
    )
    .bind(id)
    .bind(username)
    .bind(email)
    .bind(&password_hash)
    .execute(db)
    .await?;
    tracing::info!("Seed admin user created");
    Ok(Some(id))
}

/// Create the official Voxpery community server unless it exists, owned by the seeded admin.
/// Runs at startup only: no sign-up or sign-in may decide who owns it.
pub async fn ensure_default_server(db: &sqlx::PgPool, owner_id: Uuid) -> Result<(), AppError> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM servers WHERE invite_code = $1)")
            .bind(DEFAULT_SERVER_INVITE_CODE)
            .fetch_one(db)
            .await?;

    if !exists {
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
            "INSERT INTO server_members (server_id, user_id, joined_at) VALUES ($1, $2, NOW())",
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

        // Seed the Moderator role only with a new server. Afterwards the role belongs to the
        // owner: sign-ins must not restore permissions (or a role) the owner removed.
        let moderator_perms = PERM_MANAGE_MESSAGES
            | PERM_MANAGE_PINS
            | PERM_KICK_MEMBERS
            | PERM_BAN_MEMBERS
            | PERM_MUTE_MEMBERS
            | PERM_DEAFEN_MEMBERS
            | PERM_MOVE_MEMBERS
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

        sqlx::query(
            r#"INSERT INTO server_members (server_id, user_id, joined_at)
               SELECT $1, u.id, NOW()
               FROM users u
               WHERE NOT EXISTS (
                   SELECT 1 FROM server_bans b WHERE b.server_id = $1 AND b.user_id = u.id
               )
               ON CONFLICT (server_id, user_id) DO NOTHING"#,
        )
        .bind(server_id)
        .execute(db)
        .await?;
    }

    ensure_default_server_join(db, owner_id).await
}

/// Add the user to the official Voxpery community server, when this installation has one.
/// Called on register/login for every user.
pub async fn ensure_default_server_join(db: &sqlx::PgPool, user_id: Uuid) -> Result<(), AppError> {
    let server_id_opt: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM servers WHERE invite_code = $1")
            .bind(DEFAULT_SERVER_INVITE_CODE)
            .fetch_optional(db)
            .await?;

    if let Some(server_id) = server_id_opt {
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

        ensure_default_onboarding_guide(db, server_id).await?;

        let mut tx = db.begin().await?;
        server_membership::lock_membership(&mut tx, server_id, user_id).await?;
        if !server_membership::is_banned(&mut tx, server_id, user_id).await? {
            server_membership::add_member(&mut tx, server_id, user_id).await?;
        }
        tx.commit().await?;

        // "@everyone" is implicit in permission resolution; no explicit member assignment needed.
    }
    Ok(())
}

async fn ensure_default_onboarding_guide(
    db: &sqlx::PgPool,
    server_id: Uuid,
) -> Result<(), AppError> {
    let recommended_channel_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT id
           FROM channels
           WHERE server_id = $1
             AND (
               (channel_type = 'text' AND LOWER(name) = 'general')
               OR (channel_type = 'voice' AND LOWER(name) = 'general')
             )
           ORDER BY CASE WHEN channel_type = 'text' THEN 0 ELSE 1 END, position ASC, created_at ASC
           LIMIT 2"#,
    )
    .bind(server_id)
    .fetch_all(db)
    .await?;
    let starter_tasks = DEFAULT_COMMUNITY_ONBOARDING_TASKS
        .iter()
        .map(|task| (*task).to_string())
        .collect::<Vec<_>>();

    sqlx::query(
        r#"INSERT INTO server_onboarding_guides (
               server_id, enabled, title, body, recommended_channel_ids, starter_tasks, updated_at
           )
           VALUES ($1, TRUE, $2, $3, $4, $5, NOW())
           ON CONFLICT (server_id) DO NOTHING"#,
    )
    .bind(server_id)
    .bind(DEFAULT_COMMUNITY_ONBOARDING_TITLE)
    .bind(DEFAULT_COMMUNITY_ONBOARDING_BODY)
    .bind(&recommended_channel_ids)
    .bind(&starter_tasks)
    .execute(db)
    .await?;

    Ok(())
}

/// POST /api/auth/login
async fn login(
    State(state): State<Arc<AppState>>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    let identifier = body.identifier.trim().to_lowercase();
    let client_ip = extract_client_ip(
        &state,
        &headers,
        connect_info.as_ref().map(|Extension(info)| info),
    );

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

    // No account has an identifier this long (emails are capped at 255 characters), so reject it
    // before it reaches Redis or the database.
    if identifier.is_empty()
        || identifier.len() > MAX_EMAIL_LEN
        || body.password.len() > crate::services::auth::MAX_PASSWORD_BYTES
    {
        return Err(AppError::InvalidCredentials);
    }

    enforce_rate_limit(
        &state.redis,
        format!("auth:login:{identifier}"),
        state.auth_rate_limit_max,
        Duration::from_secs(state.auth_rate_limit_window_secs),
        "Too many login attempts. Please wait and try again.",
    )
    .await?;

    // Find user by email or username (case-insensitive)
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)",
    )
    .bind(&identifier)
    .fetch_optional(&state.db)
    .await?;

    let failure_key = match &user {
        Some(user) => login_failure_account_key(user.id),
        None => login_failure_user_key(&identifier),
    };
    ensure_login_not_temporarily_locked(&state, &failure_key, client_ip.as_deref()).await?;

    let Some(user) = user else {
        perform_dummy_password_verification(&body.password).await?;
        record_login_failure(&state, &failure_key, client_ip.as_deref()).await?;
        return Err(AppError::InvalidCredentials);
    };

    // OAuth-only accounts do not have a local password yet.
    if user.password_hash == "oauth" {
        perform_dummy_password_verification(&body.password).await?;
        record_login_failure(&state, &failure_key, client_ip.as_deref()).await?;
        return Err(AppError::InvalidCredentials);
    }

    // Verify password
    if !verify_password_async(&body.password, &user.password_hash).await? {
        record_login_failure(&state, &failure_key, client_ip.as_deref()).await?;
        return Err(AppError::InvalidCredentials);
    }

    clear_login_failures(&state, &failure_key, client_ip.as_deref()).await?;

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

/// POST /api/auth/logout — clears auth cookie (web) and revokes current token when provided.
/// No auth required; idempotent.
async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Some(token) = token_from_request(&headers, &state.cookie_name) {
        if let Ok(data) = jsonwebtoken::decode::<Claims>(
            &token,
            &jsonwebtoken::DecodingKey::from_secret(state.jwt_secret.as_bytes()),
            &jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256),
        ) {
            let revoked = crate::services::jwt_blacklist::blacklist_until_exp(
                &state.redis,
                &token,
                data.claims.exp,
            )
            .await
            .is_ok()
                && crate::services::image_proxy_grant::revoke_session(&state.redis, &data.claims)
                    .await
                    .is_ok();
            if !revoked {
                // Do not claim logout succeeded while the bearer token remains valid, but
                // still end the browser session so a reload cannot silently restore it.
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    clear_auth_cookie_header(&state),
                    Json(serde_json::json!({ "error": "Could not revoke the session. Please try again." })),
                )
                    .into_response();
            }
        }
    }

    let headers = clear_auth_cookie_header(&state);
    (StatusCode::OK, headers, Json(serde_json::json!({}))).into_response()
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

#[derive(Debug, serde::Serialize)]
struct LegalConsentStatus {
    required: bool,
    current_terms_version: &'static str,
    current_privacy_notice_version: &'static str,
    current_kvkk_notice_version: &'static str,
}

#[derive(sqlx::FromRow)]
struct SessionRow {
    #[sqlx(flatten)]
    user: User,
    legal_current: bool,
}

#[derive(serde::Serialize)]
struct SessionResponse {
    user: UserPublic,
    legal_consent: LegalConsentStatus,
    /// Absent until the account may use the app: see `require_auth_and_current_legal_consent`.
    #[serde(skip_serializing_if = "Option::is_none")]
    image_proxy: Option<crate::services::image_proxy_grant::ImageProxyGrant>,
}

/// Read user and legal status from one row snapshot; never mutate acknowledgement.
async fn get_session(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Response, AppError> {
    let row = sqlx::query_as::<_, SessionRow>(
        r#"SELECT u.*, COALESCE(
            terms_version = $3 AND terms_accepted_at IS NOT NULL
            AND privacy_notice_version = $4 AND privacy_notice_acknowledged_at IS NOT NULL
            AND kvkk_notice_version = $5 AND kvkk_notice_acknowledged_at IS NOT NULL,
            FALSE
        ) AS legal_current FROM users u WHERE id = $1 AND token_version = $2"#,
    )
    .bind(claims.sub)
    .bind(claims.ver)
    .bind(CURRENT_TERMS_VERSION)
    .bind(CURRENT_PRIVACY_NOTICE_VERSION)
    .bind(CURRENT_KVKK_NOTICE_VERSION)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;
    let may_use_app =
        row.legal_current && (row.user.email_verified || !state.email_verification_required);
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(SessionResponse {
            image_proxy: may_use_app.then(|| {
                crate::services::image_proxy_grant::current_user_grant(&state.jwt_secret, &claims)
            }),
            user: UserPublic::from(row.user),
            legal_consent: LegalConsentStatus::new(!row.legal_current),
        }),
    )
        .into_response())
}

impl LegalConsentStatus {
    fn new(required: bool) -> Self {
        Self {
            required,
            current_terms_version: CURRENT_TERMS_VERSION,
            current_privacy_notice_version: CURRENT_PRIVACY_NOTICE_VERSION,
            current_kvkk_notice_version: CURRENT_KVKK_NOTICE_VERSION,
        }
    }
}

async fn public_legal_documents() -> Json<LegalConsentStatus> {
    Json(LegalConsentStatus::new(false))
}

#[derive(Debug, serde::Deserialize)]
struct LegalConsentRequest {
    terms_accepted: bool,
    terms_version: String,
    privacy_notice_acknowledged: bool,
    privacy_notice_version: String,
    kvkk_notice_acknowledged: bool,
    kvkk_notice_version: String,
}

/// GET /api/auth/legal-consent — current acknowledgement requirement for this session.
async fn get_legal_consent(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<LegalConsentStatus>, AppError> {
    let current = has_current_legal_consent(&state.db, claims.sub).await?;
    Ok(Json(LegalConsentStatus::new(!current)))
}

/// POST /api/auth/legal-consent — atomically persist all current legal-document versions.
async fn acknowledge_legal_consent(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<LegalConsentRequest>,
) -> Result<Json<LegalConsentStatus>, AppError> {
    validate_current_legal_documents(
        body.terms_accepted,
        body.terms_version.trim(),
        body.privacy_notice_acknowledged,
        body.privacy_notice_version.trim(),
        body.kvkk_notice_acknowledged,
        body.kvkk_notice_version.trim(),
    )?;

    let mut tx = state.db.begin().await?;
    let updated = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE users
           SET terms_version = $2,
               terms_accepted_at = NOW(),
               privacy_notice_version = $3,
               privacy_notice_acknowledged_at = NOW(),
               kvkk_notice_version = $4,
               kvkk_notice_acknowledged_at = NOW()
           WHERE id = $1
             AND (
                 terms_version IS DISTINCT FROM $2
                 OR terms_accepted_at IS NULL
                 OR privacy_notice_version IS DISTINCT FROM $3
                 OR privacy_notice_acknowledged_at IS NULL
                 OR kvkk_notice_version IS DISTINCT FROM $4
                 OR kvkk_notice_acknowledged_at IS NULL
             )
           RETURNING id"#,
    )
    .bind(claims.sub)
    .bind(CURRENT_TERMS_VERSION)
    .bind(CURRENT_PRIVACY_NOTICE_VERSION)
    .bind(CURRENT_KVKK_NOTICE_VERSION)
    .fetch_optional(&mut *tx)
    .await?;

    if updated.is_some() {
        record_privacy_event(
            &mut tx,
            claims.sub,
            "legal_documents_acknowledged",
            Some(CURRENT_TERMS_VERSION),
            Some(CURRENT_PRIVACY_NOTICE_VERSION),
            Some(CURRENT_KVKK_NOTICE_VERSION),
        )
        .await?;
    }
    tx.commit().await?;

    Ok(Json(LegalConsentStatus::new(false)))
}
