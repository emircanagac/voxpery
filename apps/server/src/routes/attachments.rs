use std::{sync::Arc, time::Duration};

use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    middleware,
    response::IntoResponse,
    routing::{get, post},
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
    let protected = Router::new()
        .route("/upload", post(upload_attachments))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    let content = Router::new().route("/content/{attachment_id}", get(get_attachment_content));

    protected.merge(content)
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

    Ok(Json(uploaded))
}

#[derive(Debug, serde::Deserialize)]
struct AttachmentContentQuery {
    exp: i64,
    sig: String,
}

async fn get_attachment_content(
    State(state): State<Arc<AppState>>,
    Path(attachment_id): Path<Uuid>,
    Query(query): Query<AttachmentContentQuery>,
) -> Result<impl IntoResponse, AppError> {
    let allowed = state.attachment_service.verify_signed_content_url(
        attachment_id,
        query.exp,
        &query.sig,
        &state.jwt_secret,
    );
    if !allowed {
        return Err(AppError::Forbidden("Attachment access denied".into()));
    }

    let row = state
        .attachment_service
        .get_clean_attachment_by_id(&state.db, attachment_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;

    let bytes = state
        .attachment_service
        .read_local_attachment_bytes(&row.storage_key)
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

    Ok((headers, bytes))
}
