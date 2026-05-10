use std::time::Duration;

use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{errors::AppError, services::audit};

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct ServerTimeoutEntry {
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub timed_out_until: DateTime<Utc>,
    pub timeout_by: Option<Uuid>,
    pub timeout_by_username: Option<String>,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct RaidEventEntry {
    pub id: Uuid,
    pub server_id: Uuid,
    pub event_type: String,
    pub user_id: Option<Uuid>,
    pub username: Option<String>,
    pub channel_id: Option<Uuid>,
    pub channel_name: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

fn moderation_key(key: &str) -> String {
    format!("moderation:{key}")
}

fn now_epoch_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn has_invite_link(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    lower.contains("discord.gg/")
        || lower.contains("discord.com/invite/")
        || lower.contains("discordapp.com/invite/")
        || lower.contains("/invite/")
}

async fn try_mark_raid_cooldown(
    redis: &redis::Client,
    server_id: Uuid,
    event_type: &str,
    user_id: Option<Uuid>,
    ttl_secs: u64,
) -> Result<bool, AppError> {
    let mut conn = redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Moderation Redis connection failed: {e}")))?;
    let key = moderation_key(&format!(
        "raid_event_cooldown:{server_id}:{event_type}:{}",
        user_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "server".to_string())
    ));
    let marked: bool = conn
        .set_nx(&key, "1")
        .await
        .map_err(|e| AppError::Internal(format!("Moderation cooldown set failed: {e}")))?;
    if marked {
        let _: () = conn
            .expire(&key, ttl_secs as i64)
            .await
            .map_err(|e| AppError::Internal(format!("Moderation cooldown expire failed: {e}")))?;
    }
    Ok(marked)
}

async fn count_sliding_window(
    redis: &redis::Client,
    key: String,
    window: Duration,
) -> Result<isize, AppError> {
    let mut conn = redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Moderation Redis connection failed: {e}")))?;
    let now_ms = now_epoch_millis();
    let cutoff = now_ms.saturating_sub(window.as_millis() as i64);
    let redis_key = moderation_key(&key);

    let _: () = conn
        .zrembyscore(&redis_key, "-inf", cutoff)
        .await
        .map_err(|e| AppError::Internal(format!("Moderation window cleanup failed: {e}")))?;
    let _: () = conn
        .zadd(&redis_key, now_ms, now_ms)
        .await
        .map_err(|e| AppError::Internal(format!("Moderation window record failed: {e}")))?;
    let count: isize = conn
        .zcard(&redis_key)
        .await
        .map_err(|e| AppError::Internal(format!("Moderation window count failed: {e}")))?;
    let ttl_secs = window.as_secs().saturating_add(60).max(1);
    let _: () = conn
        .expire(&redis_key, ttl_secs as i64)
        .await
        .map_err(|e| AppError::Internal(format!("Moderation window expire failed: {e}")))?;
    Ok(count)
}

async fn log_raid_event(
    db: &PgPool,
    actor_id: Uuid,
    server_id: Uuid,
    event_type: &str,
    user_id: Option<Uuid>,
    channel_id: Option<Uuid>,
    metadata: serde_json::Value,
) -> Result<(), AppError> {
    let event_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO server_raid_events (id, server_id, event_type, user_id, channel_id, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())"#,
    )
    .bind(event_id)
    .bind(server_id)
    .bind(event_type)
    .bind(user_id)
    .bind(channel_id)
    .bind(&metadata)
    .execute(db)
    .await?;

    audit::log(
        db,
        actor_id,
        Some(server_id),
        &format!("raid_{event_type}"),
        "raid_event",
        Some(event_id),
        Some(metadata),
    )
    .await?;
    Ok(())
}

pub async fn active_timeout_until(
    db: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<Option<DateTime<Utc>>, AppError> {
    let until = sqlx::query_scalar::<_, DateTime<Utc>>(
        r#"SELECT timed_out_until
           FROM server_member_timeouts
           WHERE server_id = $1
             AND user_id = $2
             AND timed_out_until > NOW()"#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    Ok(until)
}

pub async fn ensure_not_timed_out(
    db: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    if let Some(until) = active_timeout_until(db, server_id, user_id).await? {
        return Err(AppError::Forbidden(format!(
            "You are timed out until {}",
            until.to_rfc3339()
        )));
    }
    Ok(())
}

pub async fn enforce_message_raid_protection(
    redis: &redis::Client,
    db: &PgPool,
    server_id: Uuid,
    channel_id: Uuid,
    user_id: Uuid,
    content: &str,
) -> Result<(), AppError> {
    let message_count = count_sliding_window(
        redis,
        format!("message_burst:{server_id}:{user_id}"),
        Duration::from_secs(10),
    )
    .await?;

    if message_count >= 12 {
        if try_mark_raid_cooldown(redis, server_id, "message_burst", Some(user_id), 60).await? {
            log_raid_event(
                db,
                user_id,
                server_id,
                "message_burst",
                Some(user_id),
                Some(channel_id),
                serde_json::json!({ "window_seconds": 10, "message_count": message_count }),
            )
            .await?;
        }
        return Err(AppError::TooManyRequests(
            "Message burst detected. Please slow down.".into(),
        ));
    }

    if has_invite_link(content) {
        let invite_count = count_sliding_window(
            redis,
            format!("invite_spike:{server_id}:{user_id}"),
            Duration::from_secs(60),
        )
        .await?;
        if invite_count >= 3 {
            if try_mark_raid_cooldown(redis, server_id, "invite_spike", Some(user_id), 60).await? {
                log_raid_event(
                    db,
                    user_id,
                    server_id,
                    "invite_spike",
                    Some(user_id),
                    Some(channel_id),
                    serde_json::json!({ "window_seconds": 60, "invite_count": invite_count }),
                )
                .await?;
            }
            return Err(AppError::TooManyRequests(
                "Invite burst detected. Please slow down.".into(),
            ));
        }
    }

    Ok(())
}

pub async fn record_join_raid_signal(
    redis: &redis::Client,
    db: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
    client_ip: Option<String>,
) -> Result<(), AppError> {
    let (join_count, new_account_join_count) = sqlx::query_as::<_, (i64, i64)>(
        r#"SELECT
              COUNT(*) FILTER (WHERE sm.joined_at > NOW() - INTERVAL '5 minutes') AS join_count,
              COUNT(*) FILTER (
                  WHERE sm.joined_at > NOW() - INTERVAL '5 minutes'
                    AND u.created_at > NOW() - INTERVAL '24 hours'
              ) AS new_account_join_count
           FROM server_members sm
           INNER JOIN users u ON u.id = sm.user_id
           WHERE sm.server_id = $1"#,
    )
    .bind(server_id)
    .fetch_one(db)
    .await?;

    if join_count >= 10
        && try_mark_raid_cooldown(redis, server_id, "join_burst", None, 300).await?
    {
        log_raid_event(
            db,
            user_id,
            server_id,
            "join_burst",
            Some(user_id),
            None,
            serde_json::json!({
                "window_minutes": 5,
                "join_count": join_count,
                "client_ip": client_ip,
            }),
        )
        .await?;
    }

    if new_account_join_count >= 5
        && try_mark_raid_cooldown(redis, server_id, "new_account_join_burst", None, 300).await?
    {
        log_raid_event(
            db,
            user_id,
            server_id,
            "new_account_join_burst",
            Some(user_id),
            None,
            serde_json::json!({
                "window_minutes": 5,
                "new_account_join_count": new_account_join_count,
                "account_age_window_hours": 24,
                "client_ip": client_ip,
            }),
        )
        .await?;
    }

    Ok(())
}

pub async fn list_active_timeouts(
    db: &PgPool,
    server_id: Uuid,
) -> Result<Vec<ServerTimeoutEntry>, AppError> {
    let rows = sqlx::query_as::<_, ServerTimeoutEntry>(
        r#"SELECT smt.server_id,
                  smt.user_id,
                  target.username,
                  smt.timed_out_until,
                  smt.timeout_by,
                  moderator.username AS timeout_by_username,
                  smt.reason,
                  smt.created_at,
                  smt.updated_at
           FROM server_member_timeouts smt
           INNER JOIN users target ON target.id = smt.user_id
           LEFT JOIN users moderator ON moderator.id = smt.timeout_by
           WHERE smt.server_id = $1
             AND smt.timed_out_until > NOW()
           ORDER BY smt.timed_out_until DESC"#,
    )
    .bind(server_id)
    .fetch_all(db)
    .await?;
    Ok(rows)
}

pub async fn list_raid_events(
    db: &PgPool,
    server_id: Uuid,
) -> Result<Vec<RaidEventEntry>, AppError> {
    let rows = sqlx::query_as::<_, RaidEventEntry>(
        r#"SELECT sre.id,
                  sre.server_id,
                  sre.event_type,
                  sre.user_id,
                  u.username,
                  sre.channel_id,
                  c.name AS channel_name,
                  sre.metadata,
                  sre.created_at
           FROM server_raid_events sre
           LEFT JOIN users u ON u.id = sre.user_id
           LEFT JOIN channels c ON c.id = sre.channel_id
           WHERE sre.server_id = $1
           ORDER BY sre.created_at DESC
           LIMIT 100"#,
    )
    .bind(server_id)
    .fetch_all(db)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_discord_invites() {
        assert!(has_invite_link("join discord.gg/abc"));
        assert!(has_invite_link("https://discord.com/invite/abc"));
        assert!(!has_invite_link("https://example.com"));
    }
}
