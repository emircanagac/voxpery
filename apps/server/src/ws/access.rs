//! WebSocket authorization: verify user can subscribe to a channel or join a voice channel.

use sqlx::PgPool;
use uuid::Uuid;

/// Returns true if the user has access to subscribe to this channel:
/// - Server channel: user is a member of the server that owns the channel.
/// - DM channel: user is a participant in the DM channel.
pub async fn can_subscribe_to_channel(
    db: &PgPool,
    user_id: Uuid,
    channel_id: Uuid,
) -> Result<bool, sqlx::Error> {
    // Server channel: channels + server_members
    let server_access: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM channels c
           INNER JOIN server_members sm ON c.server_id = sm.server_id
           WHERE c.id = $1 AND sm.user_id = $2"#,
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(db)
    .await?;

    if server_access > 0 {
        return Ok(true);
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
) -> Result<bool, sqlx::Error> {
    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM channels c
           INNER JOIN server_members sm ON c.server_id = sm.server_id
           WHERE c.id = $1 AND c.channel_type = 'voice' AND sm.user_id = $2"#,
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(db)
    .await?;

    Ok(count > 0)
}
