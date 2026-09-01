#![allow(dead_code)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Server {
    pub id: Uuid,
    pub name: String,
    pub icon_url: Option<String>,
    pub description: Option<String>,
    pub owner_id: Uuid,
    pub invite_code: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ServerMember {
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

/// Server with member count — used for server list.
/// Derives FromRow to support single JOIN+GROUP BY query.
#[derive(Debug, Serialize, FromRow)]
pub struct ServerWithMembers {
    pub id: Uuid,
    pub name: String,
    pub icon_url: Option<String>,
    pub description: Option<String>,
    pub owner_id: Uuid,
    pub invite_code: String,
    pub created_at: DateTime<Utc>,
    pub member_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
    pub icon_url: Option<String>,
    pub description: Option<String>,
    pub client_request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct JoinServerRequest {
    pub invite_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ServerInvitePreview {
    pub id: Uuid,
    pub name: String,
    pub icon_url: Option<String>,
    pub description: Option<String>,
    pub invite_code: String,
    pub member_count: i64,
}

/// Server details with member list (for sidebar)
#[derive(Debug, Serialize)]
pub struct ServerDetail {
    #[serde(flatten)]
    pub server: Server,
    /// Effective permissions for the current user in this server (bitmask).
    pub my_permissions: i64,
    pub members: Vec<MemberInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MemberInfo {
    pub user_id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub about_me: String,
    pub role: String,
    pub status: String,
    pub account_created_at: DateTime<Utc>,
    pub server_joined_at: DateTime<Utc>,
    /// Display color derived from the highest-positioned role with a color,
    /// similar to Discord's member list behaviour.
    pub role_color: Option<String>,
    /// Explicit assigned server roles (excluding Everyone), ordered by role position.
    #[serde(default)]
    pub roles: Vec<String>,
    /// Highest custom role position. Owners use -1 and members without custom roles use i32::MAX.
    pub highest_role_position: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ServerRule {
    pub id: Uuid,
    pub server_id: Uuid,
    pub rule_text: String,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ServerOnboardingGuide {
    pub server_id: Uuid,
    pub enabled: bool,
    pub title: String,
    pub body: String,
    pub recommended_channel_ids: Vec<Uuid>,
    pub starter_tasks: Vec<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerOnboardingGuideRequest {
    pub enabled: Option<bool>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub recommended_channel_ids: Option<Vec<Uuid>>,
    pub starter_tasks: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerRuleRequest {
    pub rule_text: String,
    pub position: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerRuleRequest {
    pub rule_text: Option<String>,
    pub position: Option<i32>,
}
