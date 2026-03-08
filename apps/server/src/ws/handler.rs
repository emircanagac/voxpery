use axum::{
    extract::{
        ws::{Message, WebSocket},
        Request, State, WebSocketUpgrade,
    },
    http::header,
    response::Response,
};
use futures::{SinkExt, StreamExt};
use std::{collections::HashSet, sync::Arc};
use tokio::sync::mpsc;
use uuid::Uuid;

use super::{WsClientMessage, WsEvent};
use crate::middleware::auth::token_from_request;
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

fn is_allowed_ws_origin(req: &Request, state: &AppState) -> bool {
    let origin = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok());
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
/// or legacy query `?token=`. Web uses cookie auth.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<WsConnectParams>,
    req: Request,
) -> Response {
    let query_token = params.token.trim();
    let protocol_token = token_from_ws_protocol(req.headers());
    let using_cookie_auth = query_token.is_empty() && protocol_token.is_none();

    if using_cookie_auth && !is_allowed_ws_origin(&req, &state) {
        return Response::builder()
            .status(403)
            .body("Forbidden origin".into())
            .unwrap();
    }

    let token: Option<String> = {
        if !query_token.is_empty() {
            Some(query_token.to_string())
        } else if let Some(t) = protocol_token.clone() {
            Some(t)
        } else {
            token_from_request(req.headers(), &state.cookie_name)
        }
    };

    let token = match token {
        Some(t) => t,
        None => {
            return Response::builder()
                .status(401)
                .body("Unauthorized".into())
                .unwrap();
        }
    };

    let claims = match validate_ws_token(&token, &state).await {
        Some(claims) => claims,
        None => {
            return Response::builder()
                .status(401)
                .body("Unauthorized".into())
                .unwrap();
        }
    };

    if let Err(e) = crate::services::rate_limit::enforce_rate_limit(
        &state.rate_limits,
        format!("ws:{}", claims.sub),
        3,
        std::time::Duration::from_secs(10),
        "Too many connection attempts. Please slow down.",
    ) {
        return Response::builder()
            .status(429)
            .body(e.to_string().into())
            .unwrap();
    }

    let ws = if protocol_token.is_some() {
        ws.protocols(["voxpery.auth"])
    } else {
        ws
    };

    ws.on_upgrade(move |socket| handle_socket(socket, state, claims.sub, claims.username))
}

#[derive(Debug, serde::Deserialize)]
pub struct WsConnectParams {
    #[serde(default)]
    pub token: String,
}

async fn validate_ws_token(token: &str, state: &AppState) -> Option<crate::middleware::auth::Claims> {
    match crate::services::jwt_blacklist::is_blacklisted(&state.redis, token).await {
        Ok(true) => return None,
        Ok(false) => {}
        Err(e) => {
            tracing::warn!("Redis JWT blacklist check failed during WS auth: {}", e);
            return None;
        }
    }

    use jsonwebtoken::{decode, DecodingKey, Validation};
    decode::<crate::middleware::auth::Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|data| data.claims)
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, user_id: Uuid, username: String) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Create a channel for sending events to this client
    let (tx, mut rx) = mpsc::unbounded_channel::<WsEvent>();

    // Register this session
    state
        .sessions
        .entry(user_id)
        .or_default()
        .push(tx.clone());

    // Subscribe to broadcast channel
    let mut broadcast_rx = state.tx.subscribe();

    // Track which channels this user is subscribed to
    let subscribed_channels: Arc<tokio::sync::RwLock<HashSet<Uuid>>> =
        Arc::new(tokio::sync::RwLock::new(HashSet::new()));

    let sub_channels = subscribed_channels.clone();

    // Do not overwrite persisted status on connect (online/dnd/offline).
    let current_status = match sqlx::query_scalar::<_, String>("SELECT status FROM users WHERE id = $1")
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
        status: current_status,
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
                        WsEvent::PresenceUpdate { .. } |
                        WsEvent::UserUpdated { .. } |
                        WsEvent::FriendUpdate { .. } |
                        WsEvent::MemberJoined { .. } |
                        WsEvent::MemberLeft { .. } |
                        WsEvent::MemberRoleUpdated { .. } |
                        WsEvent::VoiceStateUpdate { .. } |
                        WsEvent::VoiceControlUpdate { .. } => true,
                        WsEvent::Pong { .. } => false,
                        WsEvent::Signal { .. } => false,
                    };

                    if should_send {
                        let json = serde_json::to_string(&event).unwrap();
                        if ws_sender.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                }
                // Events from direct channel (targeted to this user)
                Some(event) = rx.recv() => {
                    let json = serde_json::to_string(&event).unwrap();
                    if ws_sender.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                else => break,
            }
        }
    });

    // Task: receive messages from client
    let recv_state = state.clone();
    let recv_sub = subscribed_channels.clone();
    let client_tx = tx.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if text.len() > MAX_WS_MESSAGE_BYTES {
                        tracing::warn!("WebSocket message too large ({} bytes), ignoring", text.len());
                        continue;
                    }
                    if let Ok(client_msg) = serde_json::from_str::<WsClientMessage>(&text) {
                        match client_msg {
                            WsClientMessage::Subscribe { channel_ids } => {
                                let mut allowed: Vec<Uuid> = Vec::new();
                                for id in channel_ids {
                                    match can_subscribe_to_channel(&recv_state.db, user_id, id).await
                                    {
                                        Ok(true) => allowed.push(id),
                                        Ok(false) => {
                                            tracing::debug!("Subscribe denied for channel {} (user {})", id, user_id);
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
                                    let server_id = server_id_for_channel(&recv_state.db, cid).await;
                                    for entry in recv_state.voice_sessions.iter() {
                                        let (other_uid, other_cid) = entry.pair();
                                        if *other_cid == cid {
                                            let _ = client_tx.send(WsEvent::VoiceStateUpdate {
                                                channel_id: Some(cid),
                                                user_id: *other_uid,
                                                server_id,
                                            });
                                            let (muted, deafened, screen_sharing, camera_on) = recv_state
                                                .voice_controls
                                                .get(other_uid)
                                                .map(|s| *s)
                                                .unwrap_or((false, false, false, false));
                                            let _ = client_tx.send(WsEvent::VoiceControlUpdate {
                                                user_id: *other_uid,
                                                muted,
                                                deafened,
                                                screen_sharing,
                                                camera_on,
                                            });
                                        }
                                    }
                                }
                            }
                            WsClientMessage::Unsubscribe { channel_ids } => {
                                let mut subs = recv_sub.write().await;
                                for id in channel_ids {
                                    subs.remove(&id);
                                }
                            }
                            WsClientMessage::Typing {
                                channel_id,
                                is_typing,
                            } => {
                                if let Ok(true) =
                                    can_subscribe_to_channel(&recv_state.db, user_id, channel_id).await
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
                                match can_join_voice_channel(&recv_state.db, user_id, channel_id).await
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
                                        let _ = recv_state.voice_sessions.insert(user_id, channel_id);
                                        let _ = recv_state
                                            .voice_controls
                                            .insert(user_id, (false, false, false, false));

                                        // 2. Broadcast join to everyone
                                        let server_id = server_id_for_channel(&recv_state.db, channel_id).await;
                                        let _ = recv_state.tx.send(WsEvent::VoiceStateUpdate {
                                            channel_id: Some(channel_id),
                                            user_id,
                                            server_id,
                                        });
                                        let _ = recv_state.tx.send(WsEvent::VoiceControlUpdate {
                                            user_id,
                                            muted: false,
                                            deafened: false,
                                            screen_sharing: false,
                                            camera_on: false,
                                        });

                                        // 3. Send existing users in this channel to the joining user
                                        for entry in recv_state.voice_sessions.iter() {
                                            let (other_uid, other_cid) = entry.pair();
                                            if *other_cid == channel_id && *other_uid != user_id {
                                                let _ = client_tx.send(WsEvent::VoiceStateUpdate {
                                                    channel_id: Some(channel_id),
                                                    user_id: *other_uid,
                                                    server_id,
                                                });
                                                let (muted, deafened, screen_sharing, camera_on) = recv_state
                                                    .voice_controls
                                                    .get(other_uid)
                                                    .map(|s| *s)
                                                    .unwrap_or((false, false, false, false));
                                                let _ = client_tx.send(WsEvent::VoiceControlUpdate {
                                                    user_id: *other_uid,
                                                    muted,
                                                    deafened,
                                                    screen_sharing,
                                                    camera_on,
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                            WsClientMessage::LeaveVoice => {
                                if recv_state.voice_sessions.remove(&user_id).is_some() {
                                    let _ = recv_state.voice_controls.remove(&user_id);
                                    let _ = recv_state.tx.send(WsEvent::VoiceStateUpdate {
                                        channel_id: None,
                                        user_id,
                                        server_id: None,
                                    });
                                    let _ = recv_state.tx.send(WsEvent::VoiceControlUpdate {
                                        user_id,
                                        muted: false,
                                        deafened: false,
                                        screen_sharing: false,
                                        camera_on: false,
                                    });
                                }
                            }
                            WsClientMessage::SetVoiceControl {
                                muted,
                                deafened,
                                screen_sharing,
                                camera_on,
                            } => {
                                if recv_state.voice_sessions.contains_key(&user_id) {
                                    let _ = recv_state
                                        .voice_controls
                                        .insert(user_id, (muted, deafened, screen_sharing, camera_on));
                                    let _ = recv_state.tx.send(WsEvent::VoiceControlUpdate {
                                        user_id,
                                        muted,
                                        deafened,
                                        screen_sharing,
                                        camera_on,
                                    });
                                }
                            }
                            WsClientMessage::Signal {
                                target_user_id,
                                signal,
                            } => {
                                // Only allow Signal to users in the same voice channel (prevents signaling spam).
                                let sender_channel = recv_state.voice_sessions.get(&user_id).map(|r| *r);
                                let target_channel = recv_state.voice_sessions.get(&target_user_id).map(|r| *r);
                                if let (Some(sc), Some(tc)) = (sender_channel, target_channel) {
                                    if sc == tc {
                                        if let Some(sessions) = recv_state.sessions.get(&target_user_id) {
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
        state.sessions.remove_if(&user_id, |_, senders| senders.is_empty()).is_some()
    };

    if last_session_gone {
        // Update presence to offline (DB + broadcast)
        if let Err(e) = sqlx::query("UPDATE users SET status = 'offline' WHERE id = $1")
            .bind(user_id)
            .execute(&state.db)
            .await
        {
            tracing::warn!("Failed to set user offline in DB: {}", e);
        }
        let _ = state.tx.send(WsEvent::PresenceUpdate {
            user_id,
            status: "offline".to_string(),
        });
    }

    if last_session_gone && state.voice_sessions.remove(&user_id).is_some() {
        let _ = state.voice_controls.remove(&user_id);
        let _ = state.tx.send(WsEvent::VoiceStateUpdate {
            channel_id: None,
            user_id,
            server_id: None,
        });
        let _ = state.tx.send(WsEvent::VoiceControlUpdate {
            user_id,
            muted: false,
            deafened: false,
            screen_sharing: false,
            camera_on: false,
        });
    }

    tracing::info!("WebSocket disconnected: {}", user_id);
}

#[cfg(test)]
mod tests {
    use super::is_allowed_origin_value;

    #[test]
    fn allows_matching_origin() {
        let allowed = vec!["https://voxpery.com".to_string()];
        assert!(is_allowed_origin_value(Some("https://voxpery.com"), &allowed));
    }

    #[test]
    fn rejects_missing_origin() {
        let allowed = vec!["https://voxpery.com".to_string()];
        assert!(!is_allowed_origin_value(None, &allowed));
    }

    #[test]
    fn rejects_non_matching_origin() {
        let allowed = vec!["https://voxpery.com".to_string()];
        assert!(!is_allowed_origin_value(Some("https://evil.example"), &allowed));
    }
}
