use axum::{
    extract::{Path, Query, State},
    middleware,
    routing::{delete, get, patch, post, put},
    Extension, Json, Router,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    models::Channel,
    services::audit,
    services::permissions::{self, Permissions},
    ws::WsEvent,
    AppState,
};

const MAX_CHANNEL_NAME_CHARS: usize = 32;
const MAX_CATEGORY_NAME_CHARS: usize = 32;
const MAX_CHANNEL_DESCRIPTION_CHARS: usize = 120;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/server/{server_id}/categories",
            get(list_categories).post(create_category),
        )
        .route(
            "/server/{server_id}/categories/{category}",
            delete(delete_category).patch(rename_category),
        )
        .route(
            "/server/{server_id}/categories/{category}/overrides",
            get(list_category_overrides),
        )
        .route(
            "/server/{server_id}/categories/{category}/overrides/{role_id}",
            put(update_category_override).delete(delete_category_override),
        )
        .route(
            "/server/{server_id}/categories/reorder",
            patch(reorder_categories),
        )
        .route("/{channel_id}", delete(delete_channel))
        .route("/{channel_id}", patch(rename_channel))
        .route("/{channel_id}/overrides", get(list_channel_overrides))
        .route(
            "/{channel_id}/overrides/{role_id}",
            put(update_channel_override).delete(delete_channel_override),
        )
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
    permissions::ensure_server_permission(
        &state.db,
        body.server_id,
        claims.sub,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    let trimmed_name = body.name.trim();
    validate_channel_name(trimmed_name)?;
    let description = normalize_channel_description(body.description.as_deref())?;

    let channel_type = body.channel_type.unwrap_or_else(|| "text".to_string());
    if channel_type != "text" && channel_type != "voice" {
        return Err(AppError::Validation(
            "Channel type must be 'text' or 'voice'".into(),
        ));
    }
    let category_input = body
        .category
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("General")
        .to_string();
    let category = ensure_category_exists(&state.db, body.server_id, &category_input).await?;
    ensure_channel_name_unique(
        &state.db,
        body.server_id,
        &channel_type,
        Some(&category),
        trimmed_name,
        None,
    )
    .await?;

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
        r#"INSERT INTO channels (id, server_id, name, description, channel_type, category, position, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           RETURNING *"#,
    )
    .bind(Uuid::new_v4())
    .bind(body.server_id)
    .bind(trimmed_name)
    .bind(&description)
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
        Some(serde_json::json!({ "name": channel.name, "description": channel.description, "type": channel.channel_type, "category": channel.category })),
    )
    .await?;

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated {
        server_id: body.server_id,
    });

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

    // Require MANAGE_CHANNELS permission on this channel.
    permissions::ensure_channel_permission(
        &state.db,
        channel_id,
        claims.sub,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

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

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated {
        server_id: channel.server_id,
    });

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

    ensure_channel_manage_permission_for_channel(&state, channel_id, claims.sub).await?;

    let trimmed = body.name.trim();
    // Keep backwards compatibility with legacy channel names that may no longer satisfy
    // current rules when only moving categories.
    if trimmed != channel.name.trim() {
        validate_channel_name(trimmed)?;
    }
    let next_description = normalize_channel_description(body.description.as_deref())?;

    let mut next_category = body
        .category
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or_else(|| channel.category.clone());
    if let Some(category_name) = &next_category {
        let canonical = ensure_category_exists(&state.db, channel.server_id, category_name).await?;
        next_category = Some(canonical);
    }
    ensure_channel_name_unique(
        &state.db,
        channel.server_id,
        &channel.channel_type,
        next_category.as_deref(),
        trimmed,
        Some(channel_id),
    )
    .await?;

    let updated = sqlx::query_as::<_, Channel>(
        "UPDATE channels SET name = $1, description = $2, category = $3 WHERE id = $4 RETURNING *",
    )
    .bind(trimmed)
    .bind(&next_description)
    .bind(&next_category)
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
        Some(serde_json::json!({
            "old_name": channel.name,
            "new_name": updated.name,
            "old_description": channel.description,
            "new_description": updated.description,
            "old_category": channel.category,
            "new_category": updated.category,
        })),
    )
    .await?;

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated {
        server_id: channel.server_id,
    });

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
        return Err(AppError::Validation("channel_ids cannot be empty".into()));
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
        existing.insert(ch.id, ch.category.unwrap_or_else(|| "General".to_string()));
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
            .unwrap_or_else(|| "General".to_string());
        let pos = position_map.entry(category).or_insert(0);
        sqlx::query("UPDATE channels SET position = $1 WHERE id = $2")
            .bind(*pos)
            .bind(channel_id)
            .execute(&mut *tx)
            .await?;
        *pos += 1;
    }
    tx.commit().await?;

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated {
        server_id: body.server_id,
    });

    Ok(Json(serde_json::json!({ "message": "Channels reordered" })))
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ChannelOverride {
    role_id: Uuid,
    allow: i64,
    deny: i64,
}

#[derive(Debug, serde::Deserialize)]
struct UpdateChannelOverrideRequest {
    allow: i64,
    deny: i64,
}

/// GET /api/channels/:channel_id/overrides — list role overrides for a channel.
async fn list_channel_overrides(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Vec<ChannelOverride>>, AppError> {
    let _channel = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Channel not found".into()))?;

    ensure_channel_manage_permission_for_channel(&state, channel_id, claims.sub).await?;

    let overrides = sqlx::query_as::<_, ChannelOverride>(
        "SELECT role_id, allow, deny FROM channel_role_overrides WHERE channel_id = $1",
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(overrides))
}

/// PUT /api/channels/:channel_id/overrides/:role_id — update or create a role override for a channel.
async fn update_channel_override(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((channel_id, role_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateChannelOverrideRequest>,
) -> Result<Json<ChannelOverride>, AppError> {
    let channel = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Channel not found".into()))?;

    ensure_channel_manage_permission_for_channel(&state, channel_id, claims.sub).await?;

    let role_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_roles WHERE id = $1 AND server_id = $2",
    )
    .bind(role_id)
    .bind(channel.server_id)
    .fetch_one(&state.db)
    .await?;

    if role_exists == 0 {
        return Err(AppError::NotFound("Role not found in this server".into()));
    }

    let ov = sqlx::query_as::<_, ChannelOverride>(
        r#"INSERT INTO channel_role_overrides (channel_id, role_id, allow, deny)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (channel_id, role_id)
           DO UPDATE SET allow = EXCLUDED.allow, deny = EXCLUDED.deny
           RETURNING role_id, allow, deny"#,
    )
    .bind(channel_id)
    .bind(role_id)
    .bind(body.allow)
    .bind(body.deny)
    .fetch_one(&state.db)
    .await?;

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated {
        server_id: channel.server_id,
    });

    Ok(Json(ov))
}

/// DELETE /api/channels/:channel_id/overrides/:role_id — delete a role override for a channel.
async fn delete_channel_override(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((channel_id, role_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _channel = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Channel not found".into()))?;

    ensure_channel_manage_permission_for_channel(&state, channel_id, claims.sub).await?;

    sqlx::query("DELETE FROM channel_role_overrides WHERE channel_id = $1 AND role_id = $2")
        .bind(channel_id)
        .bind(role_id)
        .execute(&state.db)
        .await?;

    let server_id = sqlx::query_scalar::<_, Uuid>("SELECT server_id FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
    let _ = state.tx.send(WsEvent::ServerChannelsUpdated { server_id });

    Ok(Json(serde_json::json!({ "message": "Override deleted" })))
}

#[derive(Debug, serde::Serialize)]
struct CategoryNameResponse {
    name: String,
}

#[derive(Debug, serde::Deserialize)]
struct CreateCategoryRequest {
    name: String,
}

#[derive(Debug, serde::Deserialize)]
struct RenameCategoryRequest {
    name: String,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct CategoryOverride {
    role_id: Uuid,
    allow: i64,
    deny: i64,
}

#[derive(Debug, serde::Deserialize)]
struct UpdateCategoryOverrideRequest {
    allow: i64,
    deny: i64,
}

#[derive(Debug, serde::Deserialize)]
struct ReorderCategoriesRequest {
    category_names: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
struct DeleteCategoryQuery {
    move_to: Option<String>,
}

async fn list_categories(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<CategoryNameResponse>>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::VIEW_SERVER,
    )
    .await?;

    backfill_category_rows(&state.db, server_id).await?;

    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM server_channel_categories WHERE server_id = $1 ORDER BY position, name",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    // Managers should always see all categories, including empty ones.
    let server_perms =
        permissions::get_user_server_permissions(&state.db, server_id, claims.sub).await?;
    if server_perms.contains(Permissions::MANAGE_CHANNELS) {
        return Ok(Json(
            rows.into_iter()
                .map(|name| CategoryNameResponse { name })
                .collect(),
        ));
    }

    // Return categories that are visible by effective category-level permission,
    // including empty categories (important for newly created categories).
    let mut visible_categories = std::collections::HashSet::new();
    for category_name in &rows {
        let perms = permissions::get_user_category_permissions(
            &state.db,
            server_id,
            category_name,
            claims.sub,
        )
        .await?;
        if perms.contains(Permissions::VIEW_SERVER) {
            visible_categories.insert(category_name.clone());
        }
    }

    Ok(Json(
        rows.into_iter()
            .filter(|name| visible_categories.contains(name))
            .map(|name| CategoryNameResponse { name })
            .collect(),
    ))
}

async fn create_category(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateCategoryRequest>,
) -> Result<Json<CategoryNameResponse>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    let name = body.name.trim();
    validate_category_name(name)?;

    backfill_category_rows(&state.db, server_id).await?;

    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_channel_categories WHERE server_id = $1 AND LOWER(name) = LOWER($2)",
    )
    .bind(server_id)
    .bind(name)
    .fetch_one(&state.db)
    .await?;
    if exists > 0 {
        return Err(AppError::Validation("Category already exists".into()));
    }

    let canonical = ensure_category_exists(&state.db, server_id, name).await?;

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated { server_id });

    Ok(Json(CategoryNameResponse { name: canonical }))
}

async fn delete_category(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category)): Path<(Uuid, String)>,
    Query(query): Query<DeleteCategoryQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    let category = category.trim();
    if category.is_empty() {
        return Err(AppError::Validation("Category name is required".into()));
    }

    let mut tx = state.db.begin().await?;

    // Move channels out of this category into uncategorized space.
    // They must remain in the server and appear at the top of uncategorized list.
    let moving_channel_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND category = $2 ORDER BY position",
    )
    .bind(server_id)
    .bind(category)
    .fetch_all(&mut *tx)
    .await?;

    let mut move_to = query
        .move_to
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .and_then(|target| {
            if target.eq_ignore_ascii_case(category) {
                None
            } else {
                Some(target)
            }
        })
        .unwrap_or_else(|| "General".to_string());

    // Never move channels back into the same category being deleted.
    // If no alternative category exists and the category still has channels,
    // block deletion instead of silently creating legacy fallback categories.
    if !moving_channel_ids.is_empty() && move_to.eq_ignore_ascii_case(category) {
        let alternative: Option<String> = sqlx::query_scalar(
            "SELECT name FROM server_channel_categories WHERE server_id = $1 AND LOWER(name) <> LOWER($2) ORDER BY position, name LIMIT 1",
        )
        .bind(server_id)
        .bind(category)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(name) = alternative {
            move_to = name;
        } else {
            return Err(AppError::Validation(
                "Cannot delete this category while it still has channels".into(),
            ));
        }
    }

    if !moving_channel_ids.is_empty() {
        let move_to = ensure_category_exists(&state.db, server_id, &move_to).await?;

        let max_target_pos = sqlx::query_scalar::<_, Option<i32>>(
            "SELECT MAX(position) FROM channels WHERE server_id = $1 AND category = $2",
        )
        .bind(server_id)
        .bind(&move_to)
        .fetch_one(&mut *tx)
        .await?
        .unwrap_or(-1);

        for (idx, channel_id) in moving_channel_ids.iter().enumerate() {
            sqlx::query("UPDATE channels SET category = $1, position = $2 WHERE id = $3")
                .bind(&move_to)
                .bind(max_target_pos + idx as i32 + 1)
                .bind(channel_id)
                .execute(&mut *tx)
                .await?;
        }
    }

    sqlx::query("DELETE FROM server_channel_categories WHERE server_id = $1 AND name = $2")
        .bind(server_id)
        .bind(category)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated { server_id });

    Ok(Json(serde_json::json!({ "message": "Category deleted" })))
}

async fn rename_category(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category)): Path<(Uuid, String)>,
    Json(body): Json<RenameCategoryRequest>,
) -> Result<Json<CategoryNameResponse>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    let old_name = category.trim();
    if old_name.is_empty() {
        return Err(AppError::Validation("Category name is required".into()));
    }

    let new_name = body.name.trim();
    validate_category_name(new_name)?;
    if new_name == old_name {
        return Ok(Json(CategoryNameResponse {
            name: new_name.to_string(),
        }));
    }

    backfill_category_rows(&state.db, server_id).await?;

    let old_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_channel_categories WHERE server_id = $1 AND name = $2",
    )
    .bind(server_id)
    .bind(old_name)
    .fetch_one(&state.db)
    .await?;

    if old_exists == 0 {
        return Err(AppError::NotFound("Category not found".into()));
    }

    let new_exists = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*)
           FROM server_channel_categories
           WHERE server_id = $1
             AND LOWER(name) = LOWER($2)
             AND name <> $3"#,
    )
    .bind(server_id)
    .bind(new_name)
    .bind(old_name)
    .fetch_one(&state.db)
    .await?;

    if new_exists > 0 {
        return Err(AppError::Validation("Category already exists".into()));
    }

    let mut tx = state.db.begin().await?;

    sqlx::query(
        "UPDATE server_channel_categories SET name = $1 WHERE server_id = $2 AND name = $3",
    )
    .bind(new_name)
    .bind(server_id)
    .bind(old_name)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE channels SET category = $1 WHERE server_id = $2 AND category = $3")
        .bind(new_name)
        .bind(server_id)
        .bind(old_name)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        "UPDATE channel_category_role_overrides SET category = $1 WHERE server_id = $2 AND category = $3",
    )
    .bind(new_name)
    .bind(server_id)
    .bind(old_name)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "category_rename",
        "category",
        None,
        Some(serde_json::json!({
            "old_name": old_name,
            "new_name": new_name
        })),
    )
    .await?;

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated { server_id });

    Ok(Json(CategoryNameResponse {
        name: new_name.to_string(),
    }))
}

async fn list_category_overrides(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category)): Path<(Uuid, String)>,
) -> Result<Json<Vec<CategoryOverride>>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    let category = category.trim();
    if category.is_empty() {
        return Err(AppError::Validation("Category name is required".into()));
    }

    let overrides = sqlx::query_as::<_, CategoryOverride>(
        r#"SELECT role_id, allow, deny
           FROM channel_category_role_overrides
           WHERE server_id = $1 AND category = $2"#,
    )
    .bind(server_id)
    .bind(category)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(overrides))
}

async fn update_category_override(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category, role_id)): Path<(Uuid, String, Uuid)>,
    Json(body): Json<UpdateCategoryOverrideRequest>,
) -> Result<Json<CategoryOverride>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    let category = category.trim();
    if category.is_empty() {
        return Err(AppError::Validation("Category name is required".into()));
    }
    let category = ensure_category_exists(&state.db, server_id, category).await?;

    let role_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_roles WHERE id = $1 AND server_id = $2",
    )
    .bind(role_id)
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    if role_exists == 0 {
        return Err(AppError::NotFound("Role not found in this server".into()));
    }

    let ov = sqlx::query_as::<_, CategoryOverride>(
        r#"INSERT INTO channel_category_role_overrides (server_id, category, role_id, allow, deny)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (server_id, category, role_id)
           DO UPDATE SET allow = EXCLUDED.allow, deny = EXCLUDED.deny
           RETURNING role_id, allow, deny"#,
    )
    .bind(server_id)
    .bind(&category)
    .bind(role_id)
    .bind(body.allow)
    .bind(body.deny)
    .fetch_one(&state.db)
    .await?;

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated { server_id });

    Ok(Json(ov))
}

async fn delete_category_override(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category, role_id)): Path<(Uuid, String, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    let category = category.trim();
    if category.is_empty() {
        return Err(AppError::Validation("Category name is required".into()));
    }

    sqlx::query(
        "DELETE FROM channel_category_role_overrides WHERE server_id = $1 AND category = $2 AND role_id = $3"
    )
    .bind(server_id)
    .bind(category)
    .bind(role_id)
    .execute(&state.db)
    .await?;

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated { server_id });

    Ok(Json(serde_json::json!({ "message": "Override deleted" })))
}

async fn reorder_categories(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<ReorderCategoriesRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_CHANNELS,
    )
    .await?;

    if body.category_names.is_empty() {
        return Err(AppError::Validation(
            "category_names cannot be empty".into(),
        ));
    }

    backfill_category_rows(&state.db, server_id).await?;

    let existing: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM server_channel_categories WHERE server_id = $1 ORDER BY position, name",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    if existing.len() != body.category_names.len() {
        return Err(AppError::Validation(
            "category_names must include every category in the server".into(),
        ));
    }

    let mut set = std::collections::HashSet::new();
    for name in &body.category_names {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("Category name cannot be empty".into()));
        }
        if !set.insert(trimmed.to_string()) {
            return Err(AppError::Validation(
                "Duplicate category names are not allowed".into(),
            ));
        }
    }

    let existing_set: std::collections::HashSet<String> = existing.into_iter().collect();
    if set != existing_set {
        return Err(AppError::Validation(
            "category_names includes unknown category names".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    for (idx, name) in body.category_names.iter().enumerate() {
        sqlx::query(
            "UPDATE server_channel_categories SET position = $1 WHERE server_id = $2 AND name = $3",
        )
        .bind(idx as i32)
        .bind(server_id)
        .bind(name.trim())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    let _ = state.tx.send(WsEvent::ServerChannelsUpdated { server_id });

    Ok(Json(
        serde_json::json!({ "message": "Categories reordered" }),
    ))
}

async fn ensure_channel_manage_permission(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        user_id,
        Permissions::MANAGE_CHANNELS,
    )
    .await
}

async fn ensure_channel_manage_permission_for_channel(
    state: &AppState,
    channel_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    permissions::ensure_channel_permission(
        &state.db,
        channel_id,
        user_id,
        Permissions::MANAGE_CHANNELS,
    )
    .await
}

async fn ensure_category_exists(
    db: &sqlx::PgPool,
    server_id: Uuid,
    category: &str,
) -> Result<String, AppError> {
    let name = category.trim();
    validate_category_name(name)?;

    backfill_category_rows(db, server_id).await?;

    let existing: Option<String> = sqlx::query_scalar(
        "SELECT name FROM server_channel_categories WHERE server_id = $1 AND LOWER(name) = LOWER($2) ORDER BY name LIMIT 1",
    )
    .bind(server_id)
    .bind(name)
    .fetch_optional(db)
    .await?;
    if let Some(existing_name) = existing {
        return Ok(existing_name);
    }

    let max_pos = sqlx::query_scalar::<_, Option<i32>>(
        "SELECT MAX(position) FROM server_channel_categories WHERE server_id = $1",
    )
    .bind(server_id)
    .fetch_one(db)
    .await?
    .unwrap_or(-1);

    sqlx::query(
        r#"INSERT INTO server_channel_categories (server_id, name, position)
           VALUES ($1, $2, $3)
           ON CONFLICT (server_id, name) DO NOTHING"#,
    )
    .bind(server_id)
    .bind(name)
    .bind(max_pos + 1)
    .execute(db)
    .await?;

    Ok(name.to_string())
}

async fn backfill_category_rows(db: &sqlx::PgPool, server_id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        r#"
        WITH base AS (
            SELECT COALESCE(MAX(position), -1) AS max_pos
            FROM server_channel_categories
            WHERE server_id = $1
        ),
        missing AS (
            SELECT c.category AS name, MIN(c.position) AS min_pos
            FROM channels c
            LEFT JOIN server_channel_categories scc
              ON scc.server_id = $1
             AND scc.name = c.category
            WHERE c.server_id = $1
              AND c.category IS NOT NULL
              AND BTRIM(c.category) <> ''
              AND scc.name IS NULL
            GROUP BY c.category
        ),
        ranked AS (
            SELECT name, ROW_NUMBER() OVER (ORDER BY min_pos, name) AS rn
            FROM missing
        )
        INSERT INTO server_channel_categories (server_id, name, position)
        SELECT $1, r.name, (SELECT max_pos FROM base) + r.rn
        FROM ranked r
        ON CONFLICT (server_id, name) DO NOTHING
        "#,
    )
    .bind(server_id)
    .execute(db)
    .await?;

    Ok(())
}

fn validate_channel_name(name: &str) -> Result<(), AppError> {
    let len = name.chars().count();
    if len == 0 || len > MAX_CHANNEL_NAME_CHARS {
        return Err(AppError::Validation(format!(
            "Channel name must be 1-{} characters",
            MAX_CHANNEL_NAME_CHARS
        )));
    }

    let mut last_was_space = false;
    for c in name.chars() {
        let allowed = c.is_alphanumeric() || c == ' ' || c == '-' || c == '_';
        if !allowed {
            return Err(AppError::Validation(
                "Channel name can only include letters, numbers, spaces, '-' and '_'".into(),
            ));
        }
        if c == ' ' {
            if last_was_space {
                return Err(AppError::Validation(
                    "Channel name cannot contain consecutive spaces".into(),
                ));
            }
            last_was_space = true;
        } else {
            last_was_space = false;
        }
    }

    Ok(())
}

fn normalize_channel_description(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    let len = value.chars().count();
    if len > MAX_CHANNEL_DESCRIPTION_CHARS {
        return Err(AppError::Validation(format!(
            "Channel description must be {} characters or fewer",
            MAX_CHANNEL_DESCRIPTION_CHARS
        )));
    }

    Ok(Some(value.to_string()))
}

fn validate_category_name(name: &str) -> Result<(), AppError> {
    let len = name.chars().count();
    if len == 0 || len > MAX_CATEGORY_NAME_CHARS {
        return Err(AppError::Validation(format!(
            "Category name must be 1-{} characters",
            MAX_CATEGORY_NAME_CHARS
        )));
    }

    let mut last_was_space = false;
    for c in name.chars() {
        let allowed = c.is_alphanumeric() || c == ' ' || c == '-' || c == '_';
        if !allowed {
            return Err(AppError::Validation(
                "Category name can only include letters, numbers, spaces, '-' and '_'".into(),
            ));
        }
        if c == ' ' {
            if last_was_space {
                return Err(AppError::Validation(
                    "Category name cannot contain consecutive spaces".into(),
                ));
            }
            last_was_space = true;
        } else {
            last_was_space = false;
        }
    }

    Ok(())
}

async fn ensure_channel_name_unique(
    db: &sqlx::PgPool,
    server_id: Uuid,
    channel_type: &str,
    category: Option<&str>,
    name: &str,
    exclude_channel_id: Option<Uuid>,
) -> Result<(), AppError> {
    let exists = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM channels
        WHERE server_id = $1
          AND channel_type = $2
          AND LOWER(COALESCE(category, '')) = LOWER(COALESCE($3, ''))
          AND LOWER(name) = LOWER($4)
          AND ($5::UUID IS NULL OR id <> $5)
        "#,
    )
    .bind(server_id)
    .bind(channel_type)
    .bind(category)
    .bind(name)
    .bind(exclude_channel_id)
    .fetch_one(db)
    .await?;

    if exists > 0 {
        return Err(AppError::Validation(
            "A channel with this name already exists in this category and channel type".into(),
        ));
    }

    Ok(())
}

/// Extended request that includes server_id.
#[derive(Debug, serde::Deserialize)]
struct CreateChannelWithServer {
    pub server_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub channel_type: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct RenameChannelRequest {
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ReorderChannelsRequest {
    pub server_id: Uuid,
    pub channel_ids: Vec<Uuid>,
}
