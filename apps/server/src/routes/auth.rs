use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware,
    response::IntoResponse,
    routing::{get, patch, post},
    Extension, Json, Router,
};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, token_from_request, Claims},
    models::{AuthResponse, LoginRequest, RegisterRequest, User, UserPublic},
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
        state.cookie_name,
        token,
        max_age
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
    let cookie = format!("{}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0", state.cookie_name);
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
        .route("/change-password", post(change_password))
        .route_layer(middleware::from_fn_with_state(state, require_auth));

    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .merge(protected)
}

/// POST /api/auth/register
async fn register(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    let email = body.email.trim().to_lowercase();
    enforce_rate_limit(
        &state.rate_limits,
        format!("auth:register:{}", email),
        state.auth_rate_limit_max,
        Duration::from_secs(state.auth_rate_limit_window_secs),
        "Too many register attempts. Please wait and try again.",
    )?;

    // Validate input
    let username = body.username.trim();
    if username.len() < 3 || username.len() > 32 {
        return Err(AppError::Validation("Username must be 3-32 characters".into()));
    }
    if !username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(AppError::Validation(
            "Username may only contain letters, numbers, and underscores".into(),
        ));
    }
    if email.len() > 255 {
        return Err(AppError::Validation("Email must be at most 255 characters".into()));
    }
    if !email.contains('@') || email.find('@').map(|i| i > 0 && i < email.len() - 1) != Some(true) {
        return Err(AppError::Validation("Email must be a valid format (e.g. user@domain)".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::Validation("Password must be at least 8 characters".into()));
    }

    // Check if user already exists
    let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = $1 OR username = $2")
        .bind(&email)
        .bind(username)
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
    .bind(username)
    .bind(&email)
    .bind(&password_hash)
    .fetch_one(&state.db)
    .await?;

    // Auto-join default Voxpery server
    ensure_default_server_join(&state.db, user.id).await?;

    // Generate JWT
    let token = generate_token(user.id, &user.username, &state.jwt_secret, state.jwt_expiration)?;

    let headers = auth_cookie_header(&state, &token);
    Ok((headers, Json(AuthResponse {
        token,
        user: UserPublic::from(user),
    })))
}

/// Default Voxpery server invite code.
/// Users auto-join this official community server on register/login.
const DEFAULT_SERVER_INVITE_CODE: &str = "voxpery";

/// Env vars to resolve default Voxpery server owner: ADMIN_EMAIL or ADMIN_USERNAME (seeded admin).
fn official_owner_lookup() -> (Option<String>, Option<String>) {
    let email = std::env::var("ADMIN_EMAIL").ok().filter(|s| !s.is_empty());
    let username = std::env::var("ADMIN_USERNAME").ok().filter(|s| !s.is_empty());
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
    if username.len() < 3 || username.len() > 32 {
        tracing::warn!("Seed admin username must be 3-32 characters; skipping seed");
        return Ok(None);
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
    .bind(username)
    .bind(email)
    .bind(&password_hash)
    .execute(db)
    .await?;
    tracing::info!("Seed admin user created: {} ({})", username, email);
    Ok(Some(id))
}

/// Ensure the official Voxpery community server exists and add the user to it.
/// Called on register/login for every user, and at startup with the seeded admin id to create the server.
pub async fn ensure_default_server_join(
    db: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<(), AppError> {
    let mut server_id_opt: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM servers WHERE invite_code = $1",
    )
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
               VALUES ($1, $2, 'general', 'text', 'Text Channels', 0, NOW())"#,
        )
        .bind(Uuid::new_v4())
        .bind(server_id)
        .execute(db)
        .await?;

        sqlx::query(
            r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
               VALUES ($1, $2, 'General', 'voice', 'Voice Channels', 0, NOW())"#,
        )
        .bind(Uuid::new_v4())
        .bind(server_id)
        .execute(db)
        .await?;

        server_id_opt = Some(server_id);
    }

    if let Some(server_id) = server_id_opt {
            let already = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
            )
            .bind(server_id)
            .bind(user_id)
            .fetch_one(db)
            .await?;
            if already == 0 {
                sqlx::query(
                    "INSERT INTO server_members (server_id, user_id, role, joined_at) VALUES ($1, $2, 'member', NOW())",
                )
                .bind(server_id)
                .bind(user_id)
                .execute(db)
                .await?;
            }
    }
    Ok(())
}

/// POST /api/auth/login
async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    enforce_rate_limit(
        &state.rate_limits,
        format!("auth:login:{}", body.identifier.trim().to_lowercase()),
        state.auth_rate_limit_max,
        Duration::from_secs(state.auth_rate_limit_window_secs),
        "Too many login attempts. Please wait and try again.",
    )?;

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

    // Update status
    sqlx::query("UPDATE users SET status = 'online' WHERE id = $1")
        .bind(user.id)
        .execute(&state.db)
        .await?;

    // Ensure user is in official Voxpery community on login as well
    ensure_default_server_join(&state.db, user.id).await?;

    // Generate JWT
    let token = generate_token(user.id, &user.username, &state.jwt_secret, state.jwt_expiration)?;

    let headers = auth_cookie_header(&state, &token);
    Ok((headers, Json(AuthResponse {
        token,
        user: UserPublic::from(user),
    })))
}

/// POST /api/auth/logout — clears auth cookie (web) and revokes current token when provided.
/// No auth required; idempotent.
async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
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

/// PATCH /api/auth/status
async fn update_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateStatusRequest>,
) -> Result<Json<UserPublic>, AppError> {
    let status = body.status.trim().to_lowercase();
    if !matches!(status.as_str(), "online" | "idle" | "dnd" | "offline") {
        return Err(AppError::Validation(
            "Status must be one of: online, idle, dnd, offline".into(),
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
        &state.rate_limits,
        format!("auth:profile:{}", claims.sub),
        12,
        Duration::from_secs(60),
        "Too many profile update attempts. Please wait and try again.",
    )?;

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    let mut next_avatar = user.avatar_url.clone();
    let mut next_dm_privacy = user.dm_privacy.clone();
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
        let valid_scheme =
            trimmed.starts_with("data:image/") || trimmed.starts_with("http://") || trimmed.starts_with("https://");
        if !valid_scheme {
            return Err(AppError::Validation("Avatar must be an image URL or data URL".into()));
        }
        if trimmed.to_lowercase().starts_with("data:image/svg+xml") {
            return Err(AppError::Validation("SVG images are not allowed for avatars (security)".into()));
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

    let updated = sqlx::query_as::<_, User>(
        r#"UPDATE users
            SET avatar_url = $1, dm_privacy = $2
            WHERE id = $3
           RETURNING *"#,
    )
    .bind(next_avatar)
        .bind(next_dm_privacy)
        .bind(claims.sub)
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
        &state.rate_limits,
        format!("auth:change_password:{}", claims.sub),
        5,
        Duration::from_secs(60 * 60), // max 5 attempts per hour
        "Too many password change attempts. Please wait.",
    )?;

    if body.new_password.len() < 8 {
        return Err(AppError::Validation("New password must be at least 8 characters".into()));
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
    Ok((out_headers, Json(serde_json::json!({ "message": "Password changed successfully" }))))
}
