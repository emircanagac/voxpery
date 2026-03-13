//! WebSocket authorization: verify user can subscribe to a channel or join a voice channel.

use crate::errors::AppError;
use crate::services::permissions::{self, Permissions};
use sqlx::PgPool;
use uuid::Uuid;

/// Returns true if the user has access to subscribe to this channel:
/// - Server channel: user is a member of the server that owns the channel.
/// - DM channel: user is a participant in the DM channel.
pub async fn can_subscribe_to_channel(
    db: &PgPool,
    user_id: Uuid,
    channel_id: Uuid,
) -> Result<bool, AppError> {
    // Server channel: require effective VIEW_SERVER permission (includes category/channel overrides).
    let server_channel_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_one(db)
            .await?;

    if server_channel_exists > 0 {
        let perms = permissions::get_user_channel_permissions(db, channel_id, user_id).await?;
        return Ok(perms.contains(Permissions::VIEW_SERVER));
    }

    // DM channel: dm_channel_members
    let dm_access: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dm_channel_members WHERE channel_id = $1 AND user_id = $2",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(db)
    .await?;

    Ok(dm_access > 0)
}

/// Returns true if the user can join this voice channel:
/// - Channel exists, is type 'voice', and user is a member of the channel's server.
pub async fn can_join_voice_channel(
    db: &PgPool,
    user_id: Uuid,
    channel_id: Uuid,
) -> Result<bool, AppError> {
    let channel_type: Option<String> =
        sqlx::query_scalar("SELECT channel_type FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_optional(db)
            .await?;

    if channel_type.as_deref() != Some("voice") {
        return Ok(false);
    }

    let perms = permissions::get_user_channel_permissions(db, channel_id, user_id).await?;
    Ok(perms.contains(Permissions::VIEW_SERVER) && perms.contains(Permissions::CONNECT_VOICE))
}
