use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::fmt;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub email_verified: bool,
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

impl fmt::Debug for User {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let redacted_email = redact_email_for_debug(&self.email);
        f.debug_struct("User")
            .field("id", &self.id)
            .field("username", &self.username)
            .field("email", &redacted_email)
            .field("email_verified", &self.email_verified)
            .field("password_hash", &"<redacted>")
            .field("token_version", &self.token_version)
            .field("avatar_url", &self.avatar_url)
            .field("status", &self.status)
            .field("dm_privacy", &self.dm_privacy)
            .field("created_at", &self.created_at)
            .field("google_id", &self.google_id.as_ref().map(|_| "<linked>"))
            .field("username_changed_at", &self.username_changed_at)
            .finish()
    }
}

fn redact_email_for_debug(email: &str) -> String {
    let Some((local, domain)) = email.split_once('@') else {
        return "<redacted>".to_string();
    };
    let local_prefix = local.chars().next().unwrap_or('*');
    format!("{local_prefix}***@{domain}")
}

/// Public user info (no password hash, no email).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPublic {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub email_verified: bool,
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

/// Minimal profile surface safe to broadcast over WebSocket to other users.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserBroadcastProfile {
    pub id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub status: String,
}

impl From<User> for UserPublic {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            username: u.username,
            email: u.email,
            email_verified: u.email_verified,
            avatar_url: u.avatar_url,
            status: u.status,
            dm_privacy: u.dm_privacy,
            google_connected: u.google_id.is_some(),
            has_password: u.password_hash != "oauth",
            username_changed_at: u.username_changed_at,
        }
    }
}

impl From<&UserPublic> for UserBroadcastProfile {
    fn from(u: &UserPublic) -> Self {
        Self {
            id: u.id,
            username: u.username.clone(),
            avatar_url: u.avatar_url.clone(),
            status: u.status.clone(),
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
