use axum::{
    extract::{
        ws::{Message, WebSocket},
        Request, State, WebSocketUpgrade,
    },
    http::header,
    response::{IntoResponse, Response},
};
use futures::{SinkExt, StreamExt};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use tokio::sync::mpsc;
use uuid::Uuid;

use super::{WsClientMessage, WsEvent};
use crate::middleware::auth::claims_match_current_token_version;
use crate::middleware::auth::token_from_request;
use crate::services::permissions::{get_user_channel_permissions, Permissions};
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

/// Max incoming WebSocket text message size (256 KB) to mitigate DoS via huge Signal payloads.
const MAX_WS_MESSAGE_BYTES: usize = 256 * 1024;

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

fn visible_presence_from_preference(status: &str) -> &'static str {
    match status.to_ascii_lowercase().as_str() {
        "dnd" => "dnd",
        "invisible" | "offline" => "offline",
        _ => "online",
    }
}

async fn users_share_server(db: &sqlx::PgPool, a_user_id: Uuid, b_user_id: Uuid) -> bool {
    if a_user_id == b_user_id {
        return true;
    }
    sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
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

    ws.on_upgrade(move |socket| handle_socket(socket, state, claims.sub, claims.username))
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

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, user_id: Uuid, username: String) {
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
    let _ = state.tx.send(WsEvent::PresenceUpdate {
        user_id,
        status: visible_presence_from_preference(&current_status).to_string(),
    });

    tracing::info!("WebSocket connected: {} ({})", username, user_id);

    // Task: forward broadcast events to this client (if subscribed) + server-side keepalive
    let send_task = tokio::spawn(async move {
        // Server-side WebSocket keepalive: detect stale connections (laptop sleep, network
        // drop without FIN) that would otherwise linger for minutes until OS TCP timeout.
        let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(30));
        ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // Skip the immediate first tick
        ping_interval.tick().await;

        loop {
            tokio::select! {
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
                        WsEvent::NewMessage { channel_id, channel_type: _, .. } |
                        WsEvent::Typing { channel_id, .. } |
                        WsEvent::MessageDeleted { channel_id, .. } |
                        WsEvent::MessageUpdated { channel_id, .. } => {
                            sub_channels.read().await.contains(channel_id)
                        }
                        WsEvent::FriendUpdate { user_id: target_user_id } => {
                            *target_user_id == user_id
                        }
                        WsEvent::PresenceUpdate { user_id: changed_user_id, .. } => {
                            users_share_server(&send_state.db, user_id, *changed_user_id).await
                        }
                        WsEvent::UserUpdated { user } => {
                            users_share_server(&send_state.db, user_id, user.id).await
                        }
                        WsEvent::MemberJoined { server_id, .. }
                        | WsEvent::MemberLeft { server_id, .. }
                        | WsEvent::MemberRoleUpdated { server_id, .. }
                        | WsEvent::ServerRolesUpdated { server_id }
                        | WsEvent::ServerChannelsUpdated { server_id } => {
                            user_in_server(&send_state.db, user_id, *server_id).await
                        }
                        WsEvent::VoiceStateUpdate { server_id, .. }
                        | WsEvent::VoiceControlUpdate { server_id, .. } => {
                            match server_id {
                                Some(sid) => {
                                    sub_server_counts
                                        .read()
                                        .await
                                        .get(sid)
                                        .copied()
                                        .unwrap_or(0)
                                        > 0
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
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
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
                                            let _ = client_tx.send(WsEvent::VoiceStateUpdate {
                                                channel_id: Some(cid),
                                                user_id: *other_uid,
                                                server_id,
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
                                    let _ = recv_state.tx.send(WsEvent::Typing {
                                        channel_id,
                                        user_id,
                                        username: username.clone(),
                                        is_typing,
                                    });
                                }
                            }
                            WsClientMessage::JoinVoice { channel_id } => {
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
                                        let _ =
                                            recv_state.voice_sessions.insert(user_id, channel_id);
                                        let _ = recv_state.voice_controls.insert(
                                            user_id,
                                            (false, false, false, false, false, false),
                                        );

                                        // 2. Broadcast join to everyone
                                        let server_id =
                                            server_id_for_channel(&recv_state.db, channel_id).await;
                                        let _ = recv_state.tx.send(WsEvent::VoiceStateUpdate {
                                            channel_id: Some(channel_id),
                                            user_id,
                                            server_id,
                                        });
                                        let _ = recv_state.tx.send(voice_control_event_from_state(
                                            user_id,
                                            server_id,
                                            (false, false, false, false, false, false),
                                        ));

                                        // 3. Send existing users in this channel to the joining user
                                        for entry in recv_state.voice_sessions.iter() {
                                            let (other_uid, other_cid) = entry.pair();
                                            if *other_cid == channel_id && *other_uid != user_id {
                                                let _ = client_tx.send(WsEvent::VoiceStateUpdate {
                                                    channel_id: Some(channel_id),
                                                    user_id: *other_uid,
                                                    server_id,
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
                                    let previous_server_id =
                                        server_id_for_channel(&recv_state.db, previous_channel_id)
                                            .await;
                                    let _ = recv_state.voice_controls.remove(&user_id);
                                    let _ = recv_state.tx.send(WsEvent::VoiceStateUpdate {
                                        channel_id: None,
                                        user_id,
                                        server_id: previous_server_id,
                                    });
                                    let _ = recv_state.tx.send(voice_control_event_from_state(
                                        user_id,
                                        previous_server_id,
                                        (false, false, false, false, false, false),
                                    ));
                                }
                            }
                            WsClientMessage::SetVoiceControl {
                                target_user_id,
                                muted,
                                deafened,
                                screen_sharing,
                                camera_on,
                            } => {
                                let actor_channel =
                                    recv_state.voice_sessions.get(&user_id).map(|r| *r);
                                let Some(actor_channel_id) = actor_channel else {
                                    continue;
                                };
                                let actor_server_id =
                                    server_id_for_channel(&recv_state.db, actor_channel_id).await;

                                let target_id = target_user_id.unwrap_or(user_id);

                                if target_id != user_id {
                                    let target_channel =
                                        recv_state.voice_sessions.get(&target_id).map(|r| *r);
                                    let Some(target_channel_id) = target_channel else {
                                        continue;
                                    };
                                    if target_channel_id != actor_channel_id {
                                        continue;
                                    }

                                    let perms = match get_user_channel_permissions(
                                        &recv_state.db,
                                        actor_channel_id,
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
                                    if muted != current.2
                                        && !perms.contains(Permissions::MUTE_MEMBERS)
                                    {
                                        continue;
                                    }
                                    if deafened != current.3
                                        && !perms.contains(Permissions::DEAFEN_MEMBERS)
                                    {
                                        continue;
                                    }

                                    // Moderators can only change server-enforced mute/deafen.
                                    let next_state = (
                                        current.0, current.1, muted, deafened, current.4, current.5,
                                    );
                                    let _ = recv_state.voice_controls.insert(target_id, next_state);
                                    let _ = recv_state.tx.send(voice_control_event_from_state(
                                        target_id,
                                        actor_server_id,
                                        next_state,
                                    ));
                                    continue;
                                }

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
                                let _ = recv_state.tx.send(voice_control_event_from_state(
                                    user_id,
                                    actor_server_id,
                                    next_state,
                                ));
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
                Message::Close(_) => break,
                _ => {}
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
        let _ = state.tx.send(WsEvent::PresenceUpdate {
            user_id,
            status: "offline".to_string(),
        });
    }

    if last_session_gone {
        let removed_voice = state.voice_sessions.remove(&user_id);
        if let Some((_, previous_channel_id)) = removed_voice {
            let previous_server_id = server_id_for_channel(&state.db, previous_channel_id).await;
            let _ = state.voice_controls.remove(&user_id);
            let _ = state.tx.send(WsEvent::VoiceStateUpdate {
                channel_id: None,
                user_id,
                server_id: previous_server_id,
            });
            let _ = state.tx.send(voice_control_event_from_state(
                user_id,
                previous_server_id,
                (false, false, false, false, false, false),
            ));
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
