use axum::{
    extract::{Path, Query, State},
    middleware,
    routing::{delete, get},
    Extension, Json, Router,
};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    models::{
        EditMessageRequest, MessageAuthor, MessageQuery, MessageWithAuthor, SendMessageRequest,
    },
    services::{
        attachments::validate_attachments,
        permissions::{self, Permissions},
        rate_limit::enforce_rate_limit,
    },
    ws::WsEvent,
    AppState,
};

#[derive(Debug, serde::Deserialize)]
struct PinMessageRequest {
    message_id: Uuid,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/item/{message_id}",
            delete(delete_message).patch(edit_message),
        )
        .route("/{channel_id}/search", get(search_messages))
        .route(
            "/{channel_id}/pins",
            get(list_channel_pins).post(pin_channel_message),
        )
        .route(
            "/{channel_id}/pins/{message_id}",
            delete(unpin_channel_message),
        )
        .route("/{channel_id}", get(get_messages).post(send_message))
        .route_layer(middleware::from_fn_with_state(state, require_auth))
}

fn escape_ilike_pattern(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[derive(Debug, serde::Deserialize)]
struct MessageSearchQuery {
    q: Option<String>,
    limit: Option<i64>,
}

/// Intermediate row type for JOIN query result
#[derive(sqlx::FromRow)]
struct MessageRow {
    id: Uuid,
    channel_id: Uuid,
    content: String,
    attachments: Option<serde_json::Value>,
    edited_at: Option<chrono::DateTime<chrono::Utc>>,
    created_at: chrono::DateTime<chrono::Utc>,
    user_id: Uuid,
    username: String,
    avatar_url: Option<String>,
    role_color: Option<String>,
}

impl From<MessageRow> for MessageWithAuthor {
    fn from(row: MessageRow) -> Self {
        Self {
            id: row.id,
            channel_id: row.channel_id,
            content: row.content,
            attachments: row.attachments,
            edited_at: row.edited_at,
            created_at: row.created_at,
            author: MessageAuthor {
                user_id: row.user_id,
                username: row.username,
                avatar_url: row.avatar_url,
                role_color: row.role_color,
            },
        }
    }
}

/// GET /api/messages/:channel_id?before=uuid&limit=50 — get paginated messages.
/// Uses a single JOIN query instead of N+1 author lookups.
async fn get_messages(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<MessageQuery>,
) -> Result<Json<Vec<MessageWithAuthor>>, AppError> {
    check_channel_access(&state, channel_id, claims.sub).await?;

    let limit = query.limit.unwrap_or(50).min(100);

    let rows: Vec<MessageRow> = if let Some(before) = query.before {
        sqlx::query_as::<_, MessageRow>(
            r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                      u.id as user_id, u.username, u.avatar_url,
                      (
                          SELECT sr.color 
                          FROM server_roles sr 
                          INNER JOIN server_member_roles smr ON sr.id = smr.role_id 
                          INNER JOIN channels c ON c.server_id = sr.server_id
                          WHERE smr.user_id = m.user_id 
                            AND c.id = m.channel_id
                            AND sr.color IS NOT NULL 
                          ORDER BY sr.position ASC 
                          LIMIT 1
                      ) as role_color
               FROM messages m
               INNER JOIN users u ON m.user_id = u.id
               WHERE m.channel_id = $1
                 AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)
               ORDER BY m.created_at DESC
               LIMIT $3"#,
        )
        .bind(channel_id)
        .bind(before)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, MessageRow>(
            r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                      u.id as user_id, u.username, u.avatar_url,
                      (
                          SELECT sr.color 
                          FROM server_roles sr 
                          INNER JOIN server_member_roles smr ON sr.id = smr.role_id 
                          INNER JOIN channels c ON c.server_id = sr.server_id
                          WHERE smr.user_id = m.user_id 
                            AND c.id = m.channel_id
                            AND sr.color IS NOT NULL 
                          ORDER BY sr.position ASC 
                          LIMIT 1
                      ) as role_color
               FROM messages m
               INNER JOIN users u ON m.user_id = u.id
               WHERE m.channel_id = $1
               ORDER BY m.created_at DESC
               LIMIT $2"#,
        )
        .bind(channel_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    // Reverse to chronological order and convert to MessageWithAuthor
    let result: Vec<MessageWithAuthor> = rows.into_iter().rev().map(Into::into).collect();

    Ok(Json(result))
}

/// GET /api/messages/:channel_id/search?q=...&limit=100 — search messages in a channel.
async fn search_messages(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<MessageSearchQuery>,
) -> Result<Json<Vec<MessageWithAuthor>>, AppError> {
    check_channel_access(&state, channel_id, claims.sub).await?;

    let term = query.q.as_deref().unwrap_or("").trim();
    if term.is_empty() {
        return Ok(Json(vec![]));
    }
    let limit = query.limit.unwrap_or(100).min(200);
    let escaped_term = escape_ilike_pattern(term);
    let pattern = format!("%{}%", escaped_term);

    let rows = sqlx::query_as::<_, MessageRow>(
        r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                  u.id as user_id, u.username, u.avatar_url,
                  (
                      SELECT sr.color 
                      FROM server_roles sr 
                      INNER JOIN server_member_roles smr ON sr.id = smr.role_id 
                      INNER JOIN channels c ON c.server_id = sr.server_id
                      WHERE smr.user_id = m.user_id 
                        AND c.id = m.channel_id
                        AND sr.color IS NOT NULL 
                      ORDER BY sr.position ASC 
                      LIMIT 1
                  ) as role_color
           FROM messages m
           INNER JOIN users u ON m.user_id = u.id
           WHERE m.channel_id = $1
             AND m.content ILIKE $2 ESCAPE '\'
           ORDER BY m.created_at DESC
           LIMIT $3"#,
    )
    .bind(channel_id)
    .bind(&pattern)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<MessageWithAuthor> = rows.into_iter().rev().map(Into::into).collect();
    Ok(Json(result))
}

/// GET /api/messages/:channel_id/pins — list pinned messages.
async fn list_channel_pins(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Vec<MessageWithAuthor>>, AppError> {
    check_channel_access(&state, channel_id, claims.sub).await?;

    let rows = sqlx::query_as::<_, MessageRow>(
        r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                  u.id as user_id, u.username, u.avatar_url,
                  (
                      SELECT sr.color 
                      FROM server_roles sr 
                      INNER JOIN server_member_roles smr ON sr.id = smr.role_id 
                      INNER JOIN channels c ON c.server_id = sr.server_id
                      WHERE smr.user_id = m.user_id 
                        AND c.id = m.channel_id
                        AND sr.color IS NOT NULL 
                      ORDER BY sr.position ASC 
                      LIMIT 1
                  ) as role_color,
                  (
                      SELECT sr.color 
                      FROM server_roles sr 
                      INNER JOIN server_member_roles smr ON sr.id = smr.role_id 
                      INNER JOIN channels c ON c.server_id = sr.server_id
                      WHERE smr.user_id = m.user_id 
                        AND c.id = m.channel_id
                        AND sr.color IS NOT NULL 
                      ORDER BY sr.position ASC 
                      LIMIT 1
                  ) as role_color
           FROM channel_pins p
           INNER JOIN messages m ON p.message_id = m.id
           INNER JOIN users u ON m.user_id = u.id
           WHERE p.channel_id = $1
           ORDER BY p.pinned_at DESC"#,
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<MessageWithAuthor> = rows.into_iter().map(Into::into).collect();
    Ok(Json(result))
}

/// POST /api/messages/:channel_id/pins — pin a message (server owner/admin only).
async fn pin_channel_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<PinMessageRequest>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    check_channel_access(&state, channel_id, claims.sub).await?;
    permissions::ensure_channel_permission(
        &state.db,
        channel_id,
        claims.sub,
        Permissions::MANAGE_PINS,
    )
    .await?;

    let msg_channel: Option<Uuid> =
        sqlx::query_scalar("SELECT channel_id FROM messages WHERE id = $1")
            .bind(body.message_id)
            .fetch_optional(&state.db)
            .await?;

    let msg_channel = msg_channel.ok_or_else(|| AppError::NotFound("Message not found".into()))?;
    if msg_channel != channel_id {
        return Err(AppError::Forbidden("Message is not in this channel".into()));
    }

    sqlx::query(
        r#"INSERT INTO channel_pins (channel_id, message_id, pinned_by_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (channel_id, message_id) DO NOTHING"#,
    )
    .bind(channel_id)
    .bind(body.message_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    // We need server_id to log this
    let server_id: Uuid = sqlx::query_scalar("SELECT server_id FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;

    crate::services::audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "message_pin",
        "message",
        Some(body.message_id),
        Some(serde_json::json!({ "channel_id": channel_id })),
    )
    .await?;

    let row = sqlx::query_as::<_, MessageRow>(
        r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                  u.id as user_id, u.username, u.avatar_url,
                  (
                      SELECT sr.color 
                      FROM server_roles sr 
                      INNER JOIN server_member_roles smr ON sr.id = smr.role_id 
                      INNER JOIN channels c ON c.server_id = sr.server_id
                      WHERE smr.user_id = m.user_id 
                        AND c.id = m.channel_id
                        AND sr.color IS NOT NULL 
                      ORDER BY sr.position ASC 
                      LIMIT 1
                  ) as role_color
           FROM messages m
           INNER JOIN users u ON m.user_id = u.id
           WHERE m.id = $1"#,
    )
    .bind(body.message_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    Ok(Json(row.into()))
}

/// DELETE /api/messages/:channel_id/pins/:message_id — unpin a message (server owner/admin only).
async fn unpin_channel_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    check_channel_access(&state, channel_id, claims.sub).await?;
    permissions::ensure_channel_permission(
        &state.db,
        channel_id,
        claims.sub,
        Permissions::MANAGE_PINS,
    )
    .await?;

    let deleted = sqlx::query("DELETE FROM channel_pins WHERE channel_id = $1 AND message_id = $2")
        .bind(channel_id)
        .bind(message_id)
        .execute(&state.db)
        .await?;

    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("Pinned message not found".into()));
    }

    let server_id: Uuid = sqlx::query_scalar("SELECT server_id FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;

    crate::services::audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "message_unpin",
        "message",
        Some(message_id),
        Some(serde_json::json!({ "channel_id": channel_id })),
    )
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /api/messages/:channel_id — send a message.
async fn send_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    check_channel_access(&state, channel_id, claims.sub).await?;
    crate::services::permissions::ensure_channel_permission(
        &state.db,
        channel_id,
        claims.sub,
        crate::services::permissions::Permissions::SEND_MESSAGES,
    )
    .await?;

    enforce_rate_limit(
        &state.redis,
        format!("message:channel:{}:{}", channel_id, claims.sub),
        state.message_rate_limit_max,
        Duration::from_secs(state.message_rate_limit_window_secs),
        "Message rate limit exceeded. Please slow down.",
    )
    .await?;

    let content = body.content.unwrap_or_default();
    let has_attachments = body.attachments.as_ref().is_some();

    validate_attachments(body.attachments.as_ref())?;

    if content.is_empty() && !has_attachments {
        return Err(AppError::Validation(
            "Message must include content or attachments".into(),
        ));
    }
    if content.len() > 4000 {
        return Err(AppError::Validation(
            "Message must be 1-4000 characters".into(),
        ));
    }

    // Insert and fetch with author in one round-trip using CTE
    let row = sqlx::query_as::<_, MessageRow>(
        r#"WITH new_msg AS (
               INSERT INTO messages (id, channel_id, user_id, content, attachments, created_at)
               VALUES ($1, $2, $3, $4, $5, NOW())
               RETURNING *
           )
           SELECT nm.id, nm.channel_id, nm.content, nm.attachments, nm.edited_at, nm.created_at,
                  u.id as user_id, u.username, u.avatar_url,
                  (
                      SELECT sr.color 
                      FROM server_roles sr 
                      INNER JOIN server_member_roles smr ON sr.id = smr.role_id 
                      INNER JOIN channels c ON c.server_id = sr.server_id
                      WHERE smr.user_id = nm.user_id 
                        AND c.id = nm.channel_id
                        AND sr.color IS NOT NULL 
                      ORDER BY sr.position ASC 
                      LIMIT 1
                  ) as role_color
           FROM new_msg nm
           INNER JOIN users u ON nm.user_id = u.id"#,
    )
    .bind(Uuid::new_v4())
    .bind(channel_id)
    .bind(claims.sub)
    .bind(&content)
    .bind(&body.attachments)
    .fetch_one(&state.db)
    .await?;

    let msg_with_author: MessageWithAuthor = row.into();

    // Broadcast to WebSocket subscribers
    let _ = state.tx.send(WsEvent::NewMessage {
        channel_id,
        channel_type: "text".to_string(), // Text channel messages
        message: msg_with_author.clone(),
    });

    Ok(Json(msg_with_author))
}

/// DELETE /api/messages/item/:message_id — delete a server channel message (author or server admin/owner).
async fn delete_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row =
        sqlx::query_as::<_, (Uuid, Uuid)>("SELECT channel_id, user_id FROM messages WHERE id = $1")
            .bind(message_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound("Message not found".into()))?;

    let (channel_id, author_id) = row;
    check_channel_access(&state, channel_id, claims.sub).await?;

    if claims.sub != author_id {
        // Non-authors must have MANAGE_MESSAGES on this channel.
        permissions::ensure_channel_permission(
            &state.db,
            channel_id,
            claims.sub,
            Permissions::MANAGE_MESSAGES,
        )
        .await?;
    }

    sqlx::query("DELETE FROM messages WHERE id = $1")
        .bind(message_id)
        .execute(&state.db)
        .await?;

    let _ = state.tx.send(WsEvent::MessageDeleted {
        channel_id,
        message_id,
    });

    Ok(Json(
        serde_json::json!({ "message": "Deleted", "id": message_id }),
    ))
}

/// PATCH /api/messages/item/:message_id — edit a server channel message (author only).
async fn edit_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
    Json(body): Json<EditMessageRequest>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    let row =
        sqlx::query_as::<_, (Uuid, Uuid)>("SELECT channel_id, user_id FROM messages WHERE id = $1")
            .bind(message_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound("Message not found".into()))?;

    let (channel_id, author_id) = row;
    if claims.sub != author_id {
        return Err(AppError::Forbidden(
            "Only the author can edit this message".into(),
        ));
    }
    check_channel_access(&state, channel_id, claims.sub).await?;

    let content = body.content.trim();
    if content.is_empty() {
        return Err(AppError::Validation(
            "Message content cannot be empty".into(),
        ));
    }
    if content.len() > 4000 {
        return Err(AppError::Validation(
            "Message must be 1-4000 characters".into(),
        ));
    }

    sqlx::query("UPDATE messages SET content = $1, edited_at = NOW() WHERE id = $2")
        .bind(content)
        .bind(message_id)
        .execute(&state.db)
        .await?;

    let row = sqlx::query_as::<_, MessageRow>(
        r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                  u.id as user_id, u.username, u.avatar_url,
                  (
                      SELECT sr.color 
                      FROM server_roles sr 
                      INNER JOIN server_member_roles smr ON sr.id = smr.role_id 
                      INNER JOIN channels c ON c.server_id = sr.server_id
                      WHERE smr.user_id = m.user_id 
                        AND c.id = m.channel_id
                        AND sr.color IS NOT NULL 
                      ORDER BY sr.position ASC 
                      LIMIT 1
                  ) as role_color
           FROM messages m
           INNER JOIN users u ON m.user_id = u.id
           WHERE m.id = $1"#,
    )
    .bind(message_id)
    .fetch_one(&state.db)
    .await?;

    let msg_with_author: MessageWithAuthor = row.into();

    let _ = state.tx.send(WsEvent::MessageUpdated {
        channel_id,
        message: msg_with_author.clone(),
    });

    Ok(Json(msg_with_author))
}

/// Check if a user has access to a channel (via server membership).
async fn check_channel_access(
    state: &AppState,
    channel_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    // Single query: check channel exists AND user is member of its server
    let has_access = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM channels c
           INNER JOIN server_members sm ON c.server_id = sm.server_id
           WHERE c.id = $1 AND sm.user_id = $2"#,
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    if has_access == 0 {
        return Err(AppError::Forbidden("No access to this channel".into()));
    }

    crate::services::permissions::ensure_channel_permission(
        &state.db,
        channel_id,
        user_id,
        crate::services::permissions::Permissions::VIEW_SERVER,
    )
    .await?;

    Ok(())
}
