use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use jsonwebtoken::{encode, EncodingKey, Header};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::AppError,
    services::voice_moderation::ServerVoiceModeration,
    ws::{self, access::can_join_voice_channel, WsEvent},
    AppState,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LivekitAdminVideoGrant {
    room: String,
    room_admin: bool,
    /// LiveKit requires `roomCreate` for DeleteRoom; only room-closing tokens carry it.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    room_create: bool,
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

#[derive(Debug, Serialize)]
struct UpdateParticipantRequest<'a> {
    room: &'a str,
    identity: &'a str,
    permission: LivekitParticipantPermission,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LivekitParticipantPermission {
    can_publish: bool,
    can_subscribe: bool,
    can_publish_data: bool,
}

#[derive(Debug, Serialize)]
struct ListParticipantsRequest<'a> {
    room: &'a str,
}

#[derive(Debug, Serialize)]
struct DeleteRoomRequest<'a> {
    room: &'a str,
}

/// Waits between retries of a LiveKit removal that failed. Voxpery has already dropped the
/// voice session locally; the retries make sure the media connection is cut as well.
const LIVEKIT_RETRY_DELAYS: [Duration; 5] = [
    Duration::from_secs(1),
    Duration::from_secs(5),
    Duration::from_secs(15),
    Duration::from_secs(30),
    Duration::from_secs(60),
];

#[derive(Debug, Deserialize)]
struct ListParticipantsResponse {
    #[serde(default)]
    participants: Vec<LivekitParticipantInfo>,
}

#[derive(Debug, Deserialize)]
struct LivekitParticipantInfo {
    sid: String,
    identity: String,
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

pub(crate) async fn clear_local_voice_session(
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

    state.voice_participant_sids.remove(&user_id);
    state
        .screen_share_viewers
        .retain(|(viewer_id, publisher_id), _| *viewer_id != user_id && *publisher_id != user_id);
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
            previous_channel_id: Some(channel_id),
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
    room_create: bool,
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
                room_create,
            },
        },
        &EncodingKey::from_secret(api_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Failed to sign LiveKit admin token: {e}")))?;
    Ok(token)
}

/// Runs `attempt` again in the background after a failed LiveKit call, until it succeeds or
/// the retry delays run out. Voice not being configured is not a failure.
fn retry_livekit_in_background<F, Fut>(description: String, attempt: F)
where
    F: Fn() -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<(), AppError>> + Send + 'static,
{
    tokio::spawn(async move {
        for delay in LIVEKIT_RETRY_DELAYS {
            tokio::time::sleep(delay).await;
            match attempt().await {
                Ok(()) | Err(AppError::FeatureDisabled(_)) => return,
                Err(error) => tracing::warn!("Retrying {} failed: {}", description, error),
            }
        }
        tracing::error!(
            "Giving up on {} after {} retries",
            description,
            LIVEKIT_RETRY_DELAYS.len()
        );
    });
}

async fn remove_livekit_participant(
    state: &Arc<AppState>,
    channel_id: Uuid,
    user_id: Uuid,
    reason: &str,
) {
    match remove_livekit_participant_checked(state, channel_id, user_id, reason).await {
        Ok(()) | Err(AppError::FeatureDisabled(_)) => {}
        Err(e) => {
            tracing::warn!(
                "LiveKit participant revoke failed for user {} room {}: {}",
                user_id,
                channel_id,
                e
            );
            let state = state.clone();
            let reason = reason.to_string();
            retry_livekit_in_background(
                format!("LiveKit participant revoke for user {user_id} room {channel_id}"),
                move || {
                    let state = state.clone();
                    let reason = reason.clone();
                    async move {
                        remove_livekit_participant_checked(&state, channel_id, user_id, &reason)
                            .await
                    }
                },
            );
        }
    }
}

fn livekit_admin_request_parts(
    state: &AppState,
    channel_id: Uuid,
) -> Result<(String, String, String), AppError> {
    livekit_admin_request_parts_with(state, channel_id, false)
}

fn livekit_admin_request_parts_with(
    state: &AppState,
    channel_id: Uuid,
    room_create: bool,
) -> Result<(String, String, String), AppError> {
    let api_url = state
        .livekit_api_url
        .as_deref()
        .or(state.livekit_ws_url.as_deref())
        .ok_or_else(|| AppError::FeatureDisabled("Voice service is not configured.".into()))?;
    let api_key = state
        .livekit_api_key
        .as_deref()
        .ok_or_else(|| AppError::FeatureDisabled("Voice service is not configured.".into()))?;
    let api_secret = state
        .livekit_api_secret
        .as_deref()
        .ok_or_else(|| AppError::FeatureDisabled("Voice service is not configured.".into()))?;
    let base_url = livekit_http_base_url(api_url)
        .ok_or_else(|| AppError::Internal("LIVEKIT_API_URL or LIVEKIT_WS_URL is invalid".into()))?;

    let room = channel_id.to_string();
    let token = sign_livekit_admin_token(api_key, api_secret, &room, room_create)?;
    Ok((base_url, room, token))
}

/// Closes the LiveKit room for a voice channel, disconnecting everyone in it.
async fn delete_livekit_room_checked(
    state: &Arc<AppState>,
    channel_id: Uuid,
) -> Result<(), AppError> {
    let (base_url, room, token) = livekit_admin_request_parts_with(state, channel_id, true)?;
    let url = format!("{base_url}/twirp/livekit.RoomService/DeleteRoom");
    let response = state
        .release_http_client
        .post(url)
        .bearer_auth(token)
        .timeout(Duration::from_secs(3))
        .json(&DeleteRoomRequest { room: &room })
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("LiveKit room deletion failed: {e}")))?;
    if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
        return Ok(());
    }
    Err(AppError::Internal(format!(
        "LiveKit room deletion returned {}",
        response.status()
    )))
}

/// Ends voice in channels that are being removed (channel or server deletion): clears the
/// local sessions and closes the LiveKit rooms, retrying in the background on failure.
pub async fn close_voice_rooms(state: &Arc<AppState>, channel_ids: &[Uuid], reason: &str) {
    for &channel_id in channel_ids {
        let user_ids: Vec<Uuid> = state
            .voice_sessions
            .iter()
            .filter(|entry| *entry.value() == channel_id)
            .map(|entry| *entry.key())
            .collect();
        for user_id in user_ids {
            clear_local_voice_session(state, user_id, channel_id, reason).await;
        }
        match delete_livekit_room_checked(state, channel_id).await {
            Ok(()) | Err(AppError::FeatureDisabled(_)) => {}
            Err(error) => {
                tracing::warn!(
                    "LiveKit room close failed for room {}: {}",
                    channel_id,
                    error
                );
                let state = state.clone();
                retry_livekit_in_background(
                    format!("LiveKit room close for room {channel_id}"),
                    move || {
                        let state = state.clone();
                        async move { delete_livekit_room_checked(&state, channel_id).await }
                    },
                );
            }
        }
    }
}

pub(crate) async fn update_livekit_voice_permissions(
    state: &Arc<AppState>,
    channel_id: Uuid,
    user_id: Uuid,
    moderation: ServerVoiceModeration,
) -> Result<(), AppError> {
    let (base_url, room, token) = livekit_admin_request_parts(state, channel_id)?;
    let identity = user_id.to_string();
    let url = format!("{base_url}/twirp/livekit.RoomService/UpdateParticipant");
    let response = state
        .release_http_client
        .post(url)
        .bearer_auth(token)
        .timeout(Duration::from_secs(3))
        .json(&UpdateParticipantRequest {
            room: &room,
            identity: &identity,
            permission: LivekitParticipantPermission {
                can_publish: moderation.can_publish(),
                can_subscribe: moderation.can_subscribe(),
                can_publish_data: true,
            },
        })
        .send()
        .await
        .map_err(|error| {
            AppError::Internal(format!("LiveKit permission update failed: {error}"))
        })?;

    if response.status() == StatusCode::NOT_FOUND {
        return Ok(());
    }
    if !response.status().is_success() {
        return Err(AppError::Internal(format!(
            "LiveKit permission update returned {}",
            response.status()
        )));
    }
    Ok(())
}

pub(crate) async fn livekit_participant_sid(
    state: &Arc<AppState>,
    channel_id: Uuid,
    user_id: Uuid,
) -> Result<Option<String>, AppError> {
    let (base_url, room, token) = livekit_admin_request_parts(state, channel_id)?;
    let identity = user_id.to_string();
    let url = format!("{base_url}/twirp/livekit.RoomService/GetParticipant");
    let response = state
        .release_http_client
        .post(url)
        .bearer_auth(token)
        .json(&RemoveParticipantRequest {
            room: &room,
            identity: &identity,
        })
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("LiveKit participant lookup failed: {e}")))?;

    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(AppError::Internal(format!(
            "LiveKit participant lookup returned {}",
            response.status()
        )));
    }

    let participant = response
        .json::<LivekitParticipantInfo>()
        .await
        .map_err(|e| AppError::Internal(format!("Invalid LiveKit participant response: {e}")))?;
    if participant.identity != identity || participant.sid.trim().is_empty() {
        return Err(AppError::Internal(
            "LiveKit returned an unexpected participant identity or SID".into(),
        ));
    }
    Ok(Some(participant.sid))
}

pub(crate) async fn remove_livekit_participant_checked(
    state: &Arc<AppState>,
    channel_id: Uuid,
    user_id: Uuid,
    reason: &str,
) -> Result<(), AppError> {
    let (base_url, room, token) = livekit_admin_request_parts(state, channel_id)?;
    let identity = user_id.to_string();

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
            Ok(())
        }
        Ok(response) if response.status() == StatusCode::NOT_FOUND => {
            tracing::debug!(
                "LiveKit participant {} was not present in room {} during revoke ({})",
                user_id,
                channel_id,
                reason
            );
            Ok(())
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
            Err(AppError::Internal(format!(
                "LiveKit participant removal returned {status}"
            )))
        }
        Err(e) => {
            tracing::warn!(
                "LiveKit participant revoke request failed for user {} room {}: {}",
                user_id,
                channel_id,
                e
            );
            Err(AppError::Internal(format!(
                "LiveKit participant removal request failed: {e}"
            )))
        }
    }
}

/// User ids connected to the LiveKit room for `channel_id`, whether or not they reported
/// the session to Voxpery. `None` when voice is not configured.
async fn livekit_room_user_ids(
    state: &Arc<AppState>,
    channel_id: Uuid,
) -> Result<Option<Vec<Uuid>>, AppError> {
    let (base_url, room, token) = match livekit_admin_request_parts(state, channel_id) {
        Ok(parts) => parts,
        Err(AppError::FeatureDisabled(_)) => return Ok(None),
        Err(error) => return Err(error),
    };
    let url = format!("{base_url}/twirp/livekit.RoomService/ListParticipants");
    let response = state
        .release_http_client
        .post(url)
        .bearer_auth(token)
        .json(&ListParticipantsRequest { room: &room })
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("LiveKit participant listing failed: {e}")))?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(Some(Vec::new()));
    }
    if !response.status().is_success() {
        return Err(AppError::Internal(format!(
            "LiveKit participant listing returned {}",
            response.status()
        )));
    }
    let body = response
        .json::<ListParticipantsResponse>()
        .await
        .map_err(|e| AppError::Internal(format!("Invalid LiveKit participant list: {e}")))?;
    Ok(Some(
        body.participants
            .iter()
            .filter_map(|participant| Uuid::parse_str(&participant.identity).ok())
            .collect(),
    ))
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

    // A client can connect to LiveKit with its token without reporting the session to
    // Voxpery, so also recheck everyone actually present in each room.
    for channel_id in voice_channel_ids {
        let user_ids = match livekit_room_user_ids(state, channel_id).await {
            Ok(Some(user_ids)) => user_ids,
            Ok(None) => return Ok(()),
            Err(error) => {
                tracing::warn!(
                    "LiveKit participant recheck failed for room {}: {}",
                    channel_id,
                    error
                );
                continue;
            }
        };
        for user_id in user_ids {
            if !can_join_voice_channel(&state.db, user_id, channel_id).await? {
                remove_livekit_participant(state, channel_id, user_id, reason).await;
            }
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
