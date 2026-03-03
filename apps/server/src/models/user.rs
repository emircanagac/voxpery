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
    pub avatar_url: Option<String>,
    pub status: String,
    pub dm_privacy: String,
    pub created_at: DateTime<Utc>,
}

/// Public user info (no password hash, no email).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPublic {
    pub id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub dm_privacy: String,
}

impl From<User> for UserPublic {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            username: u.username,
            avatar_url: u.avatar_url,
            status: u.status,
            dm_privacy: u.dm_privacy,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub identifier: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserPublic,
}
