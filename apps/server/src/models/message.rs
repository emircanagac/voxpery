use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub content: String,
    pub attachments: Option<serde_json::Value>,
    pub edited_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Message with author info for API responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageWithAuthor {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub content: String,
    pub attachments: Option<serde_json::Value>,
    pub edited_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub author: MessageAuthor,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MessageAuthor {
    pub user_id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: Option<String>,
    pub attachments: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct MessageQuery {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct EditMessageRequest {
    pub content: String,
}
