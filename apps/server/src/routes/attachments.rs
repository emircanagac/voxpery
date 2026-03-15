use std::{sync::Arc, time::Duration};

use axum::{
    extract::{Multipart, State},
    middleware,
    routing::post,
    Extension, Json, Router,
};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    services::{attachments::AttachmentResponseItem, rate_limit::enforce_rate_limit},
    AppState,
};

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/upload", post(upload_attachments))
        .route_layer(middleware::from_fn_with_state(state, require_auth))
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

        let stored = state
            .attachment_service
            .store_file(&file_name, &content_type, &bytes)
            .await?;

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
        .bind(Uuid::new_v4())
        .bind(claims.sub)
        .bind(stored.storage_backend)
        .bind(&stored.storage_key)
        .bind(&stored.original_name)
        .bind(&stored.content_type)
        .bind(stored.size_bytes)
        .bind(&stored.sha256)
        .execute(&state.db)
        .await?;

        uploaded.push(AttachmentResponseItem {
            url: stored.url,
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

    Ok(Json(uploaded))
}
