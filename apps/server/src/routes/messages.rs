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
    models::{EditMessageRequest, MessageAuthor, MessageQuery, MessageWithAuthor, SendMessageRequest},
    services::attachments::validate_attachments,
    services::rate_limit::enforce_rate_limit,
    ws::WsEvent,
    AppState,
};

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/item/{message_id}", delete(delete_message).patch(edit_message))
        .route("/{channel_id}", get(get_messages).post(send_message))
        .route_layer(middleware::from_fn_with_state(state, require_auth))
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
                      u.id as user_id, u.username, u.avatar_url
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
                      u.id as user_id, u.username, u.avatar_url
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

/// POST /api/messages/:channel_id — send a message.
async fn send_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    check_channel_access(&state, channel_id, claims.sub).await?;
    enforce_rate_limit(
        &state.rate_limits,
        format!("message:channel:{}:{}", channel_id, claims.sub),
        state.message_rate_limit_max,
        Duration::from_secs(state.message_rate_limit_window_secs),
        "Message rate limit exceeded. Please slow down.",
    )?;

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
                  u.id as user_id, u.username, u.avatar_url
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
    let row = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT channel_id, user_id FROM messages WHERE id = $1",
    )
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Message not found".into()))?;

    let (channel_id, author_id) = row;
    check_channel_access(&state, channel_id, claims.sub).await?;

    if claims.sub != author_id {
        let server_id: Uuid = sqlx::query_scalar(
            "SELECT server_id FROM channels WHERE id = $1",
        )
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        let role: Option<String> = sqlx::query_scalar(
            "SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2",
        )
        .bind(server_id)
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?;
        let can_mod = matches!(role.as_deref(), Some("owner") | Some("moderator"));
        if !can_mod {
            return Err(AppError::Forbidden(
                "Only the author or a server moderator can delete this message".into(),
            ));
        }
    }

    sqlx::query("DELETE FROM messages WHERE id = $1")
        .bind(message_id)
        .execute(&state.db)
        .await?;

    let _ = state.tx.send(WsEvent::MessageDeleted {
        channel_id,
        message_id,
    });

    Ok(Json(serde_json::json!({ "message": "Deleted", "id": message_id })))
}

/// PATCH /api/messages/item/:message_id — edit a server channel message (author only).
async fn edit_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
    Json(body): Json<EditMessageRequest>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    let row = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT channel_id, user_id FROM messages WHERE id = $1",
    )
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
        return Err(AppError::Validation("Message content cannot be empty".into()));
    }
    if content.len() > 4000 {
        return Err(AppError::Validation(
            "Message must be 1-4000 characters".into(),
        ));
    }

    sqlx::query(
        "UPDATE messages SET content = $1, edited_at = NOW() WHERE id = $2",
    )
    .bind(content)
    .bind(message_id)
    .execute(&state.db)
    .await?;

    let row = sqlx::query_as::<_, MessageRow>(
        r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                  u.id as user_id, u.username, u.avatar_url
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

    Ok(())
}
