use axum::{
    extract::{Path, State},
    middleware,
    routing::{delete, patch, post},
    Extension, Json, Router,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    models::Channel,
    services::{audit, permissions::{self, Permissions}},
    AppState,
};

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/{channel_id}", delete(delete_channel))
        .route("/{channel_id}", patch(rename_channel))
        .route("/reorder", patch(reorder_channels))
        .route("/", post(create_channel))
        .route_layer(middleware::from_fn_with_state(state, require_auth))
}

/// POST /api/channels — create a channel in a server.
async fn create_channel(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateChannelWithServer>,
) -> Result<Json<Channel>, AppError> {
    // Require MANAGE_CHANNELS permission to create channels.
    permissions::ensure_server_permission(&state.db, body.server_id, claims.sub, Permissions::MANAGE_CHANNELS).await?;

    if body.name.is_empty() || body.name.len() > 100 {
        return Err(AppError::Validation("Channel name must be 1-100 characters".into()));
    }

    let channel_type = body.channel_type.unwrap_or_else(|| "text".to_string());
    if channel_type != "text" && channel_type != "voice" {
        return Err(AppError::Validation("Channel type must be 'text' or 'voice'".into()));
    }
    let category = body.category.unwrap_or_else(|| {
        if channel_type == "voice" {
            "Voice Channels".to_string()
        } else {
            "Text Channels".to_string()
        }
    });

    // Get next position
    let max_pos = sqlx::query_scalar::<_, Option<i32>>(
        "SELECT MAX(position) FROM channels WHERE server_id = $1 AND category = $2",
    )
    .bind(body.server_id)
    .bind(&category)
    .fetch_one(&state.db)
    .await?
    .unwrap_or(-1);

    let channel = sqlx::query_as::<_, Channel>(
        r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           RETURNING *"#,
    )
    .bind(Uuid::new_v4())
    .bind(body.server_id)
    .bind(&body.name)
    .bind(&channel_type)
    .bind(&category)
    .bind(max_pos + 1)
    .fetch_one(&state.db)
    .await?;

    crate::services::audit::log(
        &state.db,
        claims.sub,
        Some(body.server_id),
        "channel_create",
        "channel",
        Some(channel.id),
        Some(serde_json::json!({ "name": channel.name, "type": channel.channel_type, "category": channel.category })),
    )
    .await?;

    Ok(Json(channel))
}

/// DELETE /api/channels/:channel_id — delete a channel.
async fn delete_channel(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let channel = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Channel not found".into()))?;

    // Require MANAGE_CHANNELS permission to delete channels.
    permissions::ensure_server_permission(&state.db, channel.server_id, claims.sub, Permissions::MANAGE_CHANNELS).await?;

    // Keep at least one text channel in a server to avoid a broken server state.
    if channel.channel_type == "text" {
        let text_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM channels WHERE server_id = $1 AND channel_type = 'text'",
        )
        .bind(channel.server_id)
        .fetch_one(&state.db)
        .await?;
        if text_count <= 1 {
            return Err(AppError::Validation(
                "Cannot delete the last text channel in a server".into(),
            ));
        }
    }

    audit::log(
        &state.db,
        claims.sub,
        Some(channel.server_id),
        "channel_delete",
        "channel",
        Some(channel_id),
        Some(serde_json::json!({ "name": channel.name })),
    )
    .await?;

    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(channel_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "message": "Channel deleted" })))
}

/// PATCH /api/channels/:channel_id — rename a channel.
async fn rename_channel(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<RenameChannelRequest>,
) -> Result<Json<Channel>, AppError> {
    let channel = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Channel not found".into()))?;

    ensure_channel_manage_permission(&state, channel.server_id, claims.sub).await?;

    let trimmed = body.name.trim();
    if trimmed.is_empty() || trimmed.len() > 100 {
        return Err(AppError::Validation(
            "Channel name must be 1-100 characters".into(),
        ));
    }

    let updated = sqlx::query_as::<_, Channel>(
        "UPDATE channels SET name = $1 WHERE id = $2 RETURNING *",
    )
    .bind(trimmed)
    .bind(channel_id)
    .fetch_one(&state.db)
    .await?;

    crate::services::audit::log(
        &state.db,
        claims.sub,
        Some(channel.server_id),
        "channel_rename",
        "channel",
        Some(channel_id),
        Some(serde_json::json!({ "old_name": channel.name, "new_name": updated.name })),
    )
    .await?;

    Ok(Json(updated))
}

/// PATCH /api/channels/reorder — update channel positions for a server.
async fn reorder_channels(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<ReorderChannelsRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    ensure_channel_manage_permission(&state, body.server_id, claims.sub).await?;

    if body.channel_ids.is_empty() {
        return Err(AppError::Validation(
            "channel_ids cannot be empty".into(),
        ));
    }

    let channels = sqlx::query_as::<_, Channel>(
        "SELECT * FROM channels WHERE server_id = $1 ORDER BY category, position",
    )
    .bind(body.server_id)
    .fetch_all(&state.db)
    .await?;

    if channels.len() != body.channel_ids.len() {
        return Err(AppError::Validation(
            "channel_ids must include every channel in the server".into(),
        ));
    }

    use std::collections::HashMap;
    let mut existing: HashMap<Uuid, String> = HashMap::new();
    for ch in channels {
        existing.insert(ch.id, ch.category.unwrap_or_else(|| "Channels".to_string()));
    }

    for cid in &body.channel_ids {
        if !existing.contains_key(cid) {
            return Err(AppError::Validation(
                "channel_ids includes unknown channel id".into(),
            ));
        }
    }

    let mut tx = state.db.begin().await?;
    let mut position_map: HashMap<String, i32> = HashMap::new();
    for channel_id in &body.channel_ids {
        let category = existing
            .get(channel_id)
            .cloned()
            .unwrap_or_else(|| "Channels".to_string());
        let pos = position_map.entry(category).or_insert(0);
        sqlx::query("UPDATE channels SET position = $1 WHERE id = $2")
            .bind(*pos)
            .bind(channel_id)
            .execute(&mut *tx)
            .await?;
        *pos += 1;
    }
    tx.commit().await?;

    Ok(Json(serde_json::json!({ "message": "Channels reordered" })))
}

async fn ensure_channel_manage_permission(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    permissions::ensure_server_permission(&state.db, server_id, user_id, Permissions::MANAGE_CHANNELS).await
}

/// Extended request that includes server_id.
#[derive(Debug, serde::Deserialize)]
struct CreateChannelWithServer {
    pub server_id: Uuid,
    pub name: String,
    pub channel_type: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct RenameChannelRequest {
    pub name: String,
}

#[derive(Debug, serde::Deserialize)]
struct ReorderChannelsRequest {
    pub server_id: Uuid,
    pub channel_ids: Vec<Uuid>,
}
