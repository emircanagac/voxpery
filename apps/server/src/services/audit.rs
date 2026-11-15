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
    log_voice_moderation_in_transaction(
        &mut tx,
        actor_id,
        server_id,
        target_user_id,
        channel_id,
        reason,
        entries,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn log_voice_moderation_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
    server_id: Uuid,
    target_user_id: Uuid,
    channel_id: Uuid,
    reason: Option<&str>,
    entries: &[VoiceModerationAuditEntry],
) -> Result<(), sqlx::Error> {
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
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Audit records older than this are deleted; the privacy notice states the same period.
pub const AUDIT_LOG_RETENTION_DAYS: i32 = 180;
/// Rows removed per statement by the retention delete, so it never holds a long lock.
const RETENTION_DELETE_BATCH: i64 = 5000;
/// Upper bound of batches per run; the next run continues where this one stopped.
const RETENTION_MAX_BATCHES_PER_RUN: usize = 40;

/// Removes the quoted text from the edit records of one message. Runs in the transaction that
/// deletes the message, so the quote never outlives it.
pub async fn clear_message_edit_previews(
    tx: &mut Transaction<'_, Postgres>,
    message_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE audit_log
           SET details = details - 'before_preview' - 'after_preview'
           WHERE action = 'message_edit' AND resource_id = $1"#,
    )
    .bind(message_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Removes every quote of the account's message text from the audit log: the edit records of
/// its messages and the text AutoMod blocked. Runs in the account-deletion transaction, before
/// the messages are deleted and before the account's records move to the placeholder account.
pub async fn clear_author_previews(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE audit_log
           SET details = details - 'before_preview' - 'after_preview'
           WHERE action = 'message_edit'
             AND resource_id IN (SELECT id FROM messages WHERE user_id = $1)"#,
    )
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        r#"UPDATE audit_log
           SET details = details - 'content_preview' - 'matched_value'
           WHERE action = 'automod_message_block' AND actor_id = $1"#,
    )
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Periodic cleanup. Messages also disappear with their channel or server, which no single
/// handler sees, so edit records whose message is gone lose their quoted text here. Records
/// older than the retention period are deleted. Returns (records cleared, records deleted).
pub async fn purge_stale(db: &PgPool) -> Result<(u64, u64), sqlx::Error> {
    let cleared = sqlx::query(
        r#"UPDATE audit_log a
           SET details = a.details - 'before_preview' - 'after_preview'
           WHERE a.action = 'message_edit'
             AND a.details ?| ARRAY['before_preview', 'after_preview']
             AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = a.resource_id)"#,
    )
    .execute(db)
    .await?
    .rows_affected();

    let mut deleted = 0;
    for _ in 0..RETENTION_MAX_BATCHES_PER_RUN {
        let batch = sqlx::query(
            r#"DELETE FROM audit_log
               WHERE id IN (
                   SELECT id FROM audit_log
                   WHERE at < NOW() - make_interval(days => $1)
                   LIMIT $2
               )"#,
        )
        .bind(AUDIT_LOG_RETENTION_DAYS)
        .bind(RETENTION_DELETE_BATCH)
        .execute(db)
        .await?
        .rows_affected();
        deleted += batch;
        if batch < RETENTION_DELETE_BATCH as u64 {
            break;
        }
    }
    Ok((cleared, deleted))
}
