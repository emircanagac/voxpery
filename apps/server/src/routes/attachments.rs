use std::{sync::Arc, time::Duration};

use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    middleware,
    response::IntoResponse,
    routing::{get, post},
    Extension, Json, Router,
};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    services::{
        attachments::AttachmentResponseItem,
        permissions::{self, Permissions},
        rate_limit::enforce_rate_limit,
    },
    AppState,
};

const FREE_TIER_STORAGE_QUOTA_BYTES: i64 = 1_073_741_824; // 1 GiB
const ATTACHMENT_CONTENT_USER_RATE_LIMIT_MAX: usize = 240;
const ATTACHMENT_CONTENT_ITEM_RATE_LIMIT_MAX: usize = 30;
const ATTACHMENT_CONTENT_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    let protected = Router::new()
        .route("/upload", post(upload_attachments))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    let content = Router::new()
        .route("/content/{attachment_id}", get(get_attachment_content))
        .route_layer(middleware::from_fn_with_state(state, require_auth));

    protected.merge(content)
}

fn should_force_attachment_download(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    ct.contains("image/svg")
        || ct.contains("text/html")
        || ct.contains("application/xhtml")
        || ct.contains("text/xml")
        || ct.contains("application/xml")
        || ct.contains("+xml")
}

fn sanitize_content_disposition_filename(name: &str) -> String {
    let mut sanitized = String::with_capacity(name.len().min(64));
    for ch in name.chars().take(64) {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            sanitized.push(ch);
        } else {
            sanitized.push('_');
        }
    }
    let trimmed = sanitized.trim_matches('_').trim();
    if trimmed.is_empty() {
        "attachment.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

/// POST /api/attachments/upload
/// Accepts multipart form-data with one or more `files` fields and returns safe public URLs.
async fn upload_attachments(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    mut multipart: Multipart,
) -> Result<Json<Vec<AttachmentResponseItem>>, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("attachments:upload:{}", claims.sub),
        20,
        Duration::from_secs(60),
        "Attachment upload rate limit exceeded. Please slow down.",
    )
    .await?;

    let mut tx = state.db.begin().await?;
    let mut stored_keys = Vec::new();
    let upload_result = process_attachment_upload(
        &state,
        claims.sub,
        &mut multipart,
        &mut tx,
        &mut stored_keys,
    )
    .await;

    match upload_result {
        Ok(uploaded) => {
            if let Err(error) = tx.commit().await {
                cleanup_failed_upload_files(&state, &stored_keys).await;
                return Err(error.into());
            }
            Ok(Json(uploaded))
        }
        Err(error) => {
            if let Err(rollback_error) = tx.rollback().await {
                tracing::error!(
                    user_id = %claims.sub,
                    error = %rollback_error,
                    "Failed to roll back attachment upload transaction"
                );
            }
            cleanup_failed_upload_files(&state, &stored_keys).await;
            Err(error)
        }
    }
}

async fn process_attachment_upload(
    state: &Arc<AppState>,
    user_id: Uuid,
    multipart: &mut Multipart,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stored_keys: &mut Vec<String>,
) -> Result<Vec<AttachmentResponseItem>, AppError> {
    let mut uploaded = Vec::<AttachmentResponseItem>::new();
    let mut file_count = 0usize;
    let max_files = state.attachment_service.max_files_per_request();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Invalid multipart payload: {e}")))?
    {
        let Some(file_name) = field.file_name().map(|v| v.to_string()) else {
            continue;
        };
        let field_name = field.name().unwrap_or_default();
        if !field_name.is_empty() && field_name != "files" {
            continue;
        }

        file_count += 1;
        if file_count > max_files {
            return Err(AppError::Validation(format!(
                "At most {max_files} files can be uploaded per request"
            )));
        }

        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::Validation(format!("Failed to read uploaded file: {e}")))?;
        let prepared = state
            .attachment_service
            .prepare_file_for_storage(&file_name, &content_type, &bytes)
            .await?;

        let reserve_result = sqlx::query_scalar::<_, Uuid>(
            r#"UPDATE users
               SET storage_used_bytes = storage_used_bytes + $1
               WHERE id = $2
                 AND storage_used_bytes + $1 <= $3
               RETURNING id"#,
        )
        .bind(prepared.size_bytes)
        .bind(user_id)
        .bind(FREE_TIER_STORAGE_QUOTA_BYTES)
        .fetch_optional(&mut **tx)
        .await?;

        if reserve_result.is_none() {
            return Err(AppError::Validation(
                "Storage quota exceeded (1 GB). Delete old files or upgrade your plan.".into(),
            ));
        }

        let stored = state
            .attachment_service
            .store_prepared_file(prepared)
            .await?;
        stored_keys.push(stored.storage_key.clone());

        let attachment_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO uploaded_attachments (
                   id,
                   user_id,
                   storage_backend,
                   storage_key,
                   original_name,
                   content_type,
                   size_bytes,
                   sha256,
                   scan_status,
                   created_at
               )
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'clean',NOW())"#,
        )
        .bind(attachment_id)
        .bind(user_id)
        .bind(stored.storage_backend)
        .bind(&stored.storage_key)
        .bind(&stored.original_name)
        .bind(&stored.content_type)
        .bind(stored.size_bytes)
        .bind(&stored.sha256)
        .execute(&mut **tx)
        .await?;

        uploaded.push(AttachmentResponseItem {
            id: attachment_id,
            url: state
                .attachment_service
                .signed_content_url(attachment_id, &state.jwt_secret),
            content_type: stored.content_type,
            name: stored.original_name,
            size: stored.size_bytes,
            sha256: stored.sha256,
        });
    }

    if uploaded.is_empty() {
        return Err(AppError::Validation(
            "No files received. Use multipart field name 'files'.".into(),
        ));
    }

    Ok(uploaded)
}

async fn cleanup_failed_upload_files(state: &Arc<AppState>, stored_keys: &[String]) {
    for storage_key in stored_keys.iter().rev() {
        if let Err(error) = state
            .attachment_service
            .delete_local_file_by_storage_key(storage_key)
            .await
        {
            tracing::error!(
                storage_key,
                error = %error,
                "Failed to clean up attachment after upload rollback"
            );
        }
    }
}

#[derive(Debug, serde::Deserialize)]
struct AttachmentContentQuery {
    exp: i64,
    sig: String,
}

async fn get_attachment_content(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(attachment_id): Path<Uuid>,
    Query(query): Query<AttachmentContentQuery>,
) -> Result<impl IntoResponse, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("attachments:content:user:{}", claims.sub),
        ATTACHMENT_CONTENT_USER_RATE_LIMIT_MAX,
        ATTACHMENT_CONTENT_RATE_LIMIT_WINDOW,
        "Attachment content rate limit exceeded. Please retry shortly.",
    )
    .await?;
    enforce_rate_limit(
        &state.redis,
        format!(
            "attachments:content:item:{}:{}",
            claims.sub, attachment_id
        ),
        ATTACHMENT_CONTENT_ITEM_RATE_LIMIT_MAX,
        ATTACHMENT_CONTENT_RATE_LIMIT_WINDOW,
        "Attachment content rate limit exceeded. Please retry shortly.",
    )
    .await?;

    let allowed = state.attachment_service.verify_signed_content_url(
        attachment_id,
        query.exp,
        &query.sig,
        &state.jwt_secret,
    );
    if !allowed {
        return Err(AppError::Forbidden("Attachment access denied".into()));
    }
    ensure_attachment_view_access(&state, claims.sub, attachment_id).await?;

    let row = state
        .attachment_service
        .get_clean_attachment_by_id(&state.db, attachment_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;

    let file = state
        .attachment_service
        .open_local_attachment_file(&row.storage_key)
        .await?;

    let content_type = HeaderValue::from_str(&row.content_type)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, content_type);
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=300, immutable"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    if let Ok(content_length) = HeaderValue::from_str(&row.size_bytes.to_string()) {
        headers.insert(header::CONTENT_LENGTH, content_length);
    }
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; sandbox"),
    );

    if should_force_attachment_download(&row.content_type) {
        let safe_name = sanitize_content_disposition_filename(&row.original_name);
        let disposition = format!("attachment; filename=\"{}\"", safe_name);
        let value = HeaderValue::from_str(&disposition)
            .unwrap_or_else(|_| HeaderValue::from_static("attachment"));
        headers.insert(header::CONTENT_DISPOSITION, value);
    }

    let stream = ReaderStream::new(file);
    Ok((headers, Body::from_stream(stream)))
}

async fn ensure_attachment_view_access(
    state: &Arc<AppState>,
    viewer_id: Uuid,
    attachment_id: Uuid,
) -> Result<(), AppError> {
    let attachment_id_text = attachment_id.to_string();

    let owned = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM uploaded_attachments ua
               WHERE ua.id = $1 AND ua.user_id = $2 AND ua.scan_status = 'clean'
           )"#,
    )
    .bind(attachment_id)
    .bind(viewer_id)
    .fetch_one(&state.db)
    .await?;
    if owned {
        return Ok(());
    }

    let channel_ids = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT DISTINCT m.channel_id
           FROM messages m
           WHERE m.attachments @> jsonb_build_array(jsonb_build_object('id', $1::text))"#,
    )
    .bind(&attachment_id_text)
    .fetch_all(&state.db)
    .await?;
    for channel_id in channel_ids {
        let perms =
            permissions::get_user_channel_permissions(&state.db, channel_id, viewer_id).await?;
        if perms.contains(Permissions::VIEW_SERVER) {
            return Ok(());
        }
    }

    let has_dm_access = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM dm_messages m
               INNER JOIN dm_channel_members dcm
                       ON dcm.channel_id = m.channel_id
                      AND dcm.user_id = $2
               WHERE m.attachments @> jsonb_build_array(jsonb_build_object('id', $1::text))
           )"#,
    )
    .bind(&attachment_id_text)
    .bind(viewer_id)
    .fetch_one(&state.db)
    .await?;
    if has_dm_access {
        return Ok(());
    }

    Err(AppError::Forbidden(
        "You do not have permission to view this attachment".into(),
    ))
}
