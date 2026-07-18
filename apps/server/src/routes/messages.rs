use axum::{
    extract::{Path, Query, State},
    middleware,
    routing::{delete, get},
    Extension, Json, Router,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    models::{
        EditMessageRequest, MessageAuthor, MessageQuery, MessageReactionSummary, MessageWithAuthor,
        SendMessageRequest,
    },
    services::{
        automod,
        moderation,
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

#[derive(Debug, serde::Deserialize)]
struct AddReactionRequest {
    emoji: String,
}

#[derive(Debug, serde::Deserialize)]
struct RemoveReactionQuery {
    emoji: String,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/item/{message_id}",
            delete(delete_message).patch(edit_message),
        )
        .route(
            "/item/{message_id}/reactions",
            axum::routing::post(add_message_reaction).delete(remove_message_reaction),
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

fn is_mass_mention_boundary_char(ch: Option<char>) -> bool {
    match ch {
        None => true,
        Some(c) => !(c.is_ascii_alphanumeric() || c == '_'),
    }
}

fn mass_mention_token_len_at(content: &str, at_index: usize) -> Option<usize> {
    if !content[at_index..].starts_with('@') {
        return None;
    }
    let next_index = at_index + '@'.len_utf8();
    if next_index >= content.len() {
        return None;
    }

    let prev_char = content[..at_index].chars().next_back();
    if !is_mass_mention_boundary_char(prev_char) {
        return None;
    }

    for token in ["everyone", "here"] {
        let Some(candidate) = content[next_index..].get(..token.len()) else {
            continue;
        };
        if !candidate.eq_ignore_ascii_case(token) {
            continue;
        }
        let after_char = content[next_index + token.len()..].chars().next();
        if is_mass_mention_boundary_char(after_char) {
            return Some(token.len());
        }
    }

    None
}

fn neutralize_mass_mentions(content: &str) -> String {
    let mut result = String::with_capacity(content.len() + 8);
    let mut idx = 0usize;

    while idx < content.len() {
        let ch = content[idx..]
            .chars()
            .next()
            .expect("valid UTF-8 character boundary");
        let ch_len = ch.len_utf8();

        if ch == '@' {
            if let Some(token_len) = mass_mention_token_len_at(content, idx) {
                let start = idx + 1;
                let end = start + token_len;
                result.push('@');
                result.push('\u{200B}');
                result.push_str(&content[start..end]);
                idx = end;
                continue;
            }
        }

        result.push(ch);
        idx += ch_len;
    }

    result
}

fn can_use_mass_mentions(perms: Permissions) -> bool {
    perms.contains(Permissions::MANAGE_SERVER) || perms.contains(Permissions::MANAGE_MESSAGES)
}

fn audit_content_preview(content: &str) -> (String, bool) {
    let mut out = String::new();
    let mut chars = content.chars();
    for _ in 0..160 {
        let Some(ch) = chars.next() else {
            return (out, false);
        };
        out.push(ch);
    }
    (out, chars.next().is_some())
}

#[derive(Debug, serde::Deserialize)]
struct MessageSearchQuery {
    q: Option<String>,
    limit: Option<i64>,
    from: Option<String>,
    has_attachment: Option<bool>,
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
            reactions: Vec::new(),
        }
    }
}

#[derive(sqlx::FromRow)]
struct MessageReactionRow {
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

async fn attach_message_reactions(
    db: &sqlx::PgPool,
    messages: &mut [MessageWithAuthor],
    viewer_id: Uuid,
) -> Result<(), AppError> {
    if messages.is_empty() {
        return Ok(());
    }

    let message_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
    let rows = sqlx::query_as::<_, MessageReactionRow>(
        r#"SELECT mr.message_id,
                  mr.emoji,
                  COUNT(*)::BIGINT AS count,
                  BOOL_OR(mr.user_id = $2) AS reacted
           FROM message_reactions mr
           WHERE mr.message_id = ANY($1)
           GROUP BY mr.message_id, mr.emoji
           ORDER BY mr.message_id ASC, MIN(mr.created_at) ASC"#,
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

async fn hydrate_message_attachments(
    state: &Arc<AppState>,
    messages: &mut [MessageWithAuthor],
) -> Result<(), AppError> {
    for msg in messages.iter_mut() {
        msg.attachments = state
            .attachment_service
            .hydrate_attachments_for_output(&state.db, &state.jwt_secret, msg.attachments.clone())
            .await?;
    }
    Ok(())
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
    let mut result: Vec<MessageWithAuthor> = rows.into_iter().rev().map(Into::into).collect();
    attach_message_reactions(&state.db, &mut result, claims.sub).await?;
    hydrate_message_attachments(&state, &mut result).await?;

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
    enforce_rate_limit(
        &state.redis,
        format!("messages:search:{}:{}", claims.sub, channel_id),
        15,
        Duration::from_secs(60),
        "Search rate limit exceeded. Please slow down.",
    )
    .await?;

    let term = query.q.as_deref().unwrap_or("").trim();
    let author = query.from.as_deref().unwrap_or("").trim().trim_start_matches('@');
    let has_attachment = query.has_attachment.unwrap_or(false);
    if term.is_empty() && author.is_empty() && !has_attachment {
        return Ok(Json(vec![]));
    }
    let limit = query.limit.unwrap_or(100).min(200);
    let pattern = if term.is_empty() {
        String::new()
    } else {
        format!("%{}%", escape_ilike_pattern(term))
    };
    let author_pattern = if author.is_empty() {
        None
    } else {
        Some(format!("%{}%", escape_ilike_pattern(author)))
    };

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
             AND ($2 = '' OR m.content ILIKE $2 ESCAPE '\')
             AND ($3::TEXT IS NULL OR u.username ILIKE $3 ESCAPE '\')
             AND (
                 NOT $4
                 OR (
                     jsonb_typeof(m.attachments) = 'array'
                     AND jsonb_array_length(m.attachments) > 0
                 )
             )
           ORDER BY m.created_at DESC
           LIMIT $5"#,
    )
    .bind(channel_id)
    .bind(&pattern)
    .bind(&author_pattern)
    .bind(has_attachment)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    let mut result: Vec<MessageWithAuthor> = rows.into_iter().rev().map(Into::into).collect();
    attach_message_reactions(&state.db, &mut result, claims.sub).await?;
    hydrate_message_attachments(&state, &mut result).await?;
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
                  ) as role_color
           FROM channel_pins p
           INNER JOIN messages m ON p.message_id = m.id
           INNER JOIN users u ON m.user_id = u.id
           WHERE p.channel_id = $1
           ORDER BY p.pinned_at DESC
           LIMIT 50"#,
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    let mut result: Vec<MessageWithAuthor> = rows.into_iter().map(Into::into).collect();
    attach_message_reactions(&state.db, &mut result, claims.sub).await?;
    hydrate_message_attachments(&state, &mut result).await?;
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

    let mut tx = state.db.begin().await?;
    let server_id: Uuid =
        sqlx::query_scalar("SELECT server_id FROM channels WHERE id = $1 FOR UPDATE")
            .bind(channel_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    let msg_channel: Option<Uuid> =
        sqlx::query_scalar("SELECT channel_id FROM messages WHERE id = $1")
            .bind(body.message_id)
            .fetch_optional(&mut *tx)
            .await?;

    let msg_channel = msg_channel.ok_or_else(|| AppError::NotFound("Message not found".into()))?;
    if msg_channel != channel_id {
        return Err(AppError::Forbidden("Message is not in this channel".into()));
    }

    let already_pinned = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM channel_pins
               WHERE channel_id = $1 AND message_id = $2
           )"#,
    )
    .bind(channel_id)
    .bind(body.message_id)
    .fetch_one(&mut *tx)
    .await?;

    if !already_pinned {
        let pin_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM channel_pins WHERE channel_id = $1")
                .bind(channel_id)
                .fetch_one(&mut *tx)
                .await?;
        if pin_count >= 50 {
            return Err(AppError::Validation(
                "This channel already has the maximum of 50 pinned messages".into(),
            ));
        }
    }

    let inserted = sqlx::query(
        r#"INSERT INTO channel_pins (channel_id, message_id, pinned_by_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (channel_id, message_id) DO NOTHING"#,
    )
    .bind(channel_id)
    .bind(body.message_id)
    .bind(claims.sub)
    .execute(&mut *tx)
    .await?;

    if inserted.rows_affected() > 0 {
        crate::services::audit::log_in_transaction(
            &mut tx,
            claims.sub,
            Some(server_id),
            "message_pin",
            "message",
            Some(body.message_id),
            Some(serde_json::json!({ "channel_id": channel_id })),
        )
        .await?;
    }
    tx.commit().await?;

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

    let mut msg_with_author: MessageWithAuthor = row.into();
    attach_message_reactions(
        &state.db,
        std::slice::from_mut(&mut msg_with_author),
        claims.sub,
    )
    .await?;
    msg_with_author.attachments = state
        .attachment_service
        .hydrate_attachments_for_output(
            &state.db,
            &state.jwt_secret,
            msg_with_author.attachments.clone(),
        )
        .await?;

    Ok(Json(msg_with_author))
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
    let channel_perms =
        permissions::get_user_channel_permissions(&state.db, channel_id, claims.sub).await?;
    if !channel_perms.contains(Permissions::SEND_MESSAGES) {
        return Err(AppError::Forbidden("Missing required permission".into()));
    }
    let server_id = server_id_for_channel(&state.db, channel_id).await?;
    moderation::ensure_not_timed_out(&state.db, server_id, claims.sub).await?;

    enforce_rate_limit(
        &state.redis,
        format!("message:channel:{}:{}", channel_id, claims.sub),
        state.message_rate_limit_max,
        Duration::from_secs(state.message_rate_limit_window_secs),
        "Message rate limit exceeded. Please slow down.",
    )
    .await?;

    let raw_content = body.content.unwrap_or_default();
    let content = if can_use_mass_mentions(channel_perms) {
        raw_content
    } else {
        neutralize_mass_mentions(&raw_content)
    };
    let normalized_attachments = state
        .attachment_service
        .normalize_attachments_for_storage(&state.db, claims.sub, body.attachments.as_ref())
        .await?;
    let has_attachments = normalized_attachments.is_some();

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
    if let Some(matched) =
        automod::evaluate_message(&state.db, server_id, channel_id, claims.sub, &content).await?
    {
        automod::log_blocked_message(&state.db, claims.sub, server_id, channel_id, &matched, &content)
            .await?;
        return Err(AppError::Forbidden(format!(
            "Message blocked by AutoMod rule: {}",
            matched.rule_name
        )));
    }
    moderation::enforce_message_raid_protection(
        &state.redis,
        &state.db,
        server_id,
        channel_id,
        claims.sub,
        &content,
    )
    .await?;

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
    .bind(&normalized_attachments)
    .fetch_one(&state.db)
    .await?;

    let mut msg_with_author: MessageWithAuthor = row.into();
    attach_message_reactions(
        &state.db,
        std::slice::from_mut(&mut msg_with_author),
        claims.sub,
    )
    .await?;
    msg_with_author.attachments = state
        .attachment_service
        .hydrate_attachments_for_output(
            &state.db,
            &state.jwt_secret,
            msg_with_author.attachments.clone(),
        )
        .await?;

    // Broadcast to WebSocket subscribers
    crate::ws::publish_event(
        &state,
        WsEvent::NewMessage {
            channel_id,
            channel_type: "text".to_string(), // Text channel messages
            message: msg_with_author.clone(),
        },
    )
    .await;

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

    crate::ws::publish_event(
        &state,
        WsEvent::MessageDeleted {
            channel_id,
            message_id,
        },
    )
    .await;

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
    let row = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        "SELECT channel_id, user_id, content FROM messages WHERE id = $1",
    )
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Message not found".into()))?;

    let (channel_id, author_id, previous_content) = row;
    if claims.sub != author_id {
        return Err(AppError::Forbidden(
            "Only the author can edit this message".into(),
        ));
    }
    check_channel_access(&state, channel_id, claims.sub).await?;
    let server_id = server_id_for_channel(&state.db, channel_id).await?;
    moderation::ensure_not_timed_out(&state.db, server_id, claims.sub).await?;

    let raw_content = body.content.trim();
    if raw_content.is_empty() {
        return Err(AppError::Validation(
            "Message content cannot be empty".into(),
        ));
    }
    let channel_perms =
        permissions::get_user_channel_permissions(&state.db, channel_id, claims.sub).await?;
    let content = if can_use_mass_mentions(channel_perms) {
        raw_content.to_string()
    } else {
        neutralize_mass_mentions(raw_content)
    };
    if content.len() > 4000 {
        return Err(AppError::Validation(
            "Message must be 1-4000 characters".into(),
        ));
    }
    if let Some(matched) =
        automod::evaluate_message(&state.db, server_id, channel_id, claims.sub, &content).await?
    {
        automod::log_blocked_message(&state.db, claims.sub, server_id, channel_id, &matched, &content)
            .await?;
        return Err(AppError::Forbidden(format!(
            "Message blocked by AutoMod rule: {}",
            matched.rule_name
        )));
    }

    sqlx::query("UPDATE messages SET content = $1, edited_at = NOW() WHERE id = $2")
        .bind(&content)
        .bind(message_id)
        .execute(&state.db)
        .await?;

    let (before_preview, before_truncated) = audit_content_preview(&previous_content);
    let (after_preview, after_truncated) = audit_content_preview(&content);
    crate::services::audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "message_edit",
        "message",
        Some(message_id),
        Some(serde_json::json!({
            "channel_id": channel_id,
            "changed": previous_content != content,
            "before_preview": before_preview,
            "after_preview": after_preview,
            "before_truncated": before_truncated,
            "after_truncated": after_truncated
        })),
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
    .bind(message_id)
    .fetch_one(&state.db)
    .await?;

    let mut msg_with_author: MessageWithAuthor = row.into();
    attach_message_reactions(
        &state.db,
        std::slice::from_mut(&mut msg_with_author),
        claims.sub,
    )
    .await?;
    msg_with_author.attachments = state
        .attachment_service
        .hydrate_attachments_for_output(
            &state.db,
            &state.jwt_secret,
            msg_with_author.attachments.clone(),
        )
        .await?;

    crate::ws::publish_event(
        &state,
        WsEvent::MessageUpdated {
            channel_id,
            message: msg_with_author.clone(),
        },
    )
    .await;

    Ok(Json(msg_with_author))
}

async fn load_message_with_author(
    db: &sqlx::PgPool,
    message_id: Uuid,
) -> Result<MessageWithAuthor, AppError> {
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
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound("Message not found".into()))?;

    Ok(row.into())
}

/// POST /api/messages/item/:message_id/reactions — add emoji reaction.
async fn add_message_reaction(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
    Json(body): Json<AddReactionRequest>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    let emoji = normalize_reaction_emoji(&body.emoji)?;
    let channel_id: Uuid = sqlx::query_scalar("SELECT channel_id FROM messages WHERE id = $1")
        .bind(message_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Message not found".into()))?;

    check_channel_access(&state, channel_id, claims.sub).await?;
    let server_id = server_id_for_channel(&state.db, channel_id).await?;
    moderation::ensure_not_timed_out(&state.db, server_id, claims.sub).await?;
    permissions::ensure_channel_permission(
        &state.db,
        channel_id,
        claims.sub,
        Permissions::SEND_MESSAGES,
    )
    .await?;

    let mut tx = state.db.begin().await?;
    let locked_channel_id: Uuid =
        sqlx::query_scalar("SELECT channel_id FROM messages WHERE id = $1 FOR UPDATE")
            .bind(message_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(AppError::NotFound("Message not found".into()))?;
    if locked_channel_id != channel_id {
        return Err(AppError::Forbidden("Message channel changed".into()));
    }

    let emoji_already_present = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM message_reactions
               WHERE message_id = $1 AND emoji = $2
           )"#,
    )
    .bind(message_id)
    .bind(&emoji)
    .fetch_one(&mut *tx)
    .await?;

    if !emoji_already_present {
        let distinct_emoji_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(DISTINCT emoji) FROM message_reactions WHERE message_id = $1",
        )
        .bind(message_id)
        .fetch_one(&mut *tx)
        .await?;
        if distinct_emoji_count >= 20 {
            return Err(AppError::Validation(
                "This message already has the maximum of 20 different reactions".into(),
            ));
        }
    }

    sqlx::query(
        r#"INSERT INTO message_reactions (message_id, user_id, emoji)
           VALUES ($1, $2, $3)
           ON CONFLICT (message_id, user_id, emoji) DO NOTHING"#,
    )
    .bind(message_id)
    .bind(claims.sub)
    .bind(&emoji)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let mut msg_with_author = load_message_with_author(&state.db, message_id).await?;
    attach_message_reactions(
        &state.db,
        std::slice::from_mut(&mut msg_with_author),
        claims.sub,
    )
    .await?;
    msg_with_author.attachments = state
        .attachment_service
        .hydrate_attachments_for_output(
            &state.db,
            &state.jwt_secret,
            msg_with_author.attachments.clone(),
        )
        .await?;

    crate::ws::publish_event(
        &state,
        WsEvent::MessageUpdated {
            channel_id,
            message: msg_with_author.clone(),
        },
    )
    .await;

    Ok(Json(msg_with_author))
}

/// DELETE /api/messages/item/:message_id/reactions?emoji=... — remove emoji reaction.
async fn remove_message_reaction(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
    Query(query): Query<RemoveReactionQuery>,
) -> Result<Json<MessageWithAuthor>, AppError> {
    let emoji = normalize_reaction_emoji(&query.emoji)?;
    let channel_id: Uuid = sqlx::query_scalar("SELECT channel_id FROM messages WHERE id = $1")
        .bind(message_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Message not found".into()))?;

    check_channel_access(&state, channel_id, claims.sub).await?;
    permissions::ensure_channel_permission(
        &state.db,
        channel_id,
        claims.sub,
        Permissions::SEND_MESSAGES,
    )
    .await?;

    sqlx::query(
        r#"DELETE FROM message_reactions
           WHERE message_id = $1 AND user_id = $2 AND emoji = $3"#,
    )
    .bind(message_id)
    .bind(claims.sub)
    .bind(&emoji)
    .execute(&state.db)
    .await?;

    let mut msg_with_author = load_message_with_author(&state.db, message_id).await?;
    attach_message_reactions(
        &state.db,
        std::slice::from_mut(&mut msg_with_author),
        claims.sub,
    )
    .await?;
    msg_with_author.attachments = state
        .attachment_service
        .hydrate_attachments_for_output(
            &state.db,
            &state.jwt_secret,
            msg_with_author.attachments.clone(),
        )
        .await?;

    crate::ws::publish_event(
        &state,
        WsEvent::MessageUpdated {
            channel_id,
            message: msg_with_author.clone(),
        },
    )
    .await;

    Ok(Json(msg_with_author))
}

async fn server_id_for_channel(db: &sqlx::PgPool, channel_id: Uuid) -> Result<Uuid, AppError> {
    sqlx::query_scalar("SELECT server_id FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(db)
        .await?
        .ok_or(AppError::NotFound("Channel not found".into()))
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

#[cfg(test)]
mod tests {
    use super::neutralize_mass_mentions;

    #[test]
    fn neutralizes_everyone_and_here_mentions() {
        let content = "@everyone please check. Also @here now.";
        let out = neutralize_mass_mentions(content);
        assert!(out.contains("@\u{200B}everyone"));
        assert!(out.contains("@\u{200B}here"));
    }

    #[test]
    fn keeps_non_mass_mentions_unchanged() {
        let content = "@emircan can you review this?";
        assert_eq!(neutralize_mass_mentions(content), content);
    }

    #[test]
    fn keeps_embedded_words_unchanged() {
        let content = "email@everyone.example should not be touched";
        assert_eq!(neutralize_mass_mentions(content), content);
    }
}
