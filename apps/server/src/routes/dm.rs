use axum::{
    extract::{Path, Query, State},
    middleware,
    routing::{delete, get, patch, post},
    Extension, Json, Router,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    models::{MessageAuthor, MessageQuery, MessageReactionSummary, MessageWithAuthor},
    services::attachments::validate_attachments,
    services::rate_limit::enforce_rate_limit,
    ws::WsEvent,
    AppState,
};

fn escape_ilike_pattern(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct DmChannelInfo {
    pub id: Uuid,
    pub peer_id: Uuid,
    pub peer_username: String,
    pub peer_avatar_url: Option<String>,
    pub peer_status: String,
    pub last_message_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, serde::Serialize)]
pub struct DmReadState {
    pub peer_last_read_message_id: Option<Uuid>,
}

#[derive(Debug, serde::Deserialize)]
pub struct DmSearchQuery {
    pub q: String,
    pub limit: Option<i64>,
}

#[derive(Debug, serde::Deserialize)]
pub struct SendDmMessageRequest {
    pub content: Option<String>,
    pub attachments: Option<serde_json::Value>,
}

#[derive(Debug, serde::Deserialize)]
pub struct EditDmMessageRequest {
    pub content: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct AddDmReactionRequest {
    pub emoji: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct RemoveDmReactionQuery {
    pub emoji: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct PinDmMessageRequest {
    pub message_id: Uuid,
}

#[derive(sqlx::FromRow)]
struct DmMessageRow {
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

impl From<DmMessageRow> for MessageWithAuthor {
    fn from(row: DmMessageRow) -> Self {
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
                role_color: None,
            },
            reactions: Vec::new(),
        }
    }
}

#[derive(sqlx::FromRow)]
struct DmMessageReactionRow {
    message_id: Uuid,
    emoji: String,
    count: i64,
    reacted: bool,
}

fn normalize_reaction_emoji(raw: &str) -> Result<String, AppError> {
    let emoji = raw.trim();
    if emoji.is_empty() {
        return Err(AppError::Validation("Emoji is required".into()));
    }
    let char_count = emoji.chars().count();
    if char_count > 16 {
        return Err(AppError::Validation("Emoji is too long".into()));
    }
    if emoji.chars().any(char::is_whitespace) {
        return Err(AppError::Validation("Emoji cannot include spaces".into()));
    }
    Ok(emoji.to_string())
}

async fn attach_dm_message_reactions(
    db: &sqlx::PgPool,
    messages: &mut [MessageWithAuthor],
    viewer_id: Uuid,
) -> Result<(), AppError> {
    if messages.is_empty() {
        return Ok(());
    }

    let message_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
    let rows = sqlx::query_as::<_, DmMessageReactionRow>(
        r#"SELECT r.message_id,
                  r.emoji,
                  COUNT(*)::BIGINT AS count,
                  BOOL_OR(r.user_id = $2) AS reacted
           FROM dm_message_reactions r
           WHERE r.message_id = ANY($1)
           GROUP BY r.message_id, r.emoji
           ORDER BY r.message_id ASC, MIN(r.created_at) ASC"#,
    )
    .bind(&message_ids)
    .bind(viewer_id)
    .fetch_all(db)
    .await?;

    let mut by_message: HashMap<Uuid, Vec<MessageReactionSummary>> = HashMap::new();
    for row in rows {
        by_message
            .entry(row.message_id)
            .or_default()
            .push(MessageReactionSummary {
                emoji: row.emoji,
                count: row.count,
                reacted: row.reacted,
            });
    }

    for msg in messages.iter_mut() {
        msg.reactions = by_message.remove(&msg.id).unwrap_or_default();
    }
    Ok(())
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/channels", get(list_dm_channels))
        .route("/channels/{peer_id}", post(get_or_create_dm_channel))
        .route("/channels/{channel_id}/read-state", get(get_dm_read_state))
        .route(
            "/channels/{channel_id}/pins",
            get(list_dm_pins).post(pin_dm_message),
        )
        .route(
            "/channels/{channel_id}/pins/{message_id}",
            delete(unpin_dm_message),
        )
        .route(
            "/messages/{channel_id}",
            get(get_dm_messages).post(send_dm_message),
        )
        .route("/messages/{channel_id}/search", get(search_dm_messages))
        .route(
            "/messages/item/{message_id}",
            patch(edit_dm_message).delete(delete_dm_message),
        )
        .route(
            "/messages/item/{message_id}/reactions",
            axum::routing::post(add_dm_reaction).delete(remove_dm_reaction),
        )
        .route_layer(middleware::from_fn_with_state(state, require_auth))
}

fn visible_presence(status: &str, has_session: bool) -> String {
    if !has_session {
        return "offline".to_string();
    }
    match status.to_ascii_lowercase().as_str() {
        "dnd" => "dnd".to_string(),
        "invisible" | "offline" => "offline".to_string(),
        _ => "online".to_string(),
    }
}

async fn list_dm_channels(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<DmChannelInfo>>, AppError> {
    let rows = sqlx::query_as::<_, DmChannelInfo>(
        r#"SELECT c.id,
                  u.id as peer_id,
                  u.username as peer_username,
                  u.avatar_url as peer_avatar_url,
                  u.status as peer_status,
                  (
                    SELECT m.created_at
                    FROM dm_messages m
                    WHERE m.channel_id = c.id
                    ORDER BY m.created_at DESC
                    LIMIT 1
                  ) as last_message_at
           FROM dm_channels c
           INNER JOIN dm_channel_members self_m
             ON self_m.channel_id = c.id AND self_m.user_id = $1
           INNER JOIN dm_channel_members peer_m
             ON peer_m.channel_id = c.id AND peer_m.user_id <> $1
           INNER JOIN users u ON u.id = peer_m.user_id
           ORDER BY COALESCE(
             (
               SELECT m.created_at
               FROM dm_messages m
               WHERE m.channel_id = c.id
               ORDER BY m.created_at DESC
               LIMIT 1
             ),
             c.created_at
           ) DESC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    // Use live WebSocket sessions for peer online/offline.
    let with_presence: Vec<DmChannelInfo> = rows
        .into_iter()
        .map(|r| {
            let peer_status =
                visible_presence(&r.peer_status, state.sessions.contains_key(&r.peer_id));
            DmChannelInfo { peer_status, ..r }
        })
        .collect();

    Ok(Json(with_presence))
}

/// Ensures the sender is allowed to DM the peer according to the peer's dm_privacy setting.
async fn check_can_dm_peer(
    state: &AppState,
    sender_id: Uuid,
    peer_id: Uuid,
) -> Result<(), AppError> {
    let peer_dm_privacy =
        sqlx::query_scalar::<_, String>("SELECT dm_privacy FROM users WHERE id = $1")
            .bind(peer_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound("User not found".into()))?;

    match peer_dm_privacy.as_str() {
        "everyone" => {}
        "friends" => {
            let (a, b) = if sender_id < peer_id {
                (sender_id, peer_id)
            } else {
                (peer_id, sender_id)
            };
            let are_friends = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM friendships WHERE user_a = $1 AND user_b = $2",
            )
            .bind(a)
            .bind(b)
            .fetch_one(&state.db)
            .await?;
            if are_friends == 0 {
                return Err(AppError::Forbidden(
                    "This user accepts DMs from friends only".into(),
                ));
            }
        }
        _ => {
            // server_members no longer offered; treat any other value as friends-only
            let (a, b) = if sender_id < peer_id {
                (sender_id, peer_id)
            } else {
                (peer_id, sender_id)
            };
            let are_friends = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM friendships WHERE user_a = $1 AND user_b = $2",
            )
            .bind(a)
            .bind(b)
            .fetch_one(&state.db)
            .await?;
            if are_friends == 0 {
                return Err(AppError::Forbidden(
                    "This user accepts DMs from friends only".into(),
                ));
            }
        }
    }
    Ok(())
}

async fn get_or_create_dm_channel(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(peer_id): Path<Uuid>,
) -> Result<Json<DmChannelInfo>, AppError> {
    if claims.sub == peer_id {
        return Err(AppError::Validation(
            "Cannot create DM with yourself".into(),
        ));
    }

    enforce_rate_limit(
        &state.redis,
        format!("dm_create:{}", claims.sub),
        5,
        Duration::from_secs(60),
        "Too many DM channels created recently. Please slow down.",
    )
    .await?;

    // Always enforce peer's DM privacy (open and create). So if they unfriend you, you can't open the channel either.
    check_can_dm_peer(&state, claims.sub, peer_id).await?;

    let existing = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT c.id
           FROM dm_channels c
           INNER JOIN dm_channel_members m1 ON m1.channel_id = c.id AND m1.user_id = $1
           INNER JOIN dm_channel_members m2 ON m2.channel_id = c.id AND m2.user_id = $2
           LIMIT 1"#,
    )
    .bind(claims.sub)
    .bind(peer_id)
    .fetch_optional(&state.db)
    .await?;

    let channel_id = if let Some(id) = existing {
        id
    } else {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO dm_channels (id, created_at) VALUES ($1, NOW())")
            .bind(id)
            .execute(&state.db)
            .await?;
        sqlx::query(
            "INSERT INTO dm_channel_members (channel_id, user_id, joined_at) VALUES ($1, $2, NOW())",
        )
        .bind(id)
        .bind(claims.sub)
        .execute(&state.db)
        .await?;
        sqlx::query(
            "INSERT INTO dm_channel_members (channel_id, user_id, joined_at) VALUES ($1, $2, NOW())",
        )
        .bind(id)
        .bind(peer_id)
        .execute(&state.db)
        .await?;
        id
    };

    let info = sqlx::query_as::<_, DmChannelInfo>(
        r#"SELECT c.id,
                  u.id as peer_id,
                  u.username as peer_username,
                  u.avatar_url as peer_avatar_url,
                  u.status as peer_status,
                  (
                    SELECT m.created_at
                    FROM dm_messages m
                    WHERE m.channel_id = c.id
                    ORDER BY m.created_at DESC
                    LIMIT 1
                  ) as last_message_at
           FROM dm_channels c
           INNER JOIN dm_channel_members peer_m
             ON peer_m.channel_id = c.id AND peer_m.user_id <> $1
           INNER JOIN users u ON u.id = peer_m.user_id
           WHERE c.id = $2
           LIMIT 1"#,
    )
    .bind(claims.sub)
    .bind(channel_id)
    .fetch_one(&state.db)
    .await?;

    let peer_status = visible_presence(
        &info.peer_status,
        state.sessions.contains_key(&info.peer_id),
    );
    let info = DmChannelInfo {
        peer_status,
        ..info
    };

    Ok(Json(info))
}

async fn get_dm_messages(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<MessageQuery>,
) -> Result<Json<Vec<MessageWithAuthor>>, AppError> {
    check_dm_access(&state, channel_id, claims.sub).await?;

    let limit = query.limit.unwrap_or(50).min(100);
    let rows: Vec<DmMessageRow> = if let Some(before) = query.before {
        sqlx::query_as::<_, DmMessageRow>(
            r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                      u.id as user_id, u.username, u.avatar_url
               FROM dm_messages m
               INNER JOIN users u ON m.user_id = u.id
               WHERE m.channel_id = $1
                 AND m.created_at < (SELECT created_at FROM dm_messages WHERE id = $2)
               ORDER BY m.created_at DESC
               LIMIT $3"#,
        )
        .bind(channel_id)
        .bind(before)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, DmMessageRow>(
            r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                      u.id as user_id, u.username, u.avatar_url
               FROM dm_messages m
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

    let mut result: Vec<MessageWithAuthor> = rows.into_iter().rev().map(Into::into).collect();
    attach_dm_message_reactions(&state.db, &mut result, claims.sub).await?;
    if let Some(last) = result.last() {
        mark_dm_read(&state, channel_id, claims.sub, Some(last.id)).await?;
    }
    Ok(Json(result))
}

async fn send_dm_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<SendDmMessageRequest>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    check_dm_access(&state, channel_id, claims.sub).await?;

    let peer_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM dm_channel_members WHERE channel_id = $1 AND user_id <> $2 LIMIT 1",
    )
    .bind(channel_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("DM channel peer not found".into()))?;
    check_can_dm_peer(&state, claims.sub, peer_id).await?;

    enforce_rate_limit(
        &state.redis,
        format!("message:dm:{}:{}", channel_id, claims.sub),
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

    let id = Uuid::new_v4();
    let row = sqlx::query_as::<_, DmMessageRow>(
        r#"INSERT INTO dm_messages (id, channel_id, user_id, content, attachments, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           RETURNING id, channel_id, content, attachments, edited_at, created_at,
                     $3 as user_id,
                     (SELECT username FROM users WHERE id = $3) as username,
                     (SELECT avatar_url FROM users WHERE id = $3) as avatar_url"#,
    )
    .bind(id)
    .bind(channel_id)
    .bind(claims.sub)
    .bind(&content)
    .bind(&body.attachments)
    .fetch_one(&state.db)
    .await?;

    let mut message: MessageWithAuthor = row.into();
    attach_dm_message_reactions(&state.db, std::slice::from_mut(&mut message), claims.sub).await?;
    mark_dm_read(&state, channel_id, claims.sub, Some(message.id)).await?;
    let event = WsEvent::NewMessage {
        channel_id,
        channel_type: "dm".to_string(),
        message: message.clone(),
    };
    if let Err(e) = push_dm_event_to_members(&state, channel_id, claims.sub, &event).await {
        tracing::warn!("Failed to push DM event to members: {}", e);
    }
    Ok(Json(message))
}

async fn push_dm_event_to_members(
    state: &AppState,
    channel_id: Uuid,
    sender_id: Uuid,
    event: &WsEvent,
) -> Result<(), sqlx::Error> {
    let member_ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM dm_channel_members WHERE channel_id = $1",
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    for user_id in member_ids {
        // Don't send notification to the sender
        if user_id == sender_id {
            continue;
        }
        if let Some(session_senders) = state.sessions.get(&user_id) {
            for sender in session_senders.iter() {
                let _ = sender.send(event.clone());
            }
        }
    }

    Ok(())
}

async fn get_dm_read_state(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<DmReadState>, AppError> {
    check_dm_access(&state, channel_id, claims.sub).await?;
    let peer_last = sqlx::query_scalar::<_, Option<Uuid>>(
        r#"SELECT r.last_read_message_id
           FROM dm_channel_reads r
           WHERE r.channel_id = $1 AND r.user_id <> $2
           LIMIT 1"#,
    )
    .bind(channel_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    Ok(Json(DmReadState {
        peer_last_read_message_id: peer_last,
    }))
}

async fn search_dm_messages(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<DmSearchQuery>,
) -> Result<Json<Vec<MessageWithAuthor>>, AppError> {
    check_dm_access(&state, channel_id, claims.sub).await?;

    let term = query.q.trim();
    if term.is_empty() {
        return Ok(Json(vec![]));
    }
    let limit = query.limit.unwrap_or(100).min(200);
    let escaped_term = escape_ilike_pattern(term);
    let pattern = format!("%{}%", escaped_term);

    let rows = sqlx::query_as::<_, DmMessageRow>(
        r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                  u.id as user_id, u.username, u.avatar_url
           FROM dm_messages m
           INNER JOIN users u ON m.user_id = u.id
           WHERE m.channel_id = $1
                         AND m.content ILIKE $2 ESCAPE '\'
           ORDER BY m.created_at DESC
           LIMIT $3"#,
    )
    .bind(channel_id)
    .bind(pattern)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    let mut result: Vec<MessageWithAuthor> = rows.into_iter().rev().map(Into::into).collect();
    attach_dm_message_reactions(&state.db, &mut result, claims.sub).await?;
    Ok(Json(result))
}

async fn list_dm_pins(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Vec<MessageWithAuthor>>, AppError> {
    check_dm_access(&state, channel_id, claims.sub).await?;

    let rows = sqlx::query_as::<_, DmMessageRow>(
        r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                  u.id as user_id, u.username, u.avatar_url
           FROM dm_channel_pins p
           INNER JOIN dm_messages m ON p.dm_message_id = m.id
           INNER JOIN users u ON m.user_id = u.id
           WHERE p.dm_channel_id = $1
           ORDER BY p.pinned_at DESC"#,
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    let mut result: Vec<MessageWithAuthor> = rows.into_iter().map(Into::into).collect();
    attach_dm_message_reactions(&state.db, &mut result, claims.sub).await?;
    Ok(Json(result))
}

async fn pin_dm_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<PinDmMessageRequest>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    check_dm_access(&state, channel_id, claims.sub).await?;

    let msg_channel: Option<Uuid> =
        sqlx::query_scalar("SELECT channel_id FROM dm_messages WHERE id = $1")
            .bind(body.message_id)
            .fetch_optional(&state.db)
            .await?;

    let msg_channel = msg_channel.ok_or_else(|| AppError::NotFound("Message not found".into()))?;
    if msg_channel != channel_id {
        return Err(AppError::Forbidden("Message is not in this channel".into()));
    }

    sqlx::query(
        r#"INSERT INTO dm_channel_pins (dm_channel_id, dm_message_id, pinned_by_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (dm_channel_id, dm_message_id) DO NOTHING"#,
    )
    .bind(channel_id)
    .bind(body.message_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    let row = sqlx::query_as::<_, DmMessageRow>(
        r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                  u.id as user_id, u.username, u.avatar_url
           FROM dm_messages m
           INNER JOIN users u ON m.user_id = u.id
           WHERE m.id = $1"#,
    )
    .bind(body.message_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    let mut message: MessageWithAuthor = row.into();
    attach_dm_message_reactions(&state.db, std::slice::from_mut(&mut message), claims.sub).await?;
    Ok(Json(message))
}

async fn unpin_dm_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    check_dm_access(&state, channel_id, claims.sub).await?;

    let deleted =
        sqlx::query("DELETE FROM dm_channel_pins WHERE dm_channel_id = $1 AND dm_message_id = $2")
            .bind(channel_id)
            .bind(message_id)
            .execute(&state.db)
            .await?;

    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("Pinned message not found".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn edit_dm_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
    Json(body): Json<EditDmMessageRequest>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    if body.content.trim().is_empty() || body.content.len() > 4000 {
        return Err(AppError::Validation(
            "Message must be 1-4000 characters".into(),
        ));
    }

    let owner = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT user_id, channel_id FROM dm_messages WHERE id = $1",
    )
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("DM message not found".into()))?;
    let (owner_id, channel_id) = owner;
    check_dm_access(&state, channel_id, claims.sub).await?;
    if owner_id != claims.sub {
        return Err(AppError::Forbidden(
            "Only author can edit DM message".into(),
        ));
    }

    let row = sqlx::query_as::<_, DmMessageRow>(
        r#"UPDATE dm_messages
           SET content = $1, edited_at = NOW()
           WHERE id = $2
           RETURNING id, channel_id, content, attachments, edited_at, created_at,
                     user_id,
                     (SELECT username FROM users WHERE id = user_id) as username,
                     (SELECT avatar_url FROM users WHERE id = user_id) as avatar_url"#,
    )
    .bind(body.content.trim())
    .bind(message_id)
    .fetch_one(&state.db)
    .await?;

    let mut message: MessageWithAuthor = row.into();
    attach_dm_message_reactions(&state.db, std::slice::from_mut(&mut message), claims.sub).await?;
    let event = WsEvent::MessageUpdated {
        channel_id,
        message: message.clone(),
    };
    if let Err(e) = push_dm_event_to_members(&state, channel_id, claims.sub, &event).await {
        tracing::warn!("Failed to push DM edit event to members: {}", e);
    }
    Ok(Json(message))
}

async fn delete_dm_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let owner = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT user_id, channel_id FROM dm_messages WHERE id = $1",
    )
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("DM message not found".into()))?;
    let (owner_id, channel_id) = owner;
    check_dm_access(&state, channel_id, claims.sub).await?;
    if owner_id != claims.sub {
        return Err(AppError::Forbidden(
            "Only author can delete DM message".into(),
        ));
    }

    sqlx::query("DELETE FROM dm_messages WHERE id = $1")
        .bind(message_id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        serde_json::json!({ "message": "DM message deleted", "id": message_id }),
    ))
}

async fn load_dm_message_with_author(
    db: &sqlx::PgPool,
    message_id: Uuid,
) -> Result<MessageWithAuthor, AppError> {
    let row = sqlx::query_as::<_, DmMessageRow>(
        r#"SELECT m.id, m.channel_id, m.content, m.attachments, m.edited_at, m.created_at,
                  u.id as user_id, u.username, u.avatar_url
           FROM dm_messages m
           INNER JOIN users u ON m.user_id = u.id
           WHERE m.id = $1"#,
    )
    .bind(message_id)
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound("DM message not found".into()))?;
    Ok(row.into())
}

async fn add_dm_reaction(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
    Json(body): Json<AddDmReactionRequest>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    let emoji = normalize_reaction_emoji(&body.emoji)?;
    let channel_id: Uuid = sqlx::query_scalar("SELECT channel_id FROM dm_messages WHERE id = $1")
        .bind(message_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("DM message not found".into()))?;

    check_dm_access(&state, channel_id, claims.sub).await?;

    sqlx::query(
        r#"INSERT INTO dm_message_reactions (message_id, user_id, emoji)
           VALUES ($1, $2, $3)
           ON CONFLICT (message_id, user_id, emoji) DO NOTHING"#,
    )
    .bind(message_id)
    .bind(claims.sub)
    .bind(&emoji)
    .execute(&state.db)
    .await?;

    let mut message = load_dm_message_with_author(&state.db, message_id).await?;
    attach_dm_message_reactions(&state.db, std::slice::from_mut(&mut message), claims.sub).await?;
    let event = WsEvent::MessageUpdated {
        channel_id,
        message: message.clone(),
    };
    if let Err(e) = push_dm_event_to_members(&state, channel_id, claims.sub, &event).await {
        tracing::warn!("Failed to push DM reaction event to members: {}", e);
    }
    Ok(Json(message))
}

async fn remove_dm_reaction(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
    Query(query): Query<RemoveDmReactionQuery>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    let emoji = normalize_reaction_emoji(&query.emoji)?;
    let channel_id: Uuid = sqlx::query_scalar("SELECT channel_id FROM dm_messages WHERE id = $1")
        .bind(message_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("DM message not found".into()))?;

    check_dm_access(&state, channel_id, claims.sub).await?;

    sqlx::query(
        r#"DELETE FROM dm_message_reactions
           WHERE message_id = $1 AND user_id = $2 AND emoji = $3"#,
    )
    .bind(message_id)
    .bind(claims.sub)
    .bind(&emoji)
    .execute(&state.db)
    .await?;

    let mut message = load_dm_message_with_author(&state.db, message_id).await?;
    attach_dm_message_reactions(&state.db, std::slice::from_mut(&mut message), claims.sub).await?;
    let event = WsEvent::MessageUpdated {
        channel_id,
        message: message.clone(),
    };
    if let Err(e) = push_dm_event_to_members(&state, channel_id, claims.sub, &event).await {
        tracing::warn!("Failed to push DM reaction removal event to members: {}", e);
    }
    Ok(Json(message))
}

async fn check_dm_access(
    state: &AppState,
    channel_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let is_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM dm_channel_members WHERE channel_id = $1 AND user_id = $2",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if is_member == 0 {
        return Err(AppError::Forbidden("No access to this DM channel".into()));
    }
    Ok(())
}

async fn mark_dm_read(
    state: &AppState,
    channel_id: Uuid,
    user_id: Uuid,
    last_read_message_id: Option<Uuid>,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO dm_channel_reads (channel_id, user_id, last_read_message_id, read_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (channel_id, user_id)
           DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id, read_at = NOW()"#,
    )
    .bind(channel_id)
    .bind(user_id)
    .bind(last_read_message_id)
    .execute(&state.db)
    .await?;
    Ok(())
}
