use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket},
        Request, State, WebSocketUpgrade,
    },
    http::header,
    response::{IntoResponse, Response},
};
use futures::{stream::SplitSink, SinkExt, StreamExt};
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};
use tokio::sync::mpsc;
use uuid::Uuid;

use super::cluster::ClusterUpdate;
use super::voice_commands::*;
use super::{BroadcastEvent, SessionQueue, WsClientMessage, WsEvent};
use crate::middleware::auth::token_from_request;
use crate::middleware::auth::Claims;
use crate::services::permissions::{get_user_channel_permissions, Permissions};
use crate::services::privacy::SessionAccount;
use crate::services::redact::ShortId;
use crate::services::voice_revoke;
use crate::ws::access::{
    can_subscribe_to_channel, subscribable_channel_candidates, ChannelAccessCache, TypingThrottle,
};
use crate::AppState;

async fn close_after_missed_events(sender: &mut SplitSink<WebSocket, Message>) {
    let _ = tokio::time::timeout(
        WS_SEND_TIMEOUT,
        sender.send(Message::Close(Some(CloseFrame {
            code: WS_MISSED_EVENTS_CLOSE_CODE,
            reason: "Missed events".into(),
        }))),
    )
    .await;
}

/// Max incoming WebSocket message and frame size (256 KB). Enforced while reading, so an
/// oversized message is never buffered; exceeding it ends the connection.
const MAX_WS_MESSAGE_BYTES: usize = 256 * 1024;
/// Events waiting for one connection. A client that keeps up never comes close; one that
/// stops reading cannot make the server buffer events without bound.
const WS_SESSION_QUEUE_CAPACITY: usize = 256;
/// Sent when a connection missed events (1013 "try again later"). The client reconnects, which
/// reloads its state, instead of showing stale data until the next page load.
const WS_MISSED_EVENTS_CLOSE_CODE: u16 = 1013;
/// A write that cannot complete in this time means the client stopped reading; the
/// connection is closed and the client reconnects and reloads its state.
const WS_SEND_TIMEOUT: Duration = Duration::from_secs(20);
/// Channel ids accepted from one Subscribe message and kept per connection. The web client
/// subscribes to every channel it knows in one message, so these sit far above real use.
const MAX_SUBSCRIBE_IDS_PER_MESSAGE: usize = 1_000;
const MAX_SUBSCRIBED_CHANNELS_PER_CONNECTION: usize = 5_000;
/// Open WebSocket connections per account (tabs, windows and devices together).
const MAX_WS_CONNECTIONS_PER_USER: usize = 10;
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

fn visible_presence_from_preference(status: &str) -> &'static str {
    match status.to_ascii_lowercase().as_str() {
        "dnd" => "dnd",
        "invisible" | "offline" => "offline",
        _ => "online",
    }
}

async fn can_receive_subscribed_channel_event(
    db: &sqlx::PgPool,
    user_id: Uuid,
    subscribed_channels: &tokio::sync::RwLock<HashSet<Uuid>>,
    access_cache: &mut ChannelAccessCache,
    channel_id: Uuid,
) -> bool {
    let is_subscribed = { subscribed_channels.read().await.contains(&channel_id) };
    if !is_subscribed {
        return false;
    }

    let now = std::time::Instant::now();
    if let Some(allowed) = access_cache.get(channel_id, now) {
        return allowed;
    }
    match can_subscribe_to_channel(db, user_id, channel_id).await {
        Ok(allowed) => {
            access_cache.insert(channel_id, allowed, now);
            allowed
        }
        Err(e) => {
            tracing::warn!(
                "WS event authorization re-check failed for user {} channel {}: {}",
                ShortId(user_id),
                channel_id,
                e
            );
            false
        }
    }
}

/// Whether `user_id` can currently view `channel_id` (membership and channel permissions).
/// A typing indicator reaches others like a message, so it needs what sending one needs.
async fn can_start_typing(state: &AppState, user_id: Uuid, channel_id: Uuid) -> bool {
    if !can_view_channel(&state.db, user_id, channel_id).await {
        return false;
    }
    let Some(server_id) = server_id_for_channel(&state.db, channel_id).await else {
        return crate::routes::dm::ensure_can_reach_dm_peer(state, channel_id, user_id)
            .await
            .is_ok();
    };
    let can_send = matches!(
        get_user_channel_permissions(&state.db, channel_id, user_id).await,
        Ok(perms) if perms.contains(Permissions::SEND_MESSAGES)
    );
    can_send
        && crate::services::moderation::ensure_not_timed_out(&state.db, server_id, user_id)
            .await
            .is_ok()
}

/// Voice events reveal who is in which channel, so each recipient only receives the parts
/// about channels they can view. Returns the event to send (possibly reduced to a leave
/// when the user moved from a visible channel into a hidden one), or `None`.
async fn voice_event_for_recipient<'a>(
    state: &AppState,
    recipient_id: Uuid,
    shared: &'a BroadcastEvent,
) -> Option<Cow<'a, WsEvent>> {
    let event = shared.event();
    match event {
        WsEvent::VoiceStateUpdate {
            channel_id,
            user_id,
            server_id,
            previous_channel_id,
            ..
        } => {
            if let Some(channel_id) = channel_id {
                if shared
                    .can_view_channel(&state.db, recipient_id, *channel_id)
                    .await
                {
                    return Some(Cow::Borrowed(event));
                }
                let previous = (*previous_channel_id)?;
                if !shared
                    .can_view_channel(&state.db, recipient_id, previous)
                    .await
                {
                    return None;
                }
                return Some(Cow::Owned(WsEvent::VoiceStateUpdate {
                    channel_id: None,
                    user_id: *user_id,
                    server_id: *server_id,
                    channel_active_since_ms: None,
                    previous_channel_id: Some(previous),
                }));
            }
            match previous_channel_id {
                Some(previous) => shared
                    .can_view_channel(&state.db, recipient_id, *previous)
                    .await
                    .then_some(Cow::Borrowed(event)),
                // Events from an older server instance carry no channel; keep server scope.
                None => Some(Cow::Borrowed(event)),
            }
        }
        WsEvent::ScreenShareViewerUpdate { channel_id, .. } => shared
            .can_view_channel(&state.db, recipient_id, *channel_id)
            .await
            .then_some(Cow::Borrowed(event)),
        WsEvent::VoiceControlUpdate {
            user_id,
            channel_id,
            ..
        } => {
            // The event names its channel: the session is already gone after a departure.
            let channel_id =
                channel_id.or_else(|| state.voice_sessions.get(user_id).map(|entry| *entry));
            match channel_id {
                Some(channel_id) => shared
                    .can_view_channel(&state.db, recipient_id, channel_id)
                    .await
                    .then_some(Cow::Borrowed(event)),
                // Events from an older server instance carry no channel; keep server scope.
                None => Some(Cow::Borrowed(event)),
            }
        }
        _ => Some(Cow::Borrowed(event)),
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

    let account =
        match crate::services::privacy::session_account(&state.db, claims.sub, claims.ver).await {
            Ok(Some(account)) => account,
            Ok(None) => {
                return (axum::http::StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
            }
            Err(error) => {
                tracing::warn!("WebSocket session check failed: {}", error);
                return (
                    axum::http::StatusCode::SERVICE_UNAVAILABLE,
                    "Session validation unavailable",
                )
                    .into_response();
            }
        };
    if !account.legal_consent_current {
        return (
            axum::http::StatusCode::PRECONDITION_REQUIRED,
            "Current legal documents must be acknowledged",
        )
            .into_response();
    }
    if state.email_verification_required && !account.email_verified {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "Verify your email address to continue",
        )
            .into_response();
    }

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

    let open_connections = state
        .sessions
        .get(&claims.sub)
        .map(|sessions| {
            sessions
                .iter()
                .filter(|session| !session.is_closed())
                .count()
        })
        .unwrap_or(0);
    if open_connections >= MAX_WS_CONNECTIONS_PER_USER {
        return (
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            "Too many open connections for this account.",
        )
            .into_response();
    }

    let ws = if protocol_token.is_some() {
        ws.protocols(["voxpery.auth"])
    } else {
        ws
    };

    ws.max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, state, claims, token, account))
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

    use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
    let claims = decode::<crate::middleware::auth::Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .ok()?
    .claims;

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
        crate::services::privacy::session_account(&state.db, claims.sub, claims.ver).await,
        Ok(Some(account)) if account.legal_consent_current
    )
}

async fn handle_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    claims: Claims,
    token: String,
    account: SessionAccount,
) {
    let user_id = claims.sub;
    let username = account.username;
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Create a channel for sending events to this client
    let (tx, mut rx) = mpsc::channel::<WsEvent>(WS_SESSION_QUEUE_CAPACITY);
    // Identifies this connection as the holder of a voice session.
    let connection_id = Uuid::new_v4();

    // Register this session
    let session = SessionQueue::new(tx.clone());
    state
        .sessions
        .entry(user_id)
        .or_default()
        .push(session.clone());
    if let Some(pending) = state.pending_voice_moves.get(&user_id) {
        let _ = tx.try_send(WsEvent::VoiceMemberMoveRequested {
            request_id: pending.request_id,
            source_channel_id: pending.source_channel_id,
            channel_id: pending.destination_channel_id,
            server_id: pending.server_id,
            actor_id: pending.actor_id,
        });
    }

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
    let current_status = account.status;
    super::publish_event(
        &state,
        WsEvent::PresenceUpdate {
            user_id,
            status: visible_presence_from_preference(&current_status).to_string(),
        },
    )
    .await;

    tracing::info!("WebSocket connected: {}", ShortId(user_id));

    // Task: forward broadcast events to this client (if subscribed) + server-side keepalive
    let send_task = tokio::spawn(async move {
        let mut access_cache = ChannelAccessCache::default();
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
                        let _ = tokio::time::timeout(
                            WS_SEND_TIMEOUT,
                            ws_sender.send(Message::Close(Some(CloseFrame {
                                code: 4001,
                                reason: "Authentication expired".into(),
                            }))),
                        )
                        .await;
                        break;
                    }
                }
                // Server-side WS ping (Ping frame; browser/axum auto-reply with Pong)
                _ = ping_interval.tick() => {
                    if !matches!(
                        tokio::time::timeout(WS_SEND_TIMEOUT, ws_sender.send(Message::Ping(vec![].into()))).await,
                        Ok(Ok(()))
                    ) {
                        break;
                    }
                }
                // Events from broadcast channel
                result = broadcast_rx.recv() => {
                    let shared = match result {
                        Ok(shared) => shared,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!("Broadcast receiver lagged by {} events (user {})", n, ShortId(user_id));
                            close_after_missed_events(&mut ws_sender).await;
                            break;
                        }
                        Err(_) => break,
                    };
                    let event = shared.event();
                    // Role, channel and membership changes can change what this user may see.
                    if matches!(
                        event,
                        WsEvent::MemberJoined { .. }
                            | WsEvent::MemberLeft { .. }
                            | WsEvent::MemberRoleUpdated { .. }
                            | WsEvent::ServerRolesUpdated { .. }
                            | WsEvent::ServerChannelsUpdated { .. }
                    ) {
                        access_cache.clear();
                    }
                    let is_own_voice_event = matches!(
                        event,
                        WsEvent::VoiceStateUpdate { user_id: affected_user_id, .. }
                            | WsEvent::VoiceControlUpdate { user_id: affected_user_id, .. }
                            if *affected_user_id == user_id
                    );
                    let should_send = match event {
                        WsEvent::NewMessage { channel_id, .. }
                        | WsEvent::Typing { channel_id, .. }
                        | WsEvent::MessageDeleted { channel_id, .. }
                        | WsEvent::MessageUpdated { channel_id, .. } => {
                            can_receive_subscribed_channel_event(
                                &send_state.db,
                                user_id,
                                &sub_channels,
                                &mut access_cache,
                                *channel_id,
                            )
                            .await
                        }
                        WsEvent::FriendUpdate { user_id: target_user_id } => {
                            *target_user_id == user_id
                        }
                        // Sent to each member directly, never broadcast.
                        WsEvent::DmChannelsUpdated { .. } => false,
                        WsEvent::DmRead {
                            user_id: target_user_id,
                            ..
                        } => *target_user_id == user_id,
                        WsEvent::PresenceUpdate { .. }
                        | WsEvent::UserUpdated { .. }
                        | WsEvent::MemberJoined { .. }
                        | WsEvent::MemberLeft { .. }
                        | WsEvent::MemberRoleUpdated { .. }
                        | WsEvent::MemberTimeoutUpdated { .. }
                        | WsEvent::ServerRolesUpdated { .. }
                        | WsEvent::ServerChannelsUpdated { .. }
                        | WsEvent::ServerUpdated { .. } => {
                            shared.reaches(&send_state.db, user_id).await
                        }
                        WsEvent::VoiceStateUpdate { server_id, .. }
                        | WsEvent::VoiceControlUpdate { server_id, .. }
                        | WsEvent::ScreenShareViewerUpdate { server_id, .. } => {
                            match server_id {
                                Some(sid) => {
                                    let subscribed_to_server = sub_server_counts
                                        .read()
                                        .await
                                        .get(sid)
                                        .copied()
                                        .unwrap_or(0)
                                        > 0;
                                    // Voice participants should continue receiving voice state/control
                                    // updates even when they're not actively subscribed to text channels
                                    // (e.g. while viewing Home/DM pages).
                                    let my_voice_channel =
                                        send_state.voice_sessions.get(&user_id).map(|r| *r);
                                    // Membership is re-checked so users that were removed from the
                                    // server stop receiving voice-related events immediately.
                                    if is_own_voice_event || subscribed_to_server {
                                        shared.reaches(&send_state.db, user_id).await
                                    } else if let Some(my_channel_id) = my_voice_channel {
                                        shared.reaches(&send_state.db, user_id).await
                                            && shared
                                                .is_channel_of_server(&send_state.db, my_channel_id)
                                                .await
                                    } else {
                                        false
                                    }
                                }
                                None => false,
                            }
                        }
                        WsEvent::VoiceMemberMoveRequested { .. }
                        | WsEvent::VoiceMemberMoveResult { .. }
                        | WsEvent::VoiceSessionMoved { .. } => false,
                        WsEvent::Pong { .. } => false,
                    };

                    let outgoing = if !should_send {
                        None
                    } else if is_own_voice_event {
                        Some(Cow::Borrowed(event))
                    } else {
                        voice_event_for_recipient(&send_state, user_id, &shared).await
                    };
                    let json = match outgoing {
                        None => None,
                        Some(Cow::Borrowed(_)) => shared.json(),
                        Some(Cow::Owned(event)) => serde_json::to_string(&event)
                            .map_err(|e| tracing::warn!("WS broadcast serialization failed: {}", e))
                            .ok()
                            .map(Into::into),
                    };
                    if let Some(json) = json {
                        if !matches!(
                            tokio::time::timeout(WS_SEND_TIMEOUT, ws_sender.send(Message::Text(json))).await,
                            Ok(Ok(()))
                        ) {
                            break;
                        }
                    }
                }
                // Events from direct channel (targeted to this user)
                Some(event) = rx.recv() => {
                    // Direct events include DM membership and server removal notices.
                    access_cache.clear();
                    match serde_json::to_string(&event) {
                        Ok(json) => {
                            if !matches!(
                                tokio::time::timeout(WS_SEND_TIMEOUT, ws_sender.send(Message::Text(json.into()))).await,
                                Ok(Ok(()))
                            ) {
                                break;
                            }
                        }
                        Err(e) => {
                            tracing::warn!("WS direct serialization failed: {}", e);
                        }
                    }
                    if session.has_overflowed() {
                        tracing::warn!("WebSocket queue overflowed (user {})", ShortId(user_id));
                        close_after_missed_events(&mut ws_sender).await;
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
    let recv_sub_channel_servers = subscribed_channel_servers.clone();
    let recv_sub_server_counts = subscribed_server_counts.clone();
    let client_tx = tx.clone();
    let recv_claims = claims.clone();
    let recv_token = token.clone();
    let recv_task = tokio::spawn(async move {
        let mut typing_throttle = TypingThrottle::default();
        let voice = VoiceConnection {
            state: recv_state.clone(),
            user_id,
            connection_id,
            client_tx: client_tx.clone(),
        };
        loop {
            let msg = match tokio::time::timeout(WS_CLIENT_IDLE_TIMEOUT, ws_receiver.next()).await {
                Ok(Some(Ok(msg))) => msg,
                Ok(Some(Err(e))) => {
                    tracing::warn!("WebSocket receive error for {}: {}", ShortId(user_id), e);
                    break;
                }
                Ok(None) => break,
                Err(_) => {
                    tracing::warn!(
                        "WebSocket idle timeout (zombie session) for user {}; closing connection",
                        ShortId(user_id)
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
                            ShortId(user_id),
                            e
                        );
                        break;
                    }
                    if let Ok(client_msg) = serde_json::from_str::<WsClientMessage>(&text) {
                        match client_msg {
                            WsClientMessage::Subscribe { channel_ids } => {
                                // Skip duplicates and channels this connection already has,
                                // cap the batch, then drop ids the user cannot possibly see
                                // with one query before the per-channel permission check.
                                let requested: Vec<Uuid> = {
                                    let subs = recv_sub.read().await;
                                    let mut seen = HashSet::new();
                                    channel_ids
                                        .into_iter()
                                        .filter(|id| !subs.contains(id) && seen.insert(*id))
                                        .take(MAX_SUBSCRIBE_IDS_PER_MESSAGE)
                                        .collect()
                                };
                                let candidates = match subscribable_channel_candidates(
                                    &recv_state.db,
                                    user_id,
                                    &requested,
                                )
                                .await
                                {
                                    Ok(candidates) => candidates,
                                    Err(e) => {
                                        tracing::warn!("Subscribe access check failed: {}", e);
                                        Vec::new()
                                    }
                                };
                                let mut allowed: Vec<Uuid> = Vec::new();
                                for id in candidates {
                                    match can_subscribe_to_channel(&recv_state.db, user_id, id)
                                        .await
                                    {
                                        Ok(true) => allowed.push(id),
                                        Ok(false) => {
                                            tracing::debug!(
                                                "Subscribe denied for channel {} (user {})",
                                                id,
                                                ShortId(user_id)
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
                                    if subs.len() >= MAX_SUBSCRIBED_CHANNELS_PER_CONNECTION {
                                        tracing::warn!(
                                            "Subscription limit reached for user {}",
                                            ShortId(user_id)
                                        );
                                        break;
                                    }
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
                                            let _ = client_tx.try_send(WsEvent::VoiceStateUpdate {
                                                channel_id: Some(cid),
                                                user_id: *other_uid,
                                                server_id,
                                                channel_active_since_ms: Some(
                                                    channel_active_since_ms,
                                                ),
                                                previous_channel_id: None,
                                            });
                                            let control_state = recv_state
                                                .voice_controls
                                                .get(other_uid)
                                                .map(|s| *s)
                                                .unwrap_or((
                                                    false, false, false, false, false, false,
                                                ));
                                            let _ =
                                                client_tx.try_send(voice_control_event_from_state(
                                                    *other_uid,
                                                    server_id,
                                                    *other_cid,
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
                                        let _ = client_tx.try_send(screen_share_viewer_event(
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
                                if !typing_throttle.allow(
                                    channel_id,
                                    is_typing,
                                    std::time::Instant::now(),
                                ) {
                                    continue;
                                }
                                let allowed = if is_typing {
                                    can_start_typing(&recv_state, user_id, channel_id).await
                                } else {
                                    can_view_channel(&recv_state.db, user_id, channel_id).await
                                };
                                if allowed {
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
                                join_voice(&voice, channel_id, participant_sid).await;
                            }
                            WsClientMessage::LeaveVoice => {
                                leave_voice(&voice).await;
                            }
                            WsClientMessage::DisconnectVoiceMember {
                                target_user_id,
                                reason,
                            } => {
                                disconnect_voice_member(&voice, target_user_id, reason).await;
                            }
                            WsClientMessage::MoveVoiceMember {
                                request_id,
                                target_user_id,
                                channel_id,
                                reason,
                            } => {
                                move_voice_member(
                                    &voice,
                                    request_id,
                                    target_user_id,
                                    channel_id,
                                    reason,
                                )
                                .await;
                            }
                            WsClientMessage::AcknowledgeVoiceMemberMove {
                                request_id,
                                success,
                                error,
                            } => {
                                complete_voice_member_move(
                                    &recv_state,
                                    user_id,
                                    request_id,
                                    success,
                                    error,
                                )
                                .await;
                            }
                            WsClientMessage::SetVoiceControl {
                                target_user_id,
                                muted,
                                deafened,
                                screen_sharing,
                                camera_on,
                                reason,
                            } => {
                                set_voice_control(
                                    &voice,
                                    target_user_id,
                                    muted,
                                    deafened,
                                    screen_sharing,
                                    camera_on,
                                    reason,
                                )
                                .await;
                            }
                            WsClientMessage::SetScreenShareWatching {
                                publisher_user_id,
                                watching,
                            } => {
                                set_screen_share_watching(&voice, publisher_user_id, watching)
                                    .await;
                            }
                            WsClientMessage::Ping { sent_at_ms } => {
                                let _ = client_tx.try_send(WsEvent::Pong { sent_at_ms });
                            }
                        }
                    }
                }
                Message::Binary(bin) => {
                    if let Err(e) = enforce_ws_frame_rate_limit(&recv_state, user_id).await {
                        tracing::warn!(
                            "Closing WS for rate limit breach (user {}): {}",
                            ShortId(user_id),
                            e
                        );
                        break;
                    }
                    tracing::warn!(
                        "Closing WS for unexpected binary frame from {} ({} bytes)",
                        ShortId(user_id),
                        bin.len()
                    );
                    break;
                }
                Message::Ping(_) | Message::Pong(_) => {
                    if let Err(e) = enforce_ws_frame_rate_limit(&recv_state, user_id).await {
                        tracing::warn!(
                            "Closing WS for rate limit breach (user {}): {}",
                            ShortId(user_id),
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

    if last_session_gone && state.peers.is_online(user_id) {
        super::publish_cluster_update(&state, ClusterUpdate::ConnectionsClosed { user_id }).await;
    } else if last_session_gone {
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

    // Voice ends with the connection that holds it, even while other tabs stay open; a client
    // whose socket only dropped rejoins on reconnect before its LiveKit participant is removed.
    let held_voice = state
        .voice_session_connections
        .remove_if(&user_id, |_, holder| holder.0 == connection_id)
        .is_some();
    let holder_missing = !state.voice_session_connections.contains_key(&user_id);
    if held_voice || (last_session_gone && holder_missing && !state.peers.holds_voice(user_id)) {
        let removed_voice = state.voice_sessions.remove(&user_id);
        if let Some((_, previous_channel_id)) = removed_voice {
            voice_revoke::clear_voice_claim(&state, user_id, previous_channel_id).await;
            clear_screen_share_viewer_entries_for_user(&state, user_id);
            let departed_sid = state
                .voice_participant_sids
                .remove(&user_id)
                .map(|(_, sid)| sid);
            voice_revoke::schedule_departed_participant_removal(
                state.clone(),
                previous_channel_id,
                user_id,
                departed_sid,
                voice_revoke::DEPARTED_VOICE_DISCONNECT_DELAY,
            );
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
                    previous_channel_id: Some(previous_channel_id),
                },
            )
            .await;
            super::publish_event(
                &state,
                voice_control_event_from_state(
                    user_id,
                    previous_server_id,
                    previous_channel_id,
                    (false, false, false, false, false, false),
                ),
            )
            .await;
        }
    }

    tracing::info!("WebSocket disconnected: {}", ShortId(user_id));
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
