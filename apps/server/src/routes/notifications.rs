//! Unread, mention and mute state of server channels, kept per account so every device shows
//! the same badges.

use axum::{
    extract::{Path, State},
    middleware,
    routing::{get, post, put},
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use std::{
    collections::{hash_map::Entry, HashMap, HashSet},
    sync::Arc,
    time::Duration,
};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth_and_current_legal_consent, Claims},
    services::{
        permissions::{self, Permissions, ServerPermissionSnapshot},
        rate_limit::enforce_rate_limit,
    },
    ws::WsEvent,
    AppState,
};

/// Counts stop here; the clients show larger numbers as "99+".
const COUNT_CAP: i64 = 99;
const MAX_MUTE_TARGETS_PER_REQUEST: usize = 200;
const READ_MARKS_PER_MINUTE: usize = 120;
const MUTE_CHANGES_PER_MINUTE: usize = 60;

#[derive(Debug, serde::Serialize)]
struct ChannelNotificationState {
    channel_id: Uuid,
    server_id: Uuid,
    /// Messages from other people after the read mark, at most 99.
    unread_count: i64,
    /// Mentions by name plus `@everyone`/`@here` messages after the read mark, at most 99.
    mention_count: i64,
}

#[derive(Debug, serde::Serialize)]
struct NotificationState {
    /// Only channels with something unread; a channel that is missing is read.
    channels: Vec<ChannelNotificationState>,
    muted_server_ids: Vec<Uuid>,
    muted_channel_ids: Vec<Uuid>,
}

#[derive(Debug, serde::Serialize)]
struct MuteState {
    muted_server_ids: Vec<Uuid>,
    muted_channel_ids: Vec<Uuid>,
}

#[derive(Debug, serde::Deserialize)]
struct MarkChannelReadRequest {
    /// The newest message the client has shown; the latest message of the channel when absent.
    #[serde(default)]
    message_id: Option<Uuid>,
}

#[derive(Debug, serde::Serialize)]
struct ChannelReadState {
    channel_id: Uuid,
    last_read_at: Option<DateTime<Utc>>,
}

#[derive(Debug, serde::Deserialize)]
struct UpdateMutesRequest {
    #[serde(default)]
    server_ids: Vec<Uuid>,
    #[serde(default)]
    channel_ids: Vec<Uuid>,
    muted: bool,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/state", get(get_notification_state))
        .route("/channels/{channel_id}/read", post(mark_channel_read))
        .route("/mutes", put(update_mutes))
        .route_layer(middleware::from_fn_with_state(
            state,
            require_auth_and_current_legal_consent,
        ))
}

async fn load_mutes(db: &sqlx::PgPool, user_id: Uuid) -> Result<MuteState, AppError> {
    let rows = sqlx::query_as::<_, (Option<Uuid>, Option<Uuid>)>(
        "SELECT server_id, channel_id FROM notification_mutes WHERE user_id = $1 ORDER BY created_at",
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;
    Ok(MuteState {
        muted_server_ids: rows.iter().filter_map(|row| row.0).collect(),
        muted_channel_ids: rows.iter().filter_map(|row| row.1).collect(),
    })
}

/// GET /api/notifications/state — unread and mention counts of the caller's server channels and
/// what they muted. Channels the caller cannot see are left out.
async fn get_notification_state(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<NotificationState>, AppError> {
    // A channel without a read mark counts as read up to the moment the member joined, so a
    // new member does not find the whole history unread.
    let rows = sqlx::query_as::<_, (Uuid, Uuid, i64, i64)>(
        r#"SELECT c.id, c.server_id, counts.unread, counts.mentions
           FROM channels c
           INNER JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
           LEFT JOIN channel_reads r ON r.channel_id = c.id AND r.user_id = $1
           CROSS JOIN LATERAL (SELECT COALESCE(r.last_read_at, sm.joined_at) AS at) mark
           CROSS JOIN LATERAL (
               SELECT
                   (SELECT COUNT(*) FROM (
                        SELECT 1 FROM messages m
                        WHERE m.channel_id = c.id AND m.created_at > mark.at AND m.user_id <> $1
                        LIMIT $2
                    ) unread_messages) AS unread,
                   LEAST($2,
                       (SELECT COUNT(*) FROM (
                            SELECT 1 FROM message_mentions mm
                            WHERE mm.user_id = $1 AND mm.channel_id = c.id
                              AND mm.created_at > mark.at
                            LIMIT $2
                        ) named)
                       + (SELECT COUNT(*) FROM (
                            SELECT 1 FROM messages m
                            WHERE m.channel_id = c.id AND m.mention_everyone
                              AND m.created_at > mark.at AND m.user_id <> $1
                            LIMIT $2
                        ) everyone)
                   ) AS mentions
           ) counts
           WHERE c.channel_type = 'text' AND counts.unread > 0"#,
    )
    .bind(claims.sub)
    .bind(COUNT_CAP)
    .fetch_all(&state.db)
    .await?;

    // One permission snapshot per server that has something unread.
    let mut snapshots: HashMap<Uuid, ServerPermissionSnapshot> = HashMap::new();
    let mut channels = Vec::with_capacity(rows.len());
    for (channel_id, server_id, unread_count, mention_count) in rows {
        if let Entry::Vacant(slot) = snapshots.entry(server_id) {
            slot.insert(
                ServerPermissionSnapshot::load(&state.db, server_id, Some(&[claims.sub])).await?,
            );
        }
        let visible = snapshots[&server_id]
            .channel_permissions(channel_id, claims.sub)
            .contains(Permissions::VIEW_SERVER);
        if visible {
            channels.push(ChannelNotificationState {
                channel_id,
                server_id,
                unread_count,
                mention_count,
            });
        }
    }

    let mutes = load_mutes(&state.db, claims.sub).await?;
    Ok(Json(NotificationState {
        channels,
        muted_server_ids: mutes.muted_server_ids,
        muted_channel_ids: mutes.muted_channel_ids,
    }))
}

/// POST /api/notifications/channels/:channel_id/read — move the caller's read mark of a channel
/// forward. The mark is the creation time of the last message read, never the time of reading,
/// so a message that arrives while the request travels is not marked read by accident.
async fn mark_channel_read(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<MarkChannelReadRequest>,
) -> Result<Json<ChannelReadState>, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("notifications:read:user:{}", claims.sub),
        READ_MARKS_PER_MINUTE,
        Duration::from_secs(60),
        "Too many read updates. Please slow down.",
    )
    .await?;

    let channel_perms =
        permissions::get_user_channel_permissions(&state.db, channel_id, claims.sub).await?;
    if !channel_perms.contains(Permissions::VIEW_SERVER) {
        return Err(AppError::Forbidden("No access to this channel".into()));
    }

    let named = match body.message_id {
        Some(message_id) => {
            sqlx::query_as::<_, (Uuid, DateTime<Utc>)>(
                "SELECT id, created_at FROM messages WHERE id = $1 AND channel_id = $2",
            )
            .bind(message_id)
            .bind(channel_id)
            .fetch_optional(&state.db)
            .await?
        }
        None => None,
    };
    // A message that was deleted meanwhile, or none named: read up to the newest message.
    let target = match named {
        Some(target) => Some(target),
        None => {
            sqlx::query_as::<_, (Uuid, DateTime<Utc>)>(
                r#"SELECT id, created_at FROM messages
                   WHERE channel_id = $1
                   ORDER BY created_at DESC
                   LIMIT 1"#,
            )
            .bind(channel_id)
            .fetch_optional(&state.db)
            .await?
        }
    };
    let Some((message_id, read_at)) = target else {
        return Ok(Json(ChannelReadState {
            channel_id,
            last_read_at: None,
        }));
    };

    // Forward only: an older request arriving late never moves the mark back.
    let moved = sqlx::query(
        r#"INSERT INTO channel_reads (user_id, channel_id, last_read_message_id, last_read_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, channel_id) DO UPDATE
               SET last_read_message_id = EXCLUDED.last_read_message_id,
                   last_read_at = EXCLUDED.last_read_at,
                   updated_at = NOW()
               WHERE channel_reads.last_read_at < EXCLUDED.last_read_at"#,
    )
    .bind(claims.sub)
    .bind(channel_id)
    .bind(message_id)
    .bind(read_at)
    .execute(&state.db)
    .await?
    .rows_affected()
        > 0;

    let last_read_at: DateTime<Utc> = if moved {
        read_at
    } else {
        sqlx::query_scalar(
            "SELECT last_read_at FROM channel_reads WHERE user_id = $1 AND channel_id = $2",
        )
        .bind(claims.sub)
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?
    };
    if moved {
        // The caller's other sessions clear the same badge.
        crate::ws::publish_user_event(
            &state,
            claims.sub,
            WsEvent::ChannelRead {
                channel_id,
                user_id: claims.sub,
                last_read_at,
            },
        )
        .await;
    }

    Ok(Json(ChannelReadState {
        channel_id,
        last_read_at: Some(last_read_at),
    }))
}

/// PUT /api/notifications/mutes — mute or unmute servers and channels. Targets the caller is not
/// a member of are ignored, so nothing can be learned about them.
async fn update_mutes(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateMutesRequest>,
) -> Result<Json<MuteState>, AppError> {
    if body.server_ids.len() > MAX_MUTE_TARGETS_PER_REQUEST
        || body.channel_ids.len() > MAX_MUTE_TARGETS_PER_REQUEST
    {
        return Err(AppError::Validation(format!(
            "At most {MAX_MUTE_TARGETS_PER_REQUEST} servers and channels per request"
        )));
    }
    enforce_rate_limit(
        &state.redis,
        format!("notifications:mutes:user:{}", claims.sub),
        MUTE_CHANGES_PER_MINUTE,
        Duration::from_secs(60),
        "Too many notification changes. Please slow down.",
    )
    .await?;

    let server_ids: Vec<Uuid> = body
        .server_ids
        .into_iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let channel_ids: Vec<Uuid> = body
        .channel_ids
        .into_iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    let mut tx = state.db.begin().await?;
    if body.muted {
        sqlx::query(
            r#"INSERT INTO notification_mutes (user_id, server_id)
               SELECT $1, sm.server_id
               FROM server_members sm
               WHERE sm.user_id = $1 AND sm.server_id = ANY($2)
               ON CONFLICT (user_id, server_id) WHERE server_id IS NOT NULL DO NOTHING"#,
        )
        .bind(claims.sub)
        .bind(&server_ids)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"INSERT INTO notification_mutes (user_id, channel_id)
               SELECT $1, c.id
               FROM channels c
               INNER JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
               WHERE c.id = ANY($2)
               ON CONFLICT (user_id, channel_id) WHERE channel_id IS NOT NULL DO NOTHING"#,
        )
        .bind(claims.sub)
        .bind(&channel_ids)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            r#"DELETE FROM notification_mutes
               WHERE user_id = $1 AND (server_id = ANY($2) OR channel_id = ANY($3))"#,
        )
        .bind(claims.sub)
        .bind(&server_ids)
        .bind(&channel_ids)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(Json(load_mutes(&state.db, claims.sub).await?))
}
