//! Uploaded avatars live in the attachment file storage, on disk or in a bucket. `users.avatar_url`
//! then holds `file:<version>`: the version is what clients see in the image URL, and the
//! `avatar_file_*` columns say where the file is.

use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::services::attachment_release::{delete_queued_files, queue_file_deletions};
use crate::services::attachments::AttachmentService;
use crate::services::avatar_images::{decode_stored_image_data_url, sniff_image_type};

pub const STORED_AVATAR_PREFIX: &str = "file:";

/// Data URLs moved per pass of the background job.
const MOVE_BATCH_SIZE: i64 = 50;

pub struct StoredAvatar {
    /// The value for `users.avatar_url`.
    pub avatar_url: String,
    pub backend: &'static str,
    pub key: String,
}

async fn store_data_url(
    attachments: &AttachmentService,
    data_url: &str,
    version: Option<&str>,
) -> Result<StoredAvatar, AppError> {
    let (content_type, bytes) = decode_stored_image_data_url(data_url)
        .ok_or_else(|| AppError::Validation("Avatar image is not valid".into()))?;
    let stored = attachments
        .store_generated_file("avatar", content_type, bytes)
        .await?;
    let version = version.unwrap_or(&stored.sha256[..16]);
    Ok(StoredAvatar {
        avatar_url: format!("{STORED_AVATAR_PREFIX}{version}"),
        backend: stored.storage_backend,
        key: stored.storage_key,
    })
}

/// Stores an uploaded `data:` image that passed validation.
pub async fn store_avatar(
    attachments: &AttachmentService,
    data_url: &str,
) -> Result<StoredAvatar, AppError> {
    store_data_url(attachments, data_url, None).await
}

/// The stored image and the type its content has.
pub async fn read_avatar(
    attachments: &AttachmentService,
    backend: &str,
    key: &str,
) -> Result<(&'static str, Vec<u8>), AppError> {
    let bytes = attachments.read_attachment_bytes(backend, key).await?;
    let content_type =
        sniff_image_type(&bytes).ok_or_else(|| AppError::NotFound("Avatar not found".into()))?;
    Ok((content_type, bytes))
}

/// Moves avatars still stored as data URLs into file storage (bounded per call). They keep their
/// version, so URLs clients have cached stay valid. A row changed meanwhile keeps its new value.
pub async fn move_data_url_avatars(
    db: &PgPool,
    attachments: &AttachmentService,
) -> Result<usize, AppError> {
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        r#"SELECT id, avatar_url, avatar_version
           FROM users
           WHERE avatar_url LIKE 'data:%'
           ORDER BY id
           LIMIT $1"#,
    )
    .bind(MOVE_BATCH_SIZE)
    .fetch_all(db)
    .await?;

    let mut moved = 0;
    for (user_id, data_url, version) in rows {
        // An image that cannot be decoded was never servable; it stays as it is.
        let Ok(stored) = store_data_url(attachments, &data_url, Some(&version)).await else {
            continue;
        };
        let updated = sqlx::query(
            r#"UPDATE users
               SET avatar_url = $1, avatar_file_backend = $2, avatar_file_key = $3
               WHERE id = $4 AND avatar_url = $5"#,
        )
        .bind(&stored.avatar_url)
        .bind(stored.backend)
        .bind(&stored.key)
        .bind(user_id)
        .bind(&data_url)
        .execute(db)
        .await?;
        if updated.rows_affected() == 1 {
            moved += 1;
            continue;
        }
        let keys = [stored.key];
        let mut tx = db.begin().await?;
        queue_file_deletions(&mut tx, &keys).await?;
        tx.commit().await?;
        delete_queued_files(db, attachments, &keys).await;
    }
    Ok(moved)
}
