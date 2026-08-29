use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket},
        Request, State, WebSocketUpgrade,
    },
    http::header,
    response::{IntoResponse, Response},
};
use futures::{SinkExt, StreamExt};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc;
use uuid::Uuid;

use super::{WsClientMessage, WsEvent};
use crate::middleware::auth::token_from_request;
use crate::middleware::auth::{claims_match_current_token_version, Claims};
use crate::services::permissions::{get_user_server_permissions, Permissions};
use crate::services::voice_revoke;
use crate::ws::access::{can_join_voice_channel, can_subscribe_to_channel};
use crate::AppState;

async fn server_id_for_channel(db: &sqlx::PgPool, channel_id: Uuid) -> Option<Uuid> {
    sqlx::query_scalar::<_, Uuid>("SELECT server_id FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
}

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn channel_has_voice_participants(state: &AppState, channel_id: Uuid) -> bool {
    state
        .voice_sessions
        .iter()
        .any(|entry| *entry.value() == channel_id)
}

fn ensure_voice_channel_active_since_ms(state: &AppState, channel_id: Uuid) -> u64 {
    if let Some(existing) = state.voice_channel_active_since_ms.get(&channel_id) {
        return *existing;
    }
    let now = current_epoch_ms();
    let entry = state
        .voice_channel_active_since_ms
        .entry(channel_id)
        .or_insert(now);
    *entry
}

fn cleanup_voice_channel_active_since_if_empty(state: &AppState, channel_id: Uuid) {
    if !channel_has_voice_participants(state, channel_id) {
        state.voice_channel_active_since_ms.remove(&channel_id);
    }
}

/// Max incoming WebSocket text message size (256 KB) to mitigate DoS via huge Signal payloads.
const MAX_WS_MESSAGE_BYTES: usize = 256 * 1024;
const WS_MESSAGE_RATE_LIMIT_MAX: usize = 120;
const WS_MESSAGE_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(10);
const WS_CLIENT_IDLE_TIMEOUT: Duration = Duration::from_secs(75);

async fn enforce_ws_frame_rate_limit(
    state: &AppState,
    user_id: Uuid,
) -> Result<(), crate::errors::AppError> {
    crate::services::rate_limit::enforce_rate_limit(
        &state.redis,
        format!("ws:message:{}", user_id),
        WS_MESSAGE_RATE_LIMIT_MAX,
        WS_MESSAGE_RATE_LIMIT_WINDOW,
        "Too many WebSocket messages. Please slow down.",
    )
    .await
}

fn voice_control_event_from_state(
    user_id: Uuid,
    server_id: Option<Uuid>,
    state: (bool, bool, bool, bool, bool, bool),
) -> WsEvent {
    let (self_muted, self_deafened, server_muted, server_deafened, screen_sharing, camera_on) =
        state;
    WsEvent::VoiceControlUpdate {
        user_id,
        server_id,
        muted: self_muted || server_muted,
        deafened: self_deafened || server_deafened,
        server_muted,
        server_deafened,
        screen_sharing,
        camera_on,
    }
}

fn screen_share_viewer_event(
    viewer_id: Uuid,
    publisher_id: Uuid,
    channel_id: Uuid,
    server_id: Option<Uuid>,
    watching: bool,
) -> WsEvent {
    WsEvent::ScreenShareViewerUpdate {
        viewer_id,
        publisher_id,
        channel_id,
        server_id,
        watching,
    }
}

fn clear_screen_share_viewer_entries_for_user(state: &AppState, user_id: Uuid) {
    state
        .screen_share_viewers
        .retain(|(viewer_id, publisher_id), _| *viewer_id != user_id && *publisher_id != user_id);
}

async fn clear_screen_share_viewers_for_publisher(
    state: &Arc<AppState>,
    publisher_id: Uuid,
    channel_id: Uuid,
    server_id: Option<Uuid>,
) {
    let viewer_ids = state
        .screen_share_viewers
        .iter()
        .filter_map(|entry| {
            let ((viewer_id, entry_publisher_id), _) = entry.pair();
            (*entry_publisher_id == publisher_id).then_some(*viewer_id)
        })
        .collect::<Vec<_>>();

    for viewer_id in viewer_ids {
        if state
            .screen_share_viewers
            .remove(&(viewer_id, publisher_id))
            .is_some()
        {
            super::publish_event(
                state,
                screen_share_viewer_event(viewer_id, publisher_id, channel_id, server_id, false),
            )
            .await;
        }
    }
}

fn visible_presence_from_preference(status: &str) -> &'static str {
    match status.to_ascii_lowercase().as_str() {
        "dnd" => "dnd",
        "invisible" | "offline" => "offline",
        _ => "online",
    }
}

async fn users_share_server_or_are_friends(
    db: &sqlx::PgPool,
    a_user_id: Uuid,
    b_user_id: Uuid,
) -> bool {
    if a_user_id == b_user_id {
        return true;
    }
    sqlx::query_scalar::<_, bool>(
        r#"SELECT (
            EXISTS (
                SELECT 1
                FROM servers s
                WHERE
                    (
                        s.owner_id = $1
                        OR EXISTS (
                            SELECT 1 FROM server_members sm1
                            WHERE sm1.server_id = s.id AND sm1.user_id = $1
                        )
                    )
                    AND
                    (
                        s.owner_id = $2
                        OR EXISTS (
                            SELECT 1 FROM server_members sm2
                            WHERE sm2.server_id = s.id AND sm2.user_id = $2
                        )
                    )
            )
            OR EXISTS (
                SELECT 1
                FROM friendships f
                WHERE
                    (f.user_a = $1 AND f.user_b = $2)
                    OR
                    (f.user_a = $2 AND f.user_b = $1)
            )
        )"#,
    )
    .bind(a_user_id)
    .bind(b_user_id)
    .fetch_one(db)
    .await
    .unwrap_or(false)
}

async fn user_in_server(db: &sqlx::PgPool, user_id: Uuid, server_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
            SELECT 1
            FROM servers s
            WHERE s.id = $1
              AND (
                    s.owner_id = $2
                    OR EXISTS (
                        SELECT 1
                        FROM server_members sm
                        WHERE sm.server_id = s.id AND sm.user_id = $2
                    )
              )
        )"#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(db)
    .await
    .unwrap_or(false)
}

async fn can_receive_subscribed_channel_event(
    db: &sqlx::PgPool,
    user_id: Uuid,
    subscribed_channels: &tokio::sync::RwLock<HashSet<Uuid>>,
    channel_id: Uuid,
) -> bool {
    let is_subscribed = { subscribed_channels.read().await.contains(&channel_id) };
    if !is_subscribed {
        return false;
    }

    match can_subscribe_to_channel(db, user_id, channel_id).await {
        Ok(true) => true,
        Ok(false) => false,
        Err(e) => {
            tracing::warn!(
                "WS event authorization re-check failed for user {} channel {}: {}",
                user_id,
                channel_id,
                e
            );
            false
        }
    }
}

fn is_allowed_ws_origin(req: &Request, state: &AppState) -> bool {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    is_allowed_origin_value(origin, &state.cors_origins)
}

fn is_allowed_origin_value(origin: Option<&str>, allowed_origins: &[String]) -> bool {
    let Some(origin) = origin else {
        return false;
    };
    allowed_origins.iter().any(|allowed| allowed == origin)
}

fn token_from_ws_protocol(headers: &axum::http::HeaderMap) -> Option<String> {
    let raw = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|v| v.to_str().ok())?;
    let mut parts = raw.split(',').map(str::trim);
    let auth_marker = parts.next()?;
    if auth_marker != "voxpery.auth" {
        return None;
    }
    let token = parts.next()?.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

/// GET /ws — Upgrade to WebSocket.
/// Desktop can send token via `Sec-WebSocket-Protocol: voxpery.auth,<jwt>` (preferred)
/// and web uses cookie auth.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    req: Request,
) -> Response {
    let protocol_token = token_from_ws_protocol(req.headers());
    let using_cookie_auth = protocol_token.is_none();

    if using_cookie_auth && !is_allowed_ws_origin(&req, &state) {
        return (axum::http::StatusCode::FORBIDDEN, "Forbidden origin").into_response();
    }

    let token: Option<String> = {
        if let Some(t) = protocol_token.clone() {
            Some(t)
        } else {
            token_from_request(req.headers(), &state.cookie_name)
        }
    };

    let token = match token {
        Some(t) => t,
        None => {
            return (axum::http::StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
        }
    };

    let claims = match validate_ws_token(&token, &state).await {
        Some(claims) => claims,
        None => {
            return (axum::http::StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
        }
    };

    if let Err(e) = crate::services::rate_limit::enforce_rate_limit(
        &state.redis,
        format!("ws:{}", claims.sub),
        3,
        std::time::Duration::from_secs(10),
        "Too many connection attempts. Please slow down.",
    )
    .await
    {
        return (axum::http::StatusCode::TOO_MANY_REQUESTS, e.to_string()).into_response();
    }

    let ws = if protocol_token.is_some() {
        ws.protocols(["voxpery.auth"])
    } else {
        ws
    };

    ws.on_upgrade(move |socket| handle_socket(socket, state, claims, token))
}

async fn validate_ws_token(
    token: &str,
    state: &AppState,
) -> Option<crate::middleware::auth::Claims> {
    match crate::services::jwt_blacklist::is_blacklisted(&state.redis, token).await {
        Ok(true) => return None,
        Ok(false) => {}
        Err(e) => {
            tracing::warn!("Redis JWT blacklist check failed during WS auth: {}", e);
            return None;
        }
    }

    use jsonwebtoken::{decode, DecodingKey, Validation};
    let claims = decode::<crate::middleware::auth::Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .ok()?
    .claims;

    let version_ok = claims_match_current_token_version(&state.db, claims.sub, claims.ver)
        .await
        .ok()?;
    if !version_ok {
        return None;
    }

    Some(claims)
}

async fn is_ws_session_still_valid(state: &AppState, token: &str, claims: &Claims) -> bool {
    let now = chrono::Utc::now().timestamp();
    if now >= claims.exp as i64 {
        return false;
    }

    match crate::services::jwt_blacklist::is_blacklisted(&state.redis, token).await {
        Ok(true) => return false,
        Ok(false) => {}
        Err(e) => {
            tracing::warn!(
                "Redis JWT blacklist check failed during WS session validation: {}",
                e
            );
            return false;
        }
    }

    matches!(
        claims_match_current_token_version(&state.db, claims.sub, claims.ver).await,
        Ok(true)
    )
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, claims: Claims, token: String) {
    let user_id = claims.sub;
    let username = sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| claims.username.clone());
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Create a channel for sending events to this client
    let (tx, mut rx) = mpsc::unbounded_channel::<WsEvent>();

    // Register this session
    state.sessions.entry(user_id).or_default().push(tx.clone());

    // Subscribe to broadcast channel
    let mut broadcast_rx = state.tx.subscribe();

    // Track which channels this user is subscribed to
    let subscribed_channels: Arc<tokio::sync::RwLock<HashSet<Uuid>>> =
        Arc::new(tokio::sync::RwLock::new(HashSet::new()));
    let subscribed_channel_servers: Arc<tokio::sync::RwLock<HashMap<Uuid, Uuid>>> =
        Arc::new(tokio::sync::RwLock::new(HashMap::new()));
    // Per-session server scope derived from subscribed channels: server_id -> channel count.
    let subscribed_server_counts: Arc<tokio::sync::RwLock<HashMap<Uuid, usize>>> =
        Arc::new(tokio::sync::RwLock::new(HashMap::new()));

    let sub_channels = subscribed_channels.clone();
    let sub_server_counts = subscribed_server_counts.clone();
    let send_state = state.clone();
    let send_claims = claims.clone();
    let send_token = token.clone();

    // Do not overwrite persisted status on connect (online/dnd/offline).
    let current_status =
        match sqlx::query_scalar::<_, String>("SELECT status FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
        {
            Ok(Some(status)) => status,
            Ok(None) => "online".to_string(),
            Err(e) => {
                tracing::warn!("Failed to read user status on WS connect: {}", e);
                "online".to_string()
            }
        };
    super::publish_event(
        &state,
        WsEvent::PresenceUpdate {
            user_id,
            status: visible_presence_from_preference(&current_status).to_string(),
        },
    )
    .await;

    tracing::info!("WebSocket connected: {} ({})", username, user_id);

    // Task: forward broadcast events to this client (if subscribed) + server-side keepalive
    let send_task = tokio::spawn(async move {
        // Server-side WebSocket keepalive: detect stale connections (laptop sleep, network
        // drop without FIN) that would otherwise linger for minutes until OS TCP timeout.
        let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(30));
        ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut auth_refresh_interval = tokio::time::interval(Duration::from_secs(30));
        auth_refresh_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // Skip the immediate first tick
        ping_interval.tick().await;
        auth_refresh_interval.tick().await;

        loop {
            tokio::select! {
                _ = auth_refresh_interval.tick() => {
                    if !is_ws_session_still_valid(&send_state, &send_token, &send_claims).await {
                        let _ = ws_sender.send(Message::Close(Some(CloseFrame {
                            code: 4001,
                            reason: "Authentication expired".into(),
                        }))).await;
                        break;
                    }
                }
                // Server-side WS ping (Ping frame; browser/axum auto-reply with Pong)
                _ = ping_interval.tick() => {
                    if ws_sender.send(Message::Ping(vec![].into())).await.is_err() {
                        break;
                    }
                }
                // Events from broadcast channel
                result = broadcast_rx.recv() => {
                    let event = match result {
                        Ok(ev) => ev,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!("Broadcast receiver lagged by {} events (user {})", n, user_id);
                            continue;
                        }
                        Err(_) => break,
                    };
                    let should_send = match &event {
                        WsEvent::NewMessage {
                            channel_id,
                            channel_type: _,
                            ..
                        }
                        | WsEvent::Typing { channel_id, .. }
                        | WsEvent::MessageDeleted { channel_id, .. }
                        | WsEvent::MessageUpdated { channel_id, .. } => {
                            can_receive_subscribed_channel_event(
                                &send_state.db,
                                user_id,
                                &sub_channels,
                                *channel_id,
                            )
                            .await
                        }
                        WsEvent::FriendUpdate { user_id: target_user_id } => {
                            *target_user_id == user_id
                        }
                        WsEvent::DmRead {
                            user_id: target_user_id,
                            ..
                        } => *target_user_id == user_id,
                        WsEvent::PresenceUpdate { user_id: changed_user_id, .. } => {
                            users_share_server_or_are_friends(
                                &send_state.db,
                                user_id,
                                *changed_user_id,
                            )
                            .await
                        }
                        WsEvent::UserUpdated { user } => {
                            users_share_server_or_are_friends(&send_state.db, user_id, user.id)
                                .await
                        }
                        WsEvent::MemberJoined { server_id, .. }
                        | WsEvent::MemberLeft { server_id, .. }
                        | WsEvent::MemberRoleUpdated { server_id, .. }
                        | WsEvent::ServerRolesUpdated { server_id }
                        | WsEvent::ServerChannelsUpdated { server_id } => {
                            user_in_server(&send_state.db, user_id, *server_id).await
                        }
                        WsEvent::VoiceStateUpdate { server_id, .. }
                        | WsEvent::VoiceControlUpdate { server_id, .. }
                        | WsEvent::ScreenShareViewerUpdate { server_id, .. } => {
                            match server_id {
                                Some(sid) => {
                                    // Re-check current membership so users that were removed from
                                    // the server stop receiving voice-related events immediately.
                                    if !user_in_server(&send_state.db, user_id, *sid).await {
                                        false
                                    } else {
                                    let subscribed_to_server = sub_server_counts
                                        .read()
                                        .await
                                        .get(sid)
                                        .copied()
                                        .unwrap_or(0)
                                        > 0;
                                    if subscribed_to_server {
                                        true
                                    } else {
                                        // Voice participants should continue receiving voice state/control
                                        // updates even when they're not actively subscribed to text channels
                                        // (e.g. while viewing Home/DM pages).
                                        let my_voice_channel =
                                            send_state.voice_sessions.get(&user_id).map(|r| *r);
                                        if let Some(my_channel_id) = my_voice_channel {
                                            server_id_for_channel(&send_state.db, my_channel_id)
                                                .await
                                                == Some(*sid)
                                        } else {
                                            false
                                        }
                                    }
                                    }
                                }
                                None => false,
                            }
                        }
                        WsEvent::Pong { .. } => false,
                        WsEvent::Signal { .. } => false,
                    };

                    if should_send {
                        match serde_json::to_string(&event) {
                            Ok(json) => {
                                if ws_sender.send(Message::Text(json.into())).await.is_err() {
                                    break;
                                }
                            }
                            Err(e) => {
                                tracing::warn!("WS broadcast serialization failed: {}", e);
                            }
                        }
                    }
                }
                // Events from direct channel (targeted to this user)
                Some(event) = rx.recv() => {
                    match serde_json::to_string(&event) {
                        Ok(json) => {
                            if ws_sender.send(Message::Text(json.into())).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            tracing::warn!("WS direct serialization failed: {}", e);
                        }
                    }
                }
                else => break,
            }
        }
    });

    // Task: receive messages from client
    let recv_state = state.clone();
    let recv_sub = subscribed_channels.clone();
    let recv_sub_channel_servers = subscribed_channel_servers.clone();
    let recv_sub_server_counts = subscribed_server_counts.clone();
    let client_tx = tx.clone();
    let recv_claims = claims.clone();
    let recv_token = token.clone();
    let recv_task = tokio::spawn(async move {
        loop {
            let msg = match tokio::time::timeout(WS_CLIENT_IDLE_TIMEOUT, ws_receiver.next()).await {
                Ok(Some(Ok(msg))) => msg,
                Ok(Some(Err(e))) => {
                    tracing::warn!("WebSocket receive error for {}: {}", user_id, e);
                    break;
                }
                Ok(None) => break,
                Err(_) => {
                    tracing::warn!(
                        "WebSocket idle timeout (zombie session) for user {}; closing connection",
                        user_id
                    );
                    break;
                }
            };
            if !is_ws_session_still_valid(&recv_state, &recv_token, &recv_claims).await {
                break;
            }
            match msg {
                Message::Text(text) => {
                    if let Err(e) = enforce_ws_frame_rate_limit(&recv_state, user_id).await {
                        tracing::warn!(
                            "Closing WS for rate limit breach (user {}): {}",
                            user_id,
                            e
                        );
                        break;
                    }
                    if text.len() > MAX_WS_MESSAGE_BYTES {
                        tracing::warn!(
                            "WebSocket message too large ({} bytes), ignoring",
                            text.len()
                        );
                        continue;
                    }
                    if let Ok(client_msg) = serde_json::from_str::<WsClientMessage>(&text) {
                        match client_msg {
                            WsClientMessage::Subscribe { channel_ids } => {
                                let mut allowed: Vec<Uuid> = Vec::new();
                                for id in channel_ids {
                                    match can_subscribe_to_channel(&recv_state.db, user_id, id)
                                        .await
                                    {
                                        Ok(true) => allowed.push(id),
                                        Ok(false) => {
                                            tracing::debug!(
                                                "Subscribe denied for channel {} (user {})",
                                                id,
                                                user_id
                                            );
                                        }
                                        Err(e) => {
                                            tracing::warn!("Subscribe access check failed: {}", e);
                                        }
                                    }
                                }
                                let mut subs = recv_sub.write().await;
                                let mut newly_added: Vec<Uuid> = Vec::new();
                                for id in allowed {
                                    if subs.insert(id) {
                                        newly_added.push(id);
                                    }
                                }
                                drop(subs);

                                // Send current voice occupants for newly subscribed channels,
                                // so clients can render participant list without having to join.
                                for cid in newly_added {
                                    let server_id =
                                        server_id_for_channel(&recv_state.db, cid).await;
                                    if let Some(sid) = server_id {
                                        let mut by_channel = recv_sub_channel_servers.write().await;
                                        by_channel.insert(cid, sid);
                                        drop(by_channel);
                                        let mut counts = recv_sub_server_counts.write().await;
                                        *counts.entry(sid).or_insert(0) += 1;
                                    }
                                    for entry in recv_state.voice_sessions.iter() {
                                        let (other_uid, other_cid) = entry.pair();
                                        if *other_cid == cid {
                                            let channel_active_since_ms =
                                                ensure_voice_channel_active_since_ms(
                                                    &recv_state,
                                                    cid,
                                                );
                                            let _ = client_tx.send(WsEvent::VoiceStateUpdate {
                                                channel_id: Some(cid),
                                                user_id: *other_uid,
                                                server_id,
                                                channel_active_since_ms: Some(
                                                    channel_active_since_ms,
                                                ),
                                            });
                                            let control_state = recv_state
                                                .voice_controls
                                                .get(other_uid)
                                                .map(|s| *s)
                                                .unwrap_or((
                                                    false, false, false, false, false, false,
                                                ));
                                            let _ = client_tx.send(voice_control_event_from_state(
                                                *other_uid,
                                                server_id,
                                                control_state,
                                            ));
                                        }
                                    }
                                    for entry in recv_state.screen_share_viewers.iter() {
                                        let ((viewer_id, publisher_id), _) = entry.pair();
                                        let viewer_channel = recv_state
                                            .voice_sessions
                                            .get(viewer_id)
                                            .map(|entry| *entry);
                                        let publisher_channel = recv_state
                                            .voice_sessions
                                            .get(publisher_id)
                                            .map(|entry| *entry);
                                        if viewer_channel != Some(cid)
                                            || publisher_channel != Some(cid)
                                        {
                                            continue;
                                        }
                                        let _ = client_tx.send(screen_share_viewer_event(
                                            *viewer_id,
                                            *publisher_id,
                                            cid,
                                            server_id,
                                            true,
                                        ));
                                    }
                                }
                            }
                            WsClientMessage::Unsubscribe { channel_ids } => {
                                let mut subs = recv_sub.write().await;
                                let mut removed: Vec<Uuid> = Vec::new();
                                for id in channel_ids {
                                    if subs.remove(&id) {
                                        removed.push(id);
                                    }
                                }
                                drop(subs);
                                if !removed.is_empty() {
                                    let mut by_channel = recv_sub_channel_servers.write().await;
                                    let mut counts = recv_sub_server_counts.write().await;
                                    for cid in removed {
                                        if let Some(sid) = by_channel.remove(&cid) {
                                            if let Some(current) = counts.get_mut(&sid) {
                                                if *current > 1 {
                                                    *current -= 1;
                                                } else {
                                                    counts.remove(&sid);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            WsClientMessage::Typing {
                                channel_id,
                                is_typing,
                            } => {
                                if let Ok(true) =
                                    can_subscribe_to_channel(&recv_state.db, user_id, channel_id)
                                        .await
                                {
                                    super::publish_event(
                                        &recv_state,
                                        WsEvent::Typing {
                                            channel_id,
                                            user_id,
                                            username: username.clone(),
                                            is_typing,
                                        },
                                    )
                                    .await;
                                }
                            }
                            WsClientMessage::JoinVoice {
                                channel_id,
                                participant_sid,
                            } => {
                                match can_join_voice_channel(&recv_state.db, user_id, channel_id)
                                    .await
                                {
                                    Ok(false) => {
                                        tracing::debug!(
                                            "JoinVoice denied for channel {} (user {})",
                                            channel_id,
                                            user_id
                                        );
                                    }
                                    Err(e) => {
                                        tracing::warn!("JoinVoice access check failed: {}", e);
                                    }
                                    Ok(true) => {
                                        // 1. Update voice session
                                        clear_screen_share_viewer_entries_for_user(
                                            &recv_state,
                                            user_id,
                                        );
                                        let previous_channel_id =
                                            recv_state.voice_sessions.insert(user_id, channel_id);
                                        if let Some(participant_sid) =
                                            participant_sid.filter(|sid| {
                                                !sid.is_empty()
                                                    && sid.len() <= 128
                                                    && sid.bytes().all(|byte| {
                                                        byte.is_ascii_alphanumeric()
                                                            || matches!(byte, b'_' | b'-')
                                                    })
                                            })
                                        {
                                            recv_state
                                                .voice_participant_sids
                                                .insert(user_id, participant_sid);
                                        } else {
                                            recv_state.voice_participant_sids.remove(&user_id);
                                        }
                                        if let Some(previous_channel_id) = previous_channel_id {
                                            if previous_channel_id != channel_id {
                                                cleanup_voice_channel_active_since_if_empty(
                                                    &recv_state,
                                                    previous_channel_id,
                                                );
                                            }
                                        }
                                        let _ = recv_state.voice_controls.insert(
                                            user_id,
                                            (false, false, false, false, false, false),
                                        );
                                        let channel_active_since_ms =
                                            ensure_voice_channel_active_since_ms(
                                                &recv_state,
                                                channel_id,
                                            );

                                        // 2. Broadcast join to everyone
                                        let server_id =
                                            server_id_for_channel(&recv_state.db, channel_id).await;
                                        super::publish_event(
                                            &recv_state,
                                            WsEvent::VoiceStateUpdate {
                                                channel_id: Some(channel_id),
                                                user_id,
                                                server_id,
                                                channel_active_since_ms: Some(
                                                    channel_active_since_ms,
                                                ),
                                            },
                                        )
                                        .await;
                                        super::publish_event(
                                            &recv_state,
                                            voice_control_event_from_state(
                                                user_id,
                                                server_id,
                                                (false, false, false, false, false, false),
                                            ),
                                        )
                                        .await;

                                        // 3. Send existing users in this channel to the joining user
                                        for entry in recv_state.voice_sessions.iter() {
                                            let (other_uid, other_cid) = entry.pair();
                                            if *other_cid == channel_id && *other_uid != user_id {
                                                let _ = client_tx.send(WsEvent::VoiceStateUpdate {
                                                    channel_id: Some(channel_id),
                                                    user_id: *other_uid,
                                                    server_id,
                                                    channel_active_since_ms: Some(
                                                        channel_active_since_ms,
                                                    ),
                                                });
                                                let control_state = recv_state
                                                    .voice_controls
                                                    .get(other_uid)
                                                    .map(|s| *s)
                                                    .unwrap_or((
                                                        false, false, false, false, false, false,
                                                    ));
                                                let _ =
                                                    client_tx.send(voice_control_event_from_state(
                                                        *other_uid,
                                                        server_id,
                                                        control_state,
                                                    ));
                                            }
                                        }
                                    }
                                }
                            }
                            WsClientMessage::LeaveVoice => {
                                if let Some((_, previous_channel_id)) =
                                    recv_state.voice_sessions.remove(&user_id)
                                {
                                    clear_screen_share_viewer_entries_for_user(
                                        &recv_state,
                                        user_id,
                                    );
                                    recv_state.voice_participant_sids.remove(&user_id);
                                    let previous_server_id =
                                        server_id_for_channel(&recv_state.db, previous_channel_id)
                                            .await;
                                    let _ = recv_state.voice_controls.remove(&user_id);
                                    cleanup_voice_channel_active_since_if_empty(
                                        &recv_state,
                                        previous_channel_id,
                                    );
                                    super::publish_event(
                                        &recv_state,
                                        WsEvent::VoiceStateUpdate {
                                            channel_id: None,
                                            user_id,
                                            server_id: previous_server_id,
                                            channel_active_since_ms: None,
                                        },
                                    )
                                    .await;
                                    super::publish_event(
                                        &recv_state,
                                        voice_control_event_from_state(
                                            user_id,
                                            previous_server_id,
                                            (false, false, false, false, false, false),
                                        ),
                                    )
                                    .await;
                                }
                            }
                            WsClientMessage::DisconnectVoiceMember { target_user_id } => {
                                let target_channel =
                                    recv_state.voice_sessions.get(&target_user_id).map(|r| *r);
                                let Some(target_channel_id) = target_channel else {
                                    continue;
                                };
                                let target_server_id =
                                    server_id_for_channel(&recv_state.db, target_channel_id).await;
                                let Some(target_server_id) = target_server_id else {
                                    continue;
                                };

                                let perms = match get_user_server_permissions(
                                    &recv_state.db,
                                    target_server_id,
                                    user_id,
                                )
                                .await
                                {
                                    Ok(p) => p,
                                    Err(e) => {
                                        tracing::warn!(
                                            "DisconnectVoiceMember permission lookup failed: {}",
                                            e
                                        );
                                        continue;
                                    }
                                };

                                let can_disconnect = perms.contains(Permissions::MUTE_MEMBERS)
                                    || perms.contains(Permissions::DEAFEN_MEMBERS)
                                    || perms.contains(Permissions::MANAGE_SERVER);
                                if !can_disconnect {
                                    continue;
                                }

                                if let Err(e) = voice_revoke::revoke_active_voice_session(
                                    &recv_state,
                                    target_user_id,
                                    "voice moderator disconnect",
                                )
                                .await
                                {
                                    tracing::warn!(
                                        "DisconnectVoiceMember voice revoke failed: {}",
                                        e
                                    );
                                }
                            }
                            WsClientMessage::SetVoiceControl {
                                target_user_id,
                                muted,
                                deafened,
                                screen_sharing,
                                camera_on,
                            } => {
                                let target_id = target_user_id.unwrap_or(user_id);

                                if target_id != user_id {
                                    let target_channel =
                                        recv_state.voice_sessions.get(&target_id).map(|r| *r);
                                    let Some(target_channel_id) = target_channel else {
                                        continue;
                                    };
                                    let target_server_id =
                                        server_id_for_channel(&recv_state.db, target_channel_id)
                                            .await;
                                    let Some(target_server_id) = target_server_id else {
                                        continue;
                                    };

                                    let perms = match get_user_server_permissions(
                                        &recv_state.db,
                                        target_server_id,
                                        user_id,
                                    )
                                    .await
                                    {
                                        Ok(p) => p,
                                        Err(e) => {
                                            tracing::warn!(
                                                "SetVoiceControl permission lookup failed: {}",
                                                e
                                            );
                                            continue;
                                        }
                                    };

                                    let current = recv_state
                                        .voice_controls
                                        .get(&target_id)
                                        .map(|s| *s)
                                        .unwrap_or((false, false, false, false, false, false));
                                    let can_mute = perms.contains(Permissions::MUTE_MEMBERS)
                                        || perms.contains(Permissions::MANAGE_SERVER);
                                    let can_deafen = perms.contains(Permissions::DEAFEN_MEMBERS)
                                        || perms.contains(Permissions::MANAGE_SERVER);
                                    if muted != current.2 && !can_mute {
                                        continue;
                                    }
                                    if deafened != current.3 && !can_deafen {
                                        continue;
                                    }

                                    // Moderators can only change server-enforced mute/deafen.
                                    let next_state = (
                                        current.0, current.1, muted, deafened, current.4, current.5,
                                    );
                                    let _ = recv_state.voice_controls.insert(target_id, next_state);
                                    super::publish_event(
                                        &recv_state,
                                        voice_control_event_from_state(
                                            target_id,
                                            Some(target_server_id),
                                            next_state,
                                        ),
                                    )
                                    .await;
                                    continue;
                                }

                                let actor_channel =
                                    recv_state.voice_sessions.get(&user_id).map(|r| *r);
                                let Some(actor_channel_id) = actor_channel else {
                                    continue;
                                };
                                let actor_server_id =
                                    server_id_for_channel(&recv_state.db, actor_channel_id).await;

                                let current = recv_state
                                    .voice_controls
                                    .get(&user_id)
                                    .map(|s| *s)
                                    .unwrap_or((false, false, false, false, false, false));
                                let next_state = (
                                    muted,
                                    deafened,
                                    current.2,
                                    current.3,
                                    screen_sharing,
                                    camera_on,
                                );
                                let _ = recv_state.voice_controls.insert(user_id, next_state);
                                if current.4 && !screen_sharing {
                                    clear_screen_share_viewers_for_publisher(
                                        &recv_state,
                                        user_id,
                                        actor_channel_id,
                                        actor_server_id,
                                    )
                                    .await;
                                }
                                super::publish_event(
                                    &recv_state,
                                    voice_control_event_from_state(
                                        user_id,
                                        actor_server_id,
                                        next_state,
                                    ),
                                )
                                .await;
                            }
                            WsClientMessage::SetScreenShareWatching {
                                publisher_user_id,
                                watching,
                            } => {
                                if publisher_user_id == user_id {
                                    continue;
                                }
                                let viewer_channel =
                                    recv_state.voice_sessions.get(&user_id).map(|entry| *entry);
                                let publisher_channel = recv_state
                                    .voice_sessions
                                    .get(&publisher_user_id)
                                    .map(|entry| *entry);
                                let Some(channel_id) = viewer_channel else {
                                    recv_state
                                        .screen_share_viewers
                                        .remove(&(user_id, publisher_user_id));
                                    continue;
                                };
                                if publisher_channel != Some(channel_id) {
                                    recv_state
                                        .screen_share_viewers
                                        .remove(&(user_id, publisher_user_id));
                                    continue;
                                }

                                let is_publisher_sharing = recv_state
                                    .voice_controls
                                    .get(&publisher_user_id)
                                    .map(|control| control.4)
                                    .unwrap_or(false);
                                if watching && !is_publisher_sharing {
                                    continue;
                                }

                                let changed = if watching {
                                    recv_state
                                        .screen_share_viewers
                                        .insert((user_id, publisher_user_id), ())
                                        .is_none()
                                } else {
                                    recv_state
                                        .screen_share_viewers
                                        .remove(&(user_id, publisher_user_id))
                                        .is_some()
                                };
                                if !changed {
                                    continue;
                                }

                                let server_id =
                                    server_id_for_channel(&recv_state.db, channel_id).await;
                                super::publish_event(
                                    &recv_state,
                                    screen_share_viewer_event(
                                        user_id,
                                        publisher_user_id,
                                        channel_id,
                                        server_id,
                                        watching,
                                    ),
                                )
                                .await;
                            }
                            WsClientMessage::Signal {
                                target_user_id,
                                signal,
                            } => {
                                // Only allow Signal to users in the same voice channel (prevents signaling spam).
                                let sender_channel =
                                    recv_state.voice_sessions.get(&user_id).map(|r| *r);
                                let target_channel =
                                    recv_state.voice_sessions.get(&target_user_id).map(|r| *r);
                                if let (Some(sc), Some(tc)) = (sender_channel, target_channel) {
                                    if sc == tc {
                                        if let Some(sessions) =
                                            recv_state.sessions.get(&target_user_id)
                                        {
                                            for s in sessions.iter() {
                                                let _ = s.send(WsEvent::Signal {
                                                    sender_id: user_id,
                                                    signal: signal.clone(),
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                            WsClientMessage::Ping { sent_at_ms } => {
                                let _ = client_tx.send(WsEvent::Pong { sent_at_ms });
                            }
                        }
                    }
                }
                Message::Binary(bin) => {
                    if let Err(e) = enforce_ws_frame_rate_limit(&recv_state, user_id).await {
                        tracing::warn!(
                            "Closing WS for rate limit breach (user {}): {}",
                            user_id,
                            e
                        );
                        break;
                    }
                    tracing::warn!(
                        "Closing WS for unexpected binary frame from {} ({} bytes)",
                        user_id,
                        bin.len()
                    );
                    break;
                }
                Message::Ping(_) | Message::Pong(_) => {
                    if let Err(e) = enforce_ws_frame_rate_limit(&recv_state, user_id).await {
                        tracing::warn!(
                            "Closing WS for rate limit breach (user {}): {}",
                            user_id,
                            e
                        );
                        break;
                    }
                }
                Message::Close(_) => break,
            }
        }
    });

    // Wait for either task to finish (e.g. client closed tab or connection dropped).
    // Abort the other so rx is dropped and session channel closes; otherwise retain(!is_closed()) never removes this session.
    let mut send_task = send_task;
    let mut recv_task = recv_task;
    tokio::select! {
        _ = &mut send_task => {
            recv_task.abort();
            let _ = recv_task.await;
        }
        _ = &mut recv_task => {
            send_task.abort();
            let _ = send_task.await;
        }
    }

    // Cleanup: remove session; only remove voice when this was the last connection (avoids kicking when same user has two tabs)
    // Use remove_if to avoid TOCTOU race: between dropping the mutable ref and calling remove(),
    // a new WS connection could add itself and would be wiped out by the unconditional remove.
    let last_session_gone = {
        // First pass: clean up closed senders
        if let Some(mut sessions) = state.sessions.get_mut(&user_id) {
            sessions.retain(|s| !s.is_closed());
        }
        // Atomically remove the entry only if it's still empty
        state
            .sessions
            .remove_if(&user_id, |_, senders| senders.is_empty())
            .is_some()
    };

    if last_session_gone {
        // Runtime presence becomes offline when the last active websocket session is gone.
        // Do not mutate users.status here; that column stores user preference.
        super::publish_event(
            &state,
            WsEvent::PresenceUpdate {
                user_id,
                status: "offline".to_string(),
            },
        )
        .await;
    }

    if last_session_gone {
        let removed_voice = state.voice_sessions.remove(&user_id);
        if let Some((_, previous_channel_id)) = removed_voice {
            clear_screen_share_viewer_entries_for_user(&state, user_id);
            state.voice_participant_sids.remove(&user_id);
            let previous_server_id = server_id_for_channel(&state.db, previous_channel_id).await;
            let _ = state.voice_controls.remove(&user_id);
            cleanup_voice_channel_active_since_if_empty(&state, previous_channel_id);
            super::publish_event(
                &state,
                WsEvent::VoiceStateUpdate {
                    channel_id: None,
                    user_id,
                    server_id: previous_server_id,
                    channel_active_since_ms: None,
                },
            )
            .await;
            super::publish_event(
                &state,
                voice_control_event_from_state(
                    user_id,
                    previous_server_id,
                    (false, false, false, false, false, false),
                ),
            )
            .await;
        }
    }

    tracing::info!("WebSocket disconnected: {}", user_id);
}

#[cfg(test)]
mod tests {
    use super::is_allowed_origin_value;

    #[test]
    fn allows_matching_origin() {
        let allowed = vec!["https://voxpery.com".to_string()];
        assert!(is_allowed_origin_value(
            Some("https://voxpery.com"),
            &allowed
        ));
    }

    #[test]
    fn rejects_missing_origin() {
        let allowed = vec!["https://voxpery.com".to_string()];
        assert!(!is_allowed_origin_value(None, &allowed));
    }

    #[test]
    fn rejects_non_matching_origin() {
        let allowed = vec!["https://voxpery.com".to_string()];
        assert!(!is_allowed_origin_value(
            Some("https://evil.example"),
            &allowed
        ));
    }
}
