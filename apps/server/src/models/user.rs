use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    #[serde(skip_serializing)]
    pub token_version: i64,
    pub avatar_url: Option<String>,
    pub status: String,
    pub dm_privacy: String,
    pub created_at: DateTime<Utc>,
    pub google_id: Option<String>,
    pub username_changed_at: Option<DateTime<Utc>>,
}

/// Public user info (no password hash, no email).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPublic {
    pub id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub dm_privacy: String,
    /// True when this account is connected to Google OAuth.
    pub google_connected: bool,
    /// True when this account has a local password hash (can login with email/password).
    pub has_password: bool,
    /// When the user last changed their username (for 30-day change limit). Frontend uses this to show "next change allowed" before save.
    pub username_changed_at: Option<DateTime<Utc>>,
}

impl From<User> for UserPublic {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            username: u.username,
            avatar_url: u.avatar_url,
            status: u.status,
            dm_privacy: u.dm_privacy,
            google_connected: u.google_id.is_some(),
            has_password: u.password_hash != "oauth",
            username_changed_at: u.username_changed_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
    pub captcha_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub identifier: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserPublic,
}
