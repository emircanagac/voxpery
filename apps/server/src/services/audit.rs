//! Moderation-critical audit log: who did what and when.

use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub const VOICE_MEMBER_MUTE: &str = "voice_member_mute";
pub const VOICE_MEMBER_UNMUTE: &str = "voice_member_unmute";
pub const VOICE_MEMBER_DEAFEN: &str = "voice_member_deafen";
pub const VOICE_MEMBER_UNDEAFEN: &str = "voice_member_undeafen";
pub const VOICE_MEMBER_DISCONNECT: &str = "voice_member_disconnect";
pub const VOICE_MEMBER_MOVE: &str = "voice_member_move";

pub struct VoiceModerationAuditEntry {
    pub action: &'static str,
    pub details: serde_json::Value,
}

/// Insert an audit log entry. Caller must provide valid server_id where applicable.
pub async fn log(
    db: &PgPool,
    actor_id: Uuid,
    server_id: Option<Uuid>,
    action: &str,
    resource_type: &str,
    resource_id: Option<Uuid>,
    details: Option<serde_json::Value>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO audit_log (actor_id, server_id, action, resource_type, resource_id, details)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(actor_id)
    .bind(server_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(details)
    .execute(db)
    .await?;
    Ok(())
}

/// Insert an audit entry as part of an existing database transaction.
pub async fn log_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
    server_id: Option<Uuid>,
    action: &str,
    resource_type: &str,
    resource_id: Option<Uuid>,
    details: Option<serde_json::Value>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO audit_log (actor_id, server_id, action, resource_type, resource_id, details)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(actor_id)
    .bind(server_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(details)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Persist one server-enforced voice moderation action before changing runtime state.
pub async fn log_voice_moderation(
    db: &PgPool,
    actor_id: Uuid,
    server_id: Uuid,
    target_user_id: Uuid,
    channel_id: Uuid,
    reason: Option<&str>,
    entries: &[VoiceModerationAuditEntry],
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    for entry in entries {
        sqlx::query(
            r#"INSERT INTO audit_log
               (actor_id, server_id, action, resource_type, resource_id, channel_id, reason, details)
               VALUES ($1, $2, $3, 'member', $4, $5, $6, $7)"#,
        )
        .bind(actor_id)
        .bind(server_id)
        .bind(entry.action)
        .bind(target_user_id)
        .bind(channel_id)
        .bind(reason)
        .bind(&entry.details)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
