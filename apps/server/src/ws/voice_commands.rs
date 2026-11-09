//! Voice commands from clients and the helpers they share: joining, leaving, moderation, moves
//! between channels and screen-share viewers.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use dashmap::mapref::entry::Entry;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::access::{can_join_voice_channel, can_subscribe_to_channel};
use super::cluster::ClusterUpdate;
use super::WsEvent;
use crate::services::audit::{self, VoiceModerationAuditEntry};
use crate::services::permissions::{get_user_channel_permissions, Permissions};
use crate::services::redact::ShortId;
use crate::services::voice_moderation::{self, ServerVoiceModeration};
use crate::services::voice_revoke;
use crate::{AppState, PendingVoiceMove};

const VOICE_MOVE_TIMEOUT: Duration = Duration::from_secs(30);
const VOICE_MOVE_LIVEKIT_VERIFY_TIMEOUT: Duration = Duration::from_secs(10);
const VOICE_MOVE_LIVEKIT_VERIFY_INTERVAL: Duration = Duration::from_millis(250);

/// The client connection a voice command came from.
pub(super) struct VoiceConnection {
    pub(super) state: Arc<AppState>,
    pub(super) user_id: Uuid,
    pub(super) connection_id: Uuid,
    pub(super) client_tx: mpsc::Sender<WsEvent>,
}

pub(super) async fn server_id_for_channel(db: &sqlx::PgPool, channel_id: Uuid) -> Option<Uuid> {
    sqlx::query_scalar::<_, Uuid>("SELECT server_id FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
}

/// Voice moderation permissions an actor holds in a voice channel. Voice moderation follows
/// explicit permissions independently of role position (see docs/VOICE_SYSTEM.md), but they
/// are read from the channel so channel and category overrides apply.
pub(super) async fn can_view_channel(db: &sqlx::PgPool, user_id: Uuid, channel_id: Uuid) -> bool {
    matches!(
        can_subscribe_to_channel(db, user_id, channel_id).await,
        Ok(true)
    )
}

pub(super) async fn voice_moderator_permissions(
    db: &sqlx::PgPool,
    channel_id: Uuid,
    actor_id: Uuid,
) -> Option<Permissions> {
    match get_user_channel_permissions(db, channel_id, actor_id).await {
        Ok(perms) => Some(perms),
        Err(e) => {
            tracing::warn!("Voice moderation permission lookup failed: {}", e);
            None
        }
    }
}

/// Whether the actor can see the voice channel and move members in it.
pub(super) async fn can_move_members_in(
    db: &sqlx::PgPool,
    channel_id: Uuid,
    actor_id: Uuid,
) -> bool {
    if !can_view_channel(db, actor_id, channel_id).await {
        return false;
    }
    voice_moderator_permissions(db, channel_id, actor_id)
        .await
        .is_some_and(|perms| {
            perms.contains(Permissions::MOVE_MEMBERS) || perms.contains(Permissions::MANAGE_SERVER)
        })
}

pub(super) async fn voice_channel_context(
    db: &sqlx::PgPool,
    channel_id: Uuid,
) -> Option<(Uuid, String)> {
    sqlx::query_as::<_, (Uuid, String)>(
        "SELECT server_id, name FROM channels WHERE id = $1 AND channel_type = 'voice'",
    )
    .bind(channel_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

pub(super) fn normalize_voice_moderation_reason(reason: Option<String>) -> Option<Option<String>> {
    let reason = reason.map(|value| value.trim().to_string());
    match reason {
        Some(value) if value.chars().count() > 500 => None,
        Some(value) if !value.is_empty() => Some(Some(value)),
        _ => Some(None),
    }
}

pub(super) fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

pub(super) fn channel_has_voice_participants(state: &AppState, channel_id: Uuid) -> bool {
    state
        .voice_sessions
        .iter()
        .any(|entry| *entry.value() == channel_id)
}

pub(super) fn ensure_voice_channel_active_since_ms(state: &AppState, channel_id: Uuid) -> u64 {
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

pub(super) fn cleanup_voice_channel_active_since_if_empty(state: &AppState, channel_id: Uuid) {
    if !channel_has_voice_participants(state, channel_id) {
        state.voice_channel_active_since_ms.remove(&channel_id);
    }
}

pub(super) fn voice_move_result_event(
    request_id: Uuid,
    target_user_id: Uuid,
    channel_id: Uuid,
    success: bool,
    message: impl Into<String>,
) -> WsEvent {
    WsEvent::VoiceMemberMoveResult {
        request_id,
        target_user_id,
        channel_id,
        success,
        message: message.into(),
    }
}

pub(super) fn send_voice_move_result(
    sender: &mpsc::Sender<WsEvent>,
    request_id: Uuid,
    target_user_id: Uuid,
    channel_id: Uuid,
    success: bool,
    message: impl Into<String>,
) {
    let _ = sender.try_send(voice_move_result_event(
        request_id,
        target_user_id,
        channel_id,
        success,
        message,
    ));
}

pub(super) async fn publish_voice_move_result(
    state: &Arc<AppState>,
    pending: &PendingVoiceMove,
    success: bool,
    message: impl Into<String>,
) {
    super::publish_user_event(
        state,
        pending.actor_id,
        voice_move_result_event(
            pending.request_id,
            pending.target_user_id,
            pending.destination_channel_id,
            success,
            message,
        ),
    )
    .await;
}

pub(super) async fn complete_voice_member_move(
    state: &Arc<AppState>,
    target_user_id: Uuid,
    request_id: Uuid,
    success: bool,
    client_error: Option<String>,
) {
    let Some((_, pending)) = state
        .pending_voice_moves
        .remove_if(&target_user_id, |_, pending| {
            pending.request_id == request_id
        })
    else {
        return;
    };
    super::publish_cluster_update(
        state,
        ClusterUpdate::VoiceMoveFinished {
            target_user_id,
            request_id,
        },
    )
    .await;

    if !success {
        let error = client_error
            .map(|value| value.trim().chars().take(160).collect::<String>())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "target client rejected the move".to_string());
        tracing::warn!(
            "Voice move {} failed on target client {}: {}",
            request_id,
            ShortId(target_user_id),
            error
        );
        publish_voice_move_result(
            state,
            &pending,
            false,
            "The member could not change voice channels.",
        )
        .await;
        return;
    }

    let active_channel = state
        .voice_sessions
        .get(&target_user_id)
        .map(|entry| *entry);
    let participant_sid = state
        .voice_participant_sids
        .get(&target_user_id)
        .map(|entry| entry.clone());
    if active_channel != Some(pending.destination_channel_id) || participant_sid.is_none() {
        publish_voice_move_result(
            state,
            &pending,
            false,
            "The member did not establish the destination voice connection.",
        )
        .await;
        return;
    }

    let client_participant_sid = participant_sid.expect("participant SID checked above");
    let verification_deadline = tokio::time::Instant::now() + VOICE_MOVE_LIVEKIT_VERIFY_TIMEOUT;
    let mut verified_participant_sid = None;
    let mut verification_error = None;
    loop {
        match voice_revoke::livekit_participant_sid(
            state,
            pending.destination_channel_id,
            target_user_id,
        )
        .await
        {
            Ok(Some(participant_sid)) => {
                verified_participant_sid = Some(participant_sid);
                break;
            }
            Ok(None) => {}
            Err(error) => {
                verification_error = Some(error.to_string());
            }
        }
        if tokio::time::Instant::now() >= verification_deadline {
            break;
        }
        tokio::time::sleep(VOICE_MOVE_LIVEKIT_VERIFY_INTERVAL).await;
    }
    let Some(participant_sid) = verified_participant_sid else {
        if let Some(error) = verification_error {
            tracing::warn!(
                "Voice move {} LiveKit verification timed out after an error: {}",
                request_id,
                error
            );
        }
        publish_voice_move_result(
            state,
            &pending,
            false,
            "LiveKit could not verify the destination voice connection.",
        )
        .await;
        return;
    };

    if state
        .voice_sessions
        .get(&target_user_id)
        .map(|entry| *entry)
        != Some(pending.destination_channel_id)
    {
        publish_voice_move_result(
            state,
            &pending,
            false,
            "The member left the destination voice channel before verification completed.",
        )
        .await;
        return;
    }

    if participant_sid != client_participant_sid {
        tracing::debug!(
            "Voice move {} reconciled participant SID {} to LiveKit SID {}",
            request_id,
            client_participant_sid,
            participant_sid
        );
    }
    state
        .voice_participant_sids
        .insert(target_user_id, participant_sid.clone());
    super::publish_cluster_update(
        state,
        ClusterUpdate::ParticipantSid {
            user_id: target_user_id,
            participant_sid: participant_sid.clone(),
        },
    )
    .await;

    if let Err(error) = voice_revoke::remove_livekit_participant_checked(
        state,
        pending.source_channel_id,
        target_user_id,
        "voice member moved",
    )
    .await
    {
        tracing::warn!("Voice move {} source cleanup failed: {}", request_id, error);
        publish_voice_move_result(
            state,
            &pending,
            false,
            "The destination connected, but the previous voice session could not be closed.",
        )
        .await;
        return;
    }

    let audit_entries = [VoiceModerationAuditEntry {
        action: audit::VOICE_MEMBER_MOVE,
        details: serde_json::json!({
            "request_id": pending.request_id,
            "source_channel_id": pending.source_channel_id,
            "source_channel_name": pending.source_channel_name,
            "destination_channel_id": pending.destination_channel_id,
            "destination_channel_name": pending.destination_channel_name,
            "participant_sid": participant_sid,
        }),
    }];
    if let Err(error) = audit::log_voice_moderation(
        &state.db,
        pending.actor_id,
        pending.server_id,
        pending.target_user_id,
        pending.destination_channel_id,
        pending.reason.as_deref(),
        &audit_entries,
    )
    .await
    {
        tracing::error!("Voice move {} audit log failed: {}", request_id, error);
        publish_voice_move_result(
            state,
            &pending,
            false,
            "The member moved, but the audit record could not be written.",
        )
        .await;
        return;
    }

    publish_voice_move_result(
        state,
        &pending,
        true,
        format!("Member moved to {}.", pending.destination_channel_name),
    )
    .await;
}

pub(super) fn voice_control_event_from_state(
    user_id: Uuid,
    server_id: Option<Uuid>,
    channel_id: Uuid,
    state: (bool, bool, bool, bool, bool, bool),
) -> WsEvent {
    let (self_muted, self_deafened, server_muted, server_deafened, screen_sharing, camera_on) =
        state;
    WsEvent::VoiceControlUpdate {
        user_id,
        server_id,
        channel_id: Some(channel_id),
        muted: self_muted || server_muted,
        deafened: self_deafened || server_deafened,
        server_muted,
        server_deafened,
        screen_sharing,
        camera_on,
    }
}

pub(super) fn screen_share_viewer_event(
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

pub(super) fn clear_screen_share_viewer_entries_for_user(state: &AppState, user_id: Uuid) {
    state
        .screen_share_viewers
        .retain(|(viewer_id, publisher_id), _| *viewer_id != user_id && *publisher_id != user_id);
}

pub(super) async fn clear_screen_share_viewers_for_publisher(
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

pub(super) async fn join_voice(
    connection: &VoiceConnection,
    channel_id: Uuid,
    participant_sid: Option<String>,
) {
    let (state, user_id) = (&connection.state, connection.user_id);
    let (connection_id, client_tx) = (connection.connection_id, &connection.client_tx);
    match can_join_voice_channel(&state.db, user_id, channel_id).await {
        Ok(false) => {
            tracing::debug!(
                "JoinVoice denied for channel {} (user {})",
                channel_id,
                ShortId(user_id)
            );
        }
        Err(e) => {
            tracing::warn!("JoinVoice access check failed: {}", e);
        }
        Ok(true) => {
            let moderation =
                match voice_moderation::for_channel(&state.db, user_id, channel_id).await {
                    Ok(Some(moderation)) => moderation,
                    Ok(None) => return,
                    Err(error) => {
                        tracing::warn!("JoinVoice moderation lookup failed: {}", error);
                        return;
                    }
                };
            // 1. Update voice session
            voice_revoke::record_voice_claim(state, user_id, channel_id).await;
            clear_screen_share_viewer_entries_for_user(state, user_id);
            let previous_channel_id = state.voice_sessions.insert(user_id, channel_id);
            let previous_holder = state
                .voice_session_connections
                .insert(user_id, (connection_id, client_tx.clone()));
            let previous_sid = state
                .voice_participant_sids
                .get(&user_id)
                .map(|entry| entry.clone());
            if let (Some((holder_id, holder_tx)), Some(previous)) =
                (previous_holder, previous_channel_id)
            {
                if holder_id != connection_id {
                    // Another tab or device took the session over.
                    let _ = holder_tx.try_send(WsEvent::VoiceSessionMoved {
                        channel_id: previous,
                    });
                }
            }
            // The participant left behind in the previous room has
            // no session any more, whoever made this move.
            if let Some(previous) = previous_channel_id.filter(|id| *id != channel_id) {
                voice_revoke::clear_voice_claim(state, user_id, previous).await;
                voice_revoke::schedule_departed_participant_removal(
                    state.clone(),
                    previous,
                    user_id,
                    previous_sid,
                    voice_revoke::DEPARTED_VOICE_LEAVE_DELAY,
                );
            }
            if let Some(participant_sid) = participant_sid.filter(|sid| {
                !sid.is_empty()
                    && sid.len() <= 128
                    && sid
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            }) {
                state
                    .voice_participant_sids
                    .insert(user_id, participant_sid.clone());
                super::publish_cluster_update(
                    state,
                    ClusterUpdate::ParticipantSid {
                        user_id,
                        participant_sid,
                    },
                )
                .await;
            } else {
                state.voice_participant_sids.remove(&user_id);
            }
            if let Some(previous_channel_id) = previous_channel_id {
                if previous_channel_id != channel_id {
                    cleanup_voice_channel_active_since_if_empty(state, previous_channel_id);
                }
            }
            let _ = state.voice_controls.insert(
                user_id,
                (
                    false,
                    false,
                    moderation.muted,
                    moderation.deafened,
                    false,
                    false,
                ),
            );
            let channel_active_since_ms = ensure_voice_channel_active_since_ms(state, channel_id);

            // 2. Broadcast join to everyone
            let server_id = server_id_for_channel(&state.db, channel_id).await;
            super::publish_event(
                state,
                WsEvent::VoiceStateUpdate {
                    channel_id: Some(channel_id),
                    user_id,
                    server_id,
                    channel_active_since_ms: Some(channel_active_since_ms),
                    previous_channel_id: previous_channel_id
                        .filter(|previous| *previous != channel_id),
                },
            )
            .await;
            super::publish_event(
                state,
                voice_control_event_from_state(
                    user_id,
                    server_id,
                    channel_id,
                    (
                        false,
                        false,
                        moderation.muted,
                        moderation.deafened,
                        false,
                        false,
                    ),
                ),
            )
            .await;

            // 3. Send existing users in this channel to the joining user
            for entry in state.voice_sessions.iter() {
                let (other_uid, other_cid) = entry.pair();
                if *other_cid == channel_id && *other_uid != user_id {
                    let _ = client_tx.try_send(WsEvent::VoiceStateUpdate {
                        channel_id: Some(channel_id),
                        user_id: *other_uid,
                        server_id,
                        channel_active_since_ms: Some(channel_active_since_ms),
                        previous_channel_id: None,
                    });
                    let control_state = state
                        .voice_controls
                        .get(other_uid)
                        .map(|s| *s)
                        .unwrap_or((false, false, false, false, false, false));
                    let _ = client_tx.try_send(voice_control_event_from_state(
                        *other_uid,
                        server_id,
                        channel_id,
                        control_state,
                    ));
                }
            }
        }
    }
}

/// Whether `connection` is the one holding its user's voice session on this instance. Another
/// tab or device of the same user must not change that call's media or watching state.
fn connection_holds_voice(connection: &VoiceConnection) -> bool {
    connection
        .state
        .voice_session_connections
        .get(&connection.user_id)
        .is_some_and(|holder| holder.0 == connection.connection_id)
}

pub(super) async fn leave_voice(connection: &VoiceConnection) {
    let (state, user_id) = (&connection.state, connection.user_id);
    let connection_id = connection.connection_id;
    // Only the connection holding the session may end it. Without a local holder the session
    // belongs to a connection on another instance, unless no instance holds it any more.
    let holds_session = match state.voice_session_connections.get(&user_id) {
        Some(holder) => holder.0 == connection_id,
        None => !state.peers.holds_voice(user_id),
    };
    if !holds_session {
        return;
    }
    state.voice_session_connections.remove(&user_id);
    if let Some((_, previous_channel_id)) = state.voice_sessions.remove(&user_id) {
        voice_revoke::clear_voice_claim(state, user_id, previous_channel_id).await;
        clear_screen_share_viewer_entries_for_user(state, user_id);
        let departed_sid = state
            .voice_participant_sids
            .remove(&user_id)
            .map(|(_, sid)| sid);
        voice_revoke::schedule_departed_participant_removal(
            state.clone(),
            previous_channel_id,
            user_id,
            departed_sid,
            voice_revoke::DEPARTED_VOICE_LEAVE_DELAY,
        );
        let previous_server_id = server_id_for_channel(&state.db, previous_channel_id).await;
        let _ = state.voice_controls.remove(&user_id);
        cleanup_voice_channel_active_since_if_empty(state, previous_channel_id);
        super::publish_event(
            state,
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
            state,
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

pub(super) async fn disconnect_voice_member(
    connection: &VoiceConnection,
    target_user_id: Uuid,
    reason: Option<String>,
) {
    let (state, user_id) = (&connection.state, connection.user_id);
    if target_user_id == user_id {
        return;
    }
    let Some(reason) = normalize_voice_moderation_reason(reason) else {
        return;
    };
    let target_channel = state.voice_sessions.get(&target_user_id).map(|r| *r);
    let Some(target_channel_id) = target_channel else {
        return;
    };
    let Some((target_server_id, target_channel_name)) =
        voice_channel_context(&state.db, target_channel_id).await
    else {
        return;
    };

    let Some(perms) = voice_moderator_permissions(&state.db, target_channel_id, user_id).await
    else {
        return;
    };

    let can_disconnect = perms.contains(Permissions::MUTE_MEMBERS)
        || perms.contains(Permissions::DEAFEN_MEMBERS)
        || perms.contains(Permissions::MANAGE_SERVER);
    if !can_disconnect {
        return;
    }

    let audit_entries = [VoiceModerationAuditEntry {
        action: audit::VOICE_MEMBER_DISCONNECT,
        details: serde_json::json!({
            "channel_name": target_channel_name,
        }),
    }];
    if let Err(e) = audit::log_voice_moderation(
        &state.db,
        user_id,
        target_server_id,
        target_user_id,
        target_channel_id,
        reason.as_deref(),
        &audit_entries,
    )
    .await
    {
        tracing::error!("DisconnectVoiceMember audit log failed: {}", e);
        return;
    }

    if let Err(e) = voice_revoke::revoke_active_voice_session(
        state,
        target_user_id,
        "voice moderator disconnect",
    )
    .await
    {
        tracing::warn!("DisconnectVoiceMember voice revoke failed: {}", e);
    }
}

pub(super) async fn move_voice_member(
    connection: &VoiceConnection,
    request_id: Option<Uuid>,
    target_user_id: Uuid,
    channel_id: Uuid,
    reason: Option<String>,
) {
    let (state, user_id) = (&connection.state, connection.user_id);
    let client_tx = &connection.client_tx;
    let request_id = request_id.unwrap_or_else(Uuid::new_v4);
    if target_user_id == user_id {
        send_voice_move_result(
            client_tx,
            request_id,
            target_user_id,
            channel_id,
            false,
            "Join the destination voice channel directly.",
        );
        return;
    }
    let Some(reason) = normalize_voice_moderation_reason(reason) else {
        send_voice_move_result(
            client_tx,
            request_id,
            target_user_id,
            channel_id,
            false,
            "The moderation reason is too long.",
        );
        return;
    };
    // Nothing about the member's voice state is revealed before
    // the moderator is known to be allowed in the destination.
    if !can_move_members_in(&state.db, channel_id, user_id).await {
        send_voice_move_result(
            client_tx,
            request_id,
            target_user_id,
            channel_id,
            false,
            "You do not have permission to move this member.",
        );
        return;
    }
    let Some((destination_server_id, destination_channel_name)) =
        voice_channel_context(&state.db, channel_id).await
    else {
        send_voice_move_result(
            client_tx,
            request_id,
            target_user_id,
            channel_id,
            false,
            "The destination voice channel is no longer available.",
        );
        return;
    };

    // A member elsewhere, or in a channel this moderator cannot
    // moderate, looks the same as one who is not connected.
    let source = state
        .voice_sessions
        .get(&target_user_id)
        .map(|entry| *entry);
    let source = match source {
        Some(source_channel_id)
            if can_move_members_in(&state.db, source_channel_id, user_id).await =>
        {
            voice_channel_context(&state.db, source_channel_id)
                .await
                .filter(|(server_id, _)| *server_id == destination_server_id)
                .map(|(server_id, name)| (source_channel_id, server_id, name))
        }
        _ => None,
    };
    let Some((source_channel_id, source_server_id, source_channel_name)) = source else {
        send_voice_move_result(
            client_tx,
            request_id,
            target_user_id,
            channel_id,
            false,
            "The member is no longer connected to voice.",
        );
        return;
    };
    if source_channel_id == channel_id {
        send_voice_move_result(
            client_tx,
            request_id,
            target_user_id,
            channel_id,
            false,
            "The member is already in that voice channel.",
        );
        return;
    }
    if !matches!(
        can_join_voice_channel(&state.db, target_user_id, channel_id,).await,
        Ok(true)
    ) {
        send_voice_move_result(
            client_tx,
            request_id,
            target_user_id,
            channel_id,
            false,
            "The member cannot connect to the destination voice channel.",
        );
        return;
    }

    let pending = PendingVoiceMove {
        request_id,
        actor_id: user_id,
        target_user_id,
        source_channel_id,
        source_channel_name,
        destination_channel_id: channel_id,
        destination_channel_name,
        server_id: source_server_id,
        reason,
    };
    match state.pending_voice_moves.entry(target_user_id) {
        Entry::Occupied(_) => {
            send_voice_move_result(
                client_tx,
                request_id,
                target_user_id,
                channel_id,
                false,
                "Another voice move is already in progress for this member.",
            );
            return;
        }
        Entry::Vacant(entry) => {
            entry.insert(pending.clone());
        }
    }
    super::publish_cluster_update(
        state,
        ClusterUpdate::VoiceMoveStarted {
            pending: pending.clone(),
        },
    )
    .await;

    super::publish_user_event(
        state,
        target_user_id,
        WsEvent::VoiceMemberMoveRequested {
            request_id,
            source_channel_id,
            channel_id,
            server_id: source_server_id,
            actor_id: user_id,
        },
    )
    .await;

    let timeout_state = state.clone();
    tokio::spawn(async move {
        tokio::time::sleep(VOICE_MOVE_TIMEOUT).await;
        if let Some((_, timed_out)) = timeout_state
            .pending_voice_moves
            .remove_if(&target_user_id, |_, pending| {
                pending.request_id == request_id
            })
        {
            super::publish_cluster_update(
                &timeout_state,
                ClusterUpdate::VoiceMoveFinished {
                    target_user_id,
                    request_id,
                },
            )
            .await;
            publish_voice_move_result(
                &timeout_state,
                &timed_out,
                false,
                "The voice move timed out before the member connected.",
            )
            .await;
        }
    });
}

pub(super) async fn set_voice_control(
    connection: &VoiceConnection,
    target_user_id: Option<Uuid>,
    muted: bool,
    deafened: bool,
    screen_sharing: bool,
    camera_on: bool,
    reason: Option<String>,
) {
    let (state, user_id) = (&connection.state, connection.user_id);
    let target_id = target_user_id.unwrap_or(user_id);

    // An omitted target updates personal controls; an explicit target updates server moderation.
    if target_user_id.is_some() {
        let Some(reason) = normalize_voice_moderation_reason(reason) else {
            return;
        };
        let target_channel = state.voice_sessions.get(&target_id).map(|r| *r);
        let Some(target_channel_id) = target_channel else {
            return;
        };
        let Some((target_server_id, target_channel_name)) =
            voice_channel_context(&state.db, target_channel_id).await
        else {
            return;
        };

        let Some(perms) = voice_moderator_permissions(&state.db, target_channel_id, user_id).await
        else {
            return;
        };

        let can_mute =
            perms.contains(Permissions::MUTE_MEMBERS) || perms.contains(Permissions::MANAGE_SERVER);
        let can_deafen = perms.contains(Permissions::DEAFEN_MEMBERS)
            || perms.contains(Permissions::MANAGE_SERVER);
        let changed = voice_moderation::set_for_member(
            &state.db,
            user_id,
            target_server_id,
            target_id,
            target_channel_id,
            &target_channel_name,
            reason.as_deref(),
            ServerVoiceModeration { muted, deafened },
            can_mute,
            can_deafen,
        )
        .await;
        match changed {
            Ok(Some(_)) => {}
            Ok(None) => return,
            Err(error) => {
                tracing::error!("SetVoiceControl persistence failed: {}", error);
                return;
            }
        }

        // Moderators can only change server-enforced mute/deafen.
        let current = state
            .voice_controls
            .get(&target_id)
            .map(|s| *s)
            .unwrap_or((false, false, false, false, false, false));
        let can_publish = ServerVoiceModeration { muted, deafened }.can_publish();
        let next_state = (
            current.0,
            current.1,
            muted,
            deafened,
            current.4 && can_publish,
            current.5 && can_publish,
        );
        let _ = state.voice_controls.insert(target_id, next_state);
        super::publish_event(
            state,
            voice_control_event_from_state(
                target_id,
                Some(target_server_id),
                target_channel_id,
                next_state,
            ),
        )
        .await;
        if let Err(error) = voice_revoke::update_livekit_voice_permissions(
            state,
            target_channel_id,
            target_id,
            ServerVoiceModeration { muted, deafened },
        )
        .await
        {
            tracing::warn!(
                "SetVoiceControl LiveKit permission update failed: {}",
                error
            );
            if muted || deafened {
                // Retried in the background if LiveKit is unreachable.
                voice_revoke::remove_livekit_participant(
                    state,
                    target_channel_id,
                    target_id,
                    "voice moderation permission update failed",
                )
                .await;
            }
        }
        return;
    }

    if !connection_holds_voice(connection) {
        return;
    }
    let actor_channel = state.voice_sessions.get(&user_id).map(|r| *r);
    let Some(actor_channel_id) = actor_channel else {
        return;
    };
    let actor_server_id = server_id_for_channel(&state.db, actor_channel_id).await;
    let moderation = match voice_moderation::for_channel(&state.db, user_id, actor_channel_id).await
    {
        Ok(Some(moderation)) => moderation,
        Ok(None) => return,
        Err(error) => {
            tracing::warn!("SetVoiceControl moderation lookup failed: {}", error);
            return;
        }
    };

    let current = state
        .voice_controls
        .get(&user_id)
        .map(|s| *s)
        .unwrap_or((false, false, false, false, false, false));
    // LiveKit refuses media from a server-muted member, so they
    // cannot be shown as sharing their screen or camera either.
    let screen_sharing = screen_sharing && moderation.can_publish();
    let camera_on = camera_on && moderation.can_publish();
    let next_state = (
        muted,
        deafened,
        moderation.muted,
        moderation.deafened,
        screen_sharing,
        camera_on,
    );
    let _ = state.voice_controls.insert(user_id, next_state);
    if current.4 && !screen_sharing {
        clear_screen_share_viewers_for_publisher(state, user_id, actor_channel_id, actor_server_id)
            .await;
    }
    super::publish_event(
        state,
        voice_control_event_from_state(user_id, actor_server_id, actor_channel_id, next_state),
    )
    .await;
}

pub(super) async fn set_screen_share_watching(
    connection: &VoiceConnection,
    publisher_user_id: Uuid,
    watching: bool,
) {
    let (state, user_id) = (&connection.state, connection.user_id);
    if publisher_user_id == user_id || !connection_holds_voice(connection) {
        return;
    }
    let viewer_channel = state.voice_sessions.get(&user_id).map(|entry| *entry);
    let publisher_channel = state
        .voice_sessions
        .get(&publisher_user_id)
        .map(|entry| *entry);
    let Some(channel_id) = viewer_channel else {
        state
            .screen_share_viewers
            .remove(&(user_id, publisher_user_id));
        return;
    };
    if publisher_channel != Some(channel_id) {
        state
            .screen_share_viewers
            .remove(&(user_id, publisher_user_id));
        return;
    }

    let is_publisher_sharing = state
        .voice_controls
        .get(&publisher_user_id)
        .map(|control| control.4)
        .unwrap_or(false);
    if watching && !is_publisher_sharing {
        return;
    }

    let changed = if watching {
        state
            .screen_share_viewers
            .insert((user_id, publisher_user_id), ())
            .is_none()
    } else {
        state
            .screen_share_viewers
            .remove(&(user_id, publisher_user_id))
            .is_some()
    };
    if !changed {
        return;
    }

    let server_id = server_id_for_channel(&state.db, channel_id).await;
    super::publish_event(
        state,
        screen_share_viewer_event(user_id, publisher_user_id, channel_id, server_id, watching),
    )
    .await;
}
