use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use jsonwebtoken::{encode, EncodingKey, Header};
use reqwest::StatusCode;
use serde::Serialize;
use uuid::Uuid;

use crate::{
    errors::AppError,
    ws::{self, access::can_join_voice_channel, WsEvent},
    AppState,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LivekitAdminVideoGrant {
    room: String,
    room_admin: bool,
}

#[derive(Debug, Serialize)]
struct LivekitAdminClaims {
    iss: String,
    sub: String,
    nbf: usize,
    exp: usize,
    video: LivekitAdminVideoGrant,
}

#[derive(Debug, Serialize)]
struct RemoveParticipantRequest<'a> {
    room: &'a str,
    identity: &'a str,
}

fn server_id_for_channel_from_state(
    state: &Arc<AppState>,
    channel_id: Uuid,
) -> impl std::future::Future<Output = Option<Uuid>> + '_ {
    async move {
        sqlx::query_scalar::<_, Uuid>("SELECT server_id FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
    }
}

fn cleanup_voice_channel_active_since_if_empty(state: &Arc<AppState>, channel_id: Uuid) {
    let still_has_participants = state
        .voice_sessions
        .iter()
        .any(|entry| *entry.value() == channel_id);
    if !still_has_participants {
        state.voice_channel_active_since_ms.remove(&channel_id);
    }
}

fn voice_control_event_from_state(
    user_id: Uuid,
    server_id: Option<Uuid>,
    state: (bool, bool, bool, bool, bool, bool),
) -> WsEvent {
    WsEvent::VoiceControlUpdate {
        user_id,
        server_id,
        muted: state.0,
        deafened: state.1,
        server_muted: state.2,
        server_deafened: state.3,
        screen_sharing: state.4,
        camera_on: state.5,
    }
}

async fn clear_local_voice_session(
    state: &Arc<AppState>,
    user_id: Uuid,
    channel_id: Uuid,
    reason: &str,
) {
    let removed = state
        .voice_sessions
        .remove_if(&user_id, |_, active_channel_id| {
            *active_channel_id == channel_id
        })
        .is_some();
    if !removed {
        return;
    }

    let server_id = server_id_for_channel_from_state(state, channel_id).await;
    let _ = state.voice_controls.remove(&user_id);
    cleanup_voice_channel_active_since_if_empty(state, channel_id);

    tracing::info!(
        "Revoked local voice session for user {} in channel {} ({})",
        user_id,
        channel_id,
        reason
    );

    ws::publish_event(
        state,
        WsEvent::VoiceStateUpdate {
            channel_id: None,
            user_id,
            server_id,
            channel_active_since_ms: None,
        },
    )
    .await;
    ws::publish_event(
        state,
        voice_control_event_from_state(
            user_id,
            server_id,
            (false, false, false, false, false, false),
        ),
    )
    .await;
}

fn livekit_http_base_url(ws_url: &str) -> Option<String> {
    let trimmed = ws_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("wss://") {
        return Some(format!("https://{rest}"));
    }
    if let Some(rest) = trimmed.strip_prefix("ws://") {
        return Some(format!("http://{rest}"));
    }
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        return Some(trimmed.to_string());
    }
    None
}

fn sign_livekit_admin_token(
    api_key: &str,
    api_secret: &str,
    room: &str,
) -> Result<String, AppError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs() as usize;
    let token = encode(
        &Header::default(),
        &LivekitAdminClaims {
            iss: api_key.to_string(),
            sub: "voxpery-server".to_string(),
            nbf: now,
            exp: now + 60,
            video: LivekitAdminVideoGrant {
                room: room.to_string(),
                room_admin: true,
            },
        },
        &EncodingKey::from_secret(api_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Failed to sign LiveKit admin token: {e}")))?;
    Ok(token)
}

async fn remove_livekit_participant(
    state: &Arc<AppState>,
    channel_id: Uuid,
    user_id: Uuid,
    reason: &str,
) {
    let Some(ws_url) = state.livekit_ws_url.as_deref() else {
        return;
    };
    let Some(api_key) = state.livekit_api_key.as_deref() else {
        return;
    };
    let Some(api_secret) = state.livekit_api_secret.as_deref() else {
        return;
    };
    let Some(base_url) = livekit_http_base_url(ws_url) else {
        tracing::warn!("Cannot revoke LiveKit participant because LIVEKIT_WS_URL is invalid");
        return;
    };

    let room = channel_id.to_string();
    let identity = user_id.to_string();
    let token = match sign_livekit_admin_token(api_key, api_secret, &room) {
        Ok(token) => token,
        Err(e) => {
            tracing::warn!("Cannot revoke LiveKit participant: {}", e);
            return;
        }
    };

    let url = format!("{base_url}/twirp/livekit.RoomService/RemoveParticipant");
    let response = state
        .release_http_client
        .post(url)
        .bearer_auth(token)
        .json(&RemoveParticipantRequest {
            room: &room,
            identity: &identity,
        })
        .send()
        .await;

    match response {
        Ok(response) if response.status().is_success() => {
            tracing::info!(
                "Removed LiveKit participant {} from room {} ({})",
                user_id,
                channel_id,
                reason
            );
        }
        Ok(response) if response.status() == StatusCode::NOT_FOUND => {
            tracing::debug!(
                "LiveKit participant {} was not present in room {} during revoke ({})",
                user_id,
                channel_id,
                reason
            );
        }
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::warn!(
                "LiveKit participant revoke failed for user {} room {}: status={} body_length={}",
                user_id,
                channel_id,
                status,
                body.len()
            );
        }
        Err(e) => {
            tracing::warn!(
                "LiveKit participant revoke request failed for user {} room {}: {}",
                user_id,
                channel_id,
                e
            );
        }
    }
}

async fn voice_channel_ids_for_server(
    state: &Arc<AppState>,
    server_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    let channel_ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'voice'",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    Ok(channel_ids)
}

/// Revoke a user's voice access after server membership was removed.
///
/// This clears Voxpery's runtime voice state and also asks LiveKit to remove the
/// participant from every voice room in that server so a modified client cannot
/// keep listening with a previously minted token.
pub async fn revoke_user_voice_access_for_server(
    state: &Arc<AppState>,
    server_id: Uuid,
    user_id: Uuid,
    reason: &str,
) -> Result<(), AppError> {
    let voice_channel_ids = voice_channel_ids_for_server(state, server_id).await?;

    if let Some(active_channel_id) = state.voice_sessions.get(&user_id).map(|entry| *entry) {
        if voice_channel_ids.contains(&active_channel_id) {
            clear_local_voice_session(state, user_id, active_channel_id, reason).await;
        }
    }

    for channel_id in voice_channel_ids {
        remove_livekit_participant(state, channel_id, user_id, reason).await;
    }

    Ok(())
}

/// Re-check active voice sessions after permission or channel visibility changes.
pub async fn revoke_invalid_voice_sessions_for_server(
    state: &Arc<AppState>,
    server_id: Uuid,
    reason: &str,
) -> Result<(), AppError> {
    let voice_channel_ids = voice_channel_ids_for_server(state, server_id).await?;
    let active_sessions: Vec<(Uuid, Uuid)> = state
        .voice_sessions
        .iter()
        .map(|entry| (*entry.key(), *entry.value()))
        .filter(|(_, channel_id)| voice_channel_ids.contains(channel_id))
        .collect();

    for (user_id, channel_id) in active_sessions {
        if !can_join_voice_channel(&state.db, user_id, channel_id).await? {
            clear_local_voice_session(state, user_id, channel_id, reason).await;
            remove_livekit_participant(state, channel_id, user_id, reason).await;
        }
    }

    Ok(())
}

/// Revoke a single active voice session, used by moderation controls that
/// disconnect one participant from the current channel.
pub async fn revoke_active_voice_session(
    state: &Arc<AppState>,
    user_id: Uuid,
    reason: &str,
) -> Result<(), AppError> {
    let Some(channel_id) = state.voice_sessions.get(&user_id).map(|entry| *entry) else {
        return Ok(());
    };
    clear_local_voice_session(state, user_id, channel_id, reason).await;
    remove_livekit_participant(state, channel_id, user_id, reason).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::livekit_http_base_url;

    #[test]
    fn derives_livekit_http_base_url_from_websocket_url() {
        assert_eq!(
            livekit_http_base_url("wss://livekit.voxpery.com/"),
            Some("https://livekit.voxpery.com".to_string())
        );
        assert_eq!(
            livekit_http_base_url("ws://localhost:7880"),
            Some("http://localhost:7880".to_string())
        );
        assert_eq!(
            livekit_http_base_url("https://livekit.voxpery.com"),
            Some("https://livekit.voxpery.com".to_string())
        );
        assert_eq!(livekit_http_base_url(""), None);
    }
}
