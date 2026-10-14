//! Releases uploads that no message uses: the row and the stored file are deleted and the size
//! is returned to the owner's storage quota.
//!
//! Deleting a message (directly or with its channel or server) marks its files for a check in
//! the database (migration 055). A file is released only when no server or direct message
//! references it and it was last uploaded longer ago than [`UNUSED_UPLOAD_GRACE`], so the files
//! of a message that is still being written are kept.

use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{errors::AppError, services::attachments::AttachmentService};

/// How long an upload that no message uses is kept after it was last uploaded.
pub const UNUSED_UPLOAD_GRACE: Duration = Duration::from_secs(24 * 60 * 60);

/// Uploads checked per call; callers repeat while a full batch was checked.
pub const RELEASE_BATCH_SIZE: usize = 200;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ReleaseOutcome {
    pub checked: usize,
    pub released: usize,
}

#[derive(sqlx::FromRow)]
struct ReleaseCandidate {
    id: Uuid,
    user_id: Uuid,
    storage_backend: String,
    storage_key: String,
    size_bytes: i64,
    scan_status: String,
    last_claimed_at: DateTime<Utc>,
}

/// Upload ids referenced by a message's stored `attachments` value.
pub fn attachment_ids(attachments: Option<&Value>) -> Vec<Uuid> {
    attachments
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id")?.as_str()?.parse().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Checks the uploads that are due (or only `only`, e.g. the files of a message just deleted),
/// releases the unused ones and removes their files after the commit.
pub async fn release_unused_uploads(
    db: &PgPool,
    attachment_service: &AttachmentService,
    only: Option<&[Uuid]>,
) -> Result<ReleaseOutcome, AppError> {
    let mut tx = db.begin().await?;
    // SKIP LOCKED lets several server instances sweep at once, and an upload that is being
    // reused right now is left for the next run.
    let candidates = sqlx::query_as::<_, ReleaseCandidate>(
        r#"SELECT id, user_id, storage_backend, storage_key, size_bytes, scan_status,
                  last_claimed_at
           FROM uploaded_attachments
           WHERE release_check_at <= NOW()
             AND ($1::uuid[] IS NULL OR id = ANY($1))
           ORDER BY release_check_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED"#,
    )
    .bind(only)
    .bind(RELEASE_BATCH_SIZE as i64)
    .fetch_all(&mut *tx)
    .await?;

    let grace = chrono::Duration::from_std(UNUSED_UPLOAD_GRACE)
        .map_err(|e| AppError::Internal(format!("Invalid upload grace period: {e}")))?;
    let now = Utc::now();
    let mut outcome = ReleaseOutcome {
        checked: candidates.len(),
        released: 0,
    };
    let mut released_local_keys = Vec::new();
    for candidate in candidates {
        let keep_until = candidate.last_claimed_at + grace;
        if keep_until > now {
            sqlx::query("UPDATE uploaded_attachments SET release_check_at = $2 WHERE id = $1")
                .bind(candidate.id)
                .bind(keep_until)
                .execute(&mut *tx)
                .await?;
            continue;
        }

        let in_use = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS (
                   SELECT 1 FROM messages
                   WHERE attachments @> jsonb_build_array(jsonb_build_object('id', $1::text))
               ) OR EXISTS (
                   SELECT 1 FROM dm_messages
                   WHERE attachments @> jsonb_build_array(jsonb_build_object('id', $1::text))
               )"#,
        )
        .bind(candidate.id.to_string())
        .fetch_one(&mut *tx)
        .await?;
        if in_use {
            sqlx::query("UPDATE uploaded_attachments SET release_check_at = NULL WHERE id = $1")
                .bind(candidate.id)
                .execute(&mut *tx)
                .await?;
            continue;
        }

        sqlx::query("DELETE FROM uploaded_attachments WHERE id = $1")
            .bind(candidate.id)
            .execute(&mut *tx)
            .await?;
        if candidate.scan_status == "clean" {
            sqlx::query(
                r#"UPDATE users
                   SET storage_used_bytes = GREATEST(storage_used_bytes - $2, 0)
                   WHERE id = $1"#,
            )
            .bind(candidate.user_id)
            .bind(candidate.size_bytes)
            .execute(&mut *tx)
            .await?;
        }
        if candidate.storage_backend == "local" {
            released_local_keys.push(candidate.storage_key);
        }
        outcome.released += 1;
    }
    tx.commit().await?;

    for storage_key in released_local_keys {
        if let Err(error) = attachment_service
            .delete_local_file_by_storage_key(&storage_key)
            .await
        {
            tracing::warn!(error = %error, "Failed to remove a released upload file");
        }
    }
    Ok(outcome)
}

/// Releases unused uploads until no full batch is left (bounded per call).
pub async fn release_due_uploads(
    db: &PgPool,
    attachment_service: &AttachmentService,
) -> Result<usize, AppError> {
    let mut released = 0;
    for _ in 0..20 {
        let outcome = release_unused_uploads(db, attachment_service, None).await?;
        released += outcome.released;
        if outcome.checked < RELEASE_BATCH_SIZE {
            break;
        }
    }
    Ok(released)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_upload_ids_from_stored_attachments() {
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let stored = serde_json::json!([
            { "id": first.to_string(), "name": "a.png" },
            { "url": "https://example.test/uploads/legacy.png" },
            { "id": "not-a-uuid" },
            "unexpected",
            { "id": second.to_string() },
        ]);
        assert_eq!(attachment_ids(Some(&stored)), vec![first, second]);
        assert!(attachment_ids(None).is_empty());
        assert!(attachment_ids(Some(&serde_json::json!({ "id": first.to_string() }))).is_empty());
    }
}
