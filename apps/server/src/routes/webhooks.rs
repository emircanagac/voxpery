use axum::{
    extract::{Path, State},
    middleware,
    routing::{get, patch},
    Extension, Json, Router,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    services::permissions::{self, Permissions},
    AppState,
};

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ServerWebhook {
    id: Uuid,
    server_id: Uuid,
    channel_id: Option<Uuid>,
    name: String,
    target_url: String,
    created_by: Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, serde::Deserialize)]
struct CreateWebhookRequest {
    name: String,
    target_url: String,
    channel_id: Option<Uuid>,
}

#[derive(Debug, serde::Deserialize)]
struct UpdateWebhookRequest {
    name: Option<String>,
    target_url: Option<String>,
    channel_id: Option<Uuid>,
    clear_channel: Option<bool>,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/server/{server_id}",
            get(list_webhooks).post(create_webhook),
        )
        .route(
            "/{webhook_id}",
            patch(update_webhook).delete(delete_webhook),
        )
        .route_layer(middleware::from_fn_with_state(state, require_auth))
}

async fn list_webhooks(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<ServerWebhook>>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_WEBHOOKS,
    )
    .await?;

    let rows = sqlx::query_as::<_, ServerWebhook>(
        r#"SELECT id, server_id, channel_id, name, target_url, created_by, created_at, updated_at
           FROM server_webhooks
           WHERE server_id = $1
           ORDER BY created_at DESC"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

async fn create_webhook(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateWebhookRequest>,
) -> Result<Json<ServerWebhook>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_WEBHOOKS,
    )
    .await?;

    let name = body.name.trim();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::Validation(
            "Webhook name must be 1-100 characters".into(),
        ));
    }
    validate_target_url(&body.target_url)?;

    if let Some(channel_id) = body.channel_id {
        ensure_channel_belongs_server(&state.db, channel_id, server_id).await?;
    }

    let row = sqlx::query_as::<_, ServerWebhook>(
        r#"INSERT INTO server_webhooks (id, server_id, channel_id, name, target_url, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           RETURNING id, server_id, channel_id, name, target_url, created_by, created_at, updated_at"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(body.channel_id)
    .bind(name)
    .bind(body.target_url.trim())
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(row))
}

async fn update_webhook(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(webhook_id): Path<Uuid>,
    Json(body): Json<UpdateWebhookRequest>,
) -> Result<Json<ServerWebhook>, AppError> {
    let server_id: Uuid = sqlx::query_scalar("SELECT server_id FROM server_webhooks WHERE id = $1")
        .bind(webhook_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Webhook not found".into()))?;

    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_WEBHOOKS,
    )
    .await?;

    let mut new_name: Option<String> = None;
    if let Some(name) = body.name.as_deref() {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.len() > 100 {
            return Err(AppError::Validation(
                "Webhook name must be 1-100 characters".into(),
            ));
        }
        new_name = Some(trimmed.to_string());
    }

    let mut new_target_url: Option<String> = None;
    if let Some(url) = body.target_url.as_deref() {
        validate_target_url(url)?;
        new_target_url = Some(url.trim().to_string());
    }

    let mut new_channel_id: Option<Uuid> = body.channel_id;
    if body.clear_channel.unwrap_or(false) {
        new_channel_id = None;
    } else if let Some(channel_id) = new_channel_id {
        ensure_channel_belongs_server(&state.db, channel_id, server_id).await?;
    }

    let row = sqlx::query_as::<_, ServerWebhook>(
        r#"UPDATE server_webhooks
           SET name = COALESCE($2, name),
               target_url = COALESCE($3, target_url),
               channel_id = CASE WHEN $4 THEN NULL ELSE COALESCE($5, channel_id) END,
               updated_at = NOW()
           WHERE id = $1
           RETURNING id, server_id, channel_id, name, target_url, created_by, created_at, updated_at"#,
    )
    .bind(webhook_id)
    .bind(new_name)
    .bind(new_target_url)
    .bind(body.clear_channel.unwrap_or(false))
    .bind(new_channel_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(row))
}

async fn delete_webhook(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(webhook_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let server_id: Uuid = sqlx::query_scalar("SELECT server_id FROM server_webhooks WHERE id = $1")
        .bind(webhook_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Webhook not found".into()))?;

    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_WEBHOOKS,
    )
    .await?;

    sqlx::query("DELETE FROM server_webhooks WHERE id = $1")
        .bind(webhook_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "message": "Webhook deleted" })))
}

fn validate_target_url(url: &str) -> Result<(), AppError> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > 2000 {
        return Err(AppError::Validation(
            "Webhook URL must be 1-2000 characters".into(),
        ));
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(AppError::Validation(
            "Webhook URL must start with http:// or https://".into(),
        ));
    }
    Ok(())
}

async fn ensure_channel_belongs_server(
    db: &sqlx::PgPool,
    channel_id: Uuid,
    server_id: Uuid,
) -> Result<(), AppError> {
    let exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE id = $1 AND server_id = $2")
            .bind(channel_id)
            .bind(server_id)
            .fetch_one(db)
            .await?;
    if exists == 0 {
        return Err(AppError::Validation(
            "Channel does not belong to this server".into(),
        ));
    }
    Ok(())
}
