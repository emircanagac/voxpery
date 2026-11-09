//! What other backend instances hold, so every instance can answer for the whole deployment and
//! `/ws` needs no sticky routing.
//!
//! Sockets stay on the instance that owns them. Changes reach the other instances as events on
//! the Redis bus and are applied to the same maps local sessions use. Every instance also writes
//! a short-lived snapshot: it brings a new instance up to date, repairs events lost while Pub/Sub
//! reconnected, and shows when an instance has died. With one instance none of this does anything
//! beyond writing that snapshot.

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use dashmap::DashMap;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{BroadcastEvent, WsEvent};
use crate::{AppState, PendingVoiceMove};

const INSTANCES_KEY: &str = "voxpery:cluster:instances";
const SNAPSHOT_KEY_PREFIX: &str = "voxpery:cluster:instance:";
const SYNC_INTERVAL: Duration = Duration::from_secs(10);
/// An instance that wrote no snapshot for this long is gone.
const INSTANCE_EXPIRY: Duration = Duration::from_secs(35);

type VoiceControls = (bool, bool, bool, bool, bool, bool);

/// State changes that have no client event of their own.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "update", rename_all = "snake_case")]
pub enum ClusterUpdate {
    ParticipantSid {
        user_id: Uuid,
        participant_sid: String,
    },
    VoiceMoveStarted {
        pending: PendingVoiceMove,
    },
    VoiceMoveFinished {
        target_user_id: Uuid,
        request_id: Uuid,
    },
    /// The user's last connection on this instance closed while another instance has one.
    ConnectionsClosed {
        user_id: Uuid,
    },
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct VoiceEntry {
    user_id: Uuid,
    channel_id: Uuid,
    channel_active_since_ms: Option<u64>,
    controls: Option<VoiceControls>,
    participant_sid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct InstanceSnapshot {
    online: Vec<Uuid>,
    voice: Vec<VoiceEntry>,
    /// `(viewer, publisher)` pairs for the viewers whose voice session this instance holds.
    /// `None` in snapshots from instances that predate it; their viewers are left as they are.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    screen_share_viewers: Option<Vec<(Uuid, Uuid)>>,
}

struct Peer {
    online: HashSet<Uuid>,
    voice: HashSet<Uuid>,
    /// Voice sessions missing from the last snapshot. A session is dropped only when two
    /// snapshots in a row miss it, because one may have been written just before its join.
    absent_voice: HashSet<Uuid>,
    /// Screen-share viewers missing from the last snapshot, dropped on the second miss for the
    /// same reason.
    absent_viewers: HashSet<(Uuid, Uuid)>,
    /// An instance's events can arrive before its first snapshot; only an instance that has
    /// reported, or never did for too long, counts as gone when no snapshot is there.
    reported: bool,
    first_seen: Instant,
}

impl Default for Peer {
    fn default() -> Self {
        Self {
            online: HashSet::new(),
            voice: HashSet::new(),
            absent_voice: HashSet::new(),
            absent_viewers: HashSet::new(),
            reported: false,
            first_seen: Instant::now(),
        }
    }
}

/// The other instances of this deployment, by instance id.
#[derive(Default)]
pub struct Peers(DashMap<Uuid, Peer>);

impl Peers {
    pub fn is_online(&self, user_id: Uuid) -> bool {
        self.0.iter().any(|peer| peer.online.contains(&user_id))
    }

    pub fn holds_voice(&self, user_id: Uuid) -> bool {
        self.0.iter().any(|peer| peer.voice.contains(&user_id))
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn snapshot_key(instance_id: Uuid) -> String {
    format!("{SNAPSHOT_KEY_PREFIX}{instance_id}")
}

fn forget_voice_session(state: &AppState, user_id: Uuid) -> Option<Uuid> {
    let (_, channel_id) = state.voice_sessions.remove(&user_id)?;
    state.voice_session_connections.remove(&user_id);
    state.voice_participant_sids.remove(&user_id);
    state.voice_controls.remove(&user_id);
    state
        .screen_share_viewers
        .retain(|(viewer_id, publisher_id), _| *viewer_id != user_id && *publisher_id != user_id);
    let channel_in_use = state
        .voice_sessions
        .iter()
        .any(|entry| *entry.value() == channel_id);
    if !channel_in_use {
        state.voice_channel_active_since_ms.remove(&channel_id);
    }
    Some(channel_id)
}

/// Applies a broadcast event another instance published, before local clients get it.
pub fn apply_peer_event(state: &AppState, origin: Uuid, event: &WsEvent) {
    let mut peer = state.peers.0.entry(origin).or_default();
    match event {
        WsEvent::PresenceUpdate { user_id, status } => {
            if status == "offline" {
                peer.online.remove(user_id);
            } else {
                peer.online.insert(*user_id);
            }
        }
        WsEvent::VoiceStateUpdate {
            channel_id: Some(channel_id),
            user_id,
            channel_active_since_ms,
            ..
        } => {
            peer.voice.insert(*user_id);
            peer.absent_voice.remove(user_id);
            state.voice_sessions.insert(*user_id, *channel_id);
            if let Some(since) = channel_active_since_ms {
                state
                    .voice_channel_active_since_ms
                    .entry(*channel_id)
                    .or_insert(*since);
            }
            // The account joined from another instance: the session moved away from here.
            if let Some((_, (_, holder))) = state.voice_session_connections.remove(user_id) {
                let _ = holder.try_send(WsEvent::VoiceSessionMoved {
                    channel_id: *channel_id,
                });
            }
        }
        WsEvent::VoiceStateUpdate {
            channel_id: None,
            user_id,
            ..
        } => {
            let origin_held_it = peer.voice.remove(user_id);
            // The old socket of a client that already rejoined here reports a departure that no
            // longer applies. Removal by another instance, such as moderation, does apply.
            if origin_held_it && state.voice_session_connections.contains_key(user_id) {
                return;
            }
            drop(peer);
            forget_voice_session(state, *user_id);
        }
        WsEvent::VoiceControlUpdate {
            user_id,
            muted,
            deafened,
            server_muted,
            server_deafened,
            screen_sharing,
            camera_on,
            ..
        } if state.voice_sessions.contains_key(user_id) => {
            state.voice_controls.insert(
                *user_id,
                (
                    *muted,
                    *deafened,
                    *server_muted,
                    *server_deafened,
                    *screen_sharing,
                    *camera_on,
                ),
            );
        }
        WsEvent::ScreenShareViewerUpdate {
            viewer_id,
            publisher_id,
            watching,
            ..
        } => {
            if *watching {
                state
                    .screen_share_viewers
                    .insert((*viewer_id, *publisher_id), ());
            } else {
                state
                    .screen_share_viewers
                    .remove(&(*viewer_id, *publisher_id));
            }
        }
        _ => {}
    }
}

pub fn apply_update(state: &AppState, origin: Uuid, update: ClusterUpdate) {
    match update {
        ClusterUpdate::ConnectionsClosed { user_id } => {
            if let Some(mut peer) = state.peers.0.get_mut(&origin) {
                peer.online.remove(&user_id);
            }
            // Instances can lose the user's last connections at the same moment, each waiting
            // for the other, so each tells its own clients once nothing is left anywhere.
            if !state.is_online(user_id) {
                notify_local_clients(
                    state,
                    WsEvent::PresenceUpdate {
                        user_id,
                        status: "offline".to_string(),
                    },
                );
            }
        }
        ClusterUpdate::ParticipantSid {
            user_id,
            participant_sid,
        } => {
            state
                .voice_participant_sids
                .insert(user_id, participant_sid);
        }
        ClusterUpdate::VoiceMoveStarted { pending } => {
            state
                .pending_voice_moves
                .insert(pending.target_user_id, pending);
        }
        ClusterUpdate::VoiceMoveFinished {
            target_user_id,
            request_id,
        } => {
            state
                .pending_voice_moves
                .remove_if(&target_user_id, |_, pending| {
                    pending.request_id == request_id
                });
        }
    }
}

fn local_snapshot(state: &AppState) -> InstanceSnapshot {
    let voice = state
        .voice_session_connections
        .iter()
        .filter_map(|holder| {
            let user_id = *holder.key();
            let channel_id = *state.voice_sessions.get(&user_id)?;
            Some(VoiceEntry {
                user_id,
                channel_id,
                channel_active_since_ms: state
                    .voice_channel_active_since_ms
                    .get(&channel_id)
                    .map(|since| *since),
                controls: state.voice_controls.get(&user_id).map(|entry| *entry),
                participant_sid: state
                    .voice_participant_sids
                    .get(&user_id)
                    .map(|entry| entry.clone()),
            })
        })
        .collect();
    let screen_share_viewers: Vec<(Uuid, Uuid)> = state
        .screen_share_viewers
        .iter()
        .map(|entry| *entry.key())
        .filter(|(viewer_id, _)| state.voice_session_connections.contains_key(viewer_id))
        .collect();
    InstanceSnapshot {
        online: state.sessions.iter().map(|entry| *entry.key()).collect(),
        voice,
        screen_share_viewers: Some(screen_share_viewers),
    }
}

/// Tells this instance's clients something they missed; other instances do the same for theirs.
fn notify_local_clients(state: &AppState, event: WsEvent) {
    let _ = state.tx.send(BroadcastEvent::new(event));
}

async fn server_of_channel(state: &AppState, channel_id: Uuid) -> Option<Uuid> {
    sqlx::query_scalar::<_, Uuid>("SELECT server_id FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
}

async fn announce_departure(state: &AppState, user_id: Uuid, channel_id: Uuid) {
    let server_id = server_of_channel(state, channel_id).await;
    notify_local_clients(
        state,
        WsEvent::VoiceStateUpdate {
            channel_id: None,
            user_id,
            server_id,
            channel_active_since_ms: None,
            previous_channel_id: Some(channel_id),
        },
    );
}

async fn reconcile_peer(state: &AppState, peer_id: Uuid, snapshot: InstanceSnapshot) {
    let reported: HashSet<Uuid> = snapshot.voice.iter().map(|entry| entry.user_id).collect();
    let (gone, known) = {
        let mut peer = state.peers.0.entry(peer_id).or_default();
        peer.reported = true;
        peer.online = snapshot.online.into_iter().collect();
        let missing: HashSet<Uuid> = peer.voice.difference(&reported).copied().collect();
        let gone: Vec<Uuid> = missing.intersection(&peer.absent_voice).copied().collect();
        peer.absent_voice = missing;
        for user_id in &gone {
            peer.voice.remove(user_id);
            peer.absent_voice.remove(user_id);
        }
        (gone, std::mem::take(&mut peer.voice))
    };

    for user_id in gone {
        if state.voice_session_connections.contains_key(&user_id) {
            continue;
        }
        if let Some(channel_id) = forget_voice_session(state, user_id) {
            announce_departure(state, user_id, channel_id).await;
        }
    }

    let mut held = known;
    for entry in snapshot.voice {
        if state.voice_session_connections.contains_key(&entry.user_id) {
            continue;
        }
        held.insert(entry.user_id);
        let previous = state.voice_sessions.insert(entry.user_id, entry.channel_id);
        if let Some(since) = entry.channel_active_since_ms {
            state
                .voice_channel_active_since_ms
                .entry(entry.channel_id)
                .or_insert(since);
        }
        if let Some(controls) = entry.controls {
            state.voice_controls.insert(entry.user_id, controls);
        }
        if let Some(sid) = entry.participant_sid {
            state.voice_participant_sids.insert(entry.user_id, sid);
        }
        if previous != Some(entry.channel_id) {
            let server_id = server_of_channel(state, entry.channel_id).await;
            notify_local_clients(
                state,
                WsEvent::VoiceStateUpdate {
                    channel_id: Some(entry.channel_id),
                    user_id: entry.user_id,
                    server_id,
                    channel_active_since_ms: entry.channel_active_since_ms,
                    previous_channel_id: previous,
                },
            );
        }
    }
    if let Some(mut peer) = state.peers.0.get_mut(&peer_id) {
        peer.voice.extend(held);
    }

    // Who watches whose screen share follows the instance holding the viewer's session, so an
    // instance that started or reconnected after a viewer began watching still counts them.
    let Some(snapshot_viewers) = snapshot.screen_share_viewers else {
        return;
    };
    let remote_viewers: HashSet<Uuid> = reported
        .into_iter()
        .filter(|user_id| !state.voice_session_connections.contains_key(user_id))
        .collect();
    let wanted: HashSet<(Uuid, Uuid)> = snapshot_viewers
        .into_iter()
        .filter(|(viewer_id, _)| remote_viewers.contains(viewer_id))
        .collect();
    let missing: HashSet<(Uuid, Uuid)> = state
        .screen_share_viewers
        .iter()
        .map(|entry| *entry.key())
        .filter(|pair| remote_viewers.contains(&pair.0) && !wanted.contains(pair))
        .collect();
    let stale: Vec<(Uuid, Uuid)> = {
        let mut peer = state.peers.0.entry(peer_id).or_default();
        let stale = missing
            .intersection(&peer.absent_viewers)
            .copied()
            .collect();
        peer.absent_viewers = missing;
        stale
    };
    for pair in stale {
        if state.screen_share_viewers.remove(&pair).is_some() {
            announce_viewer(state, pair, false).await;
        }
    }
    for pair in wanted {
        if state.screen_share_viewers.insert(pair, ()).is_none() {
            announce_viewer(state, pair, true).await;
        }
    }
}

async fn announce_viewer(
    state: &AppState,
    (viewer_id, publisher_id): (Uuid, Uuid),
    watching: bool,
) {
    let Some(channel_id) = state.voice_sessions.get(&viewer_id).map(|entry| *entry) else {
        return;
    };
    let server_id = server_of_channel(state, channel_id).await;
    notify_local_clients(
        state,
        super::voice_commands::screen_share_viewer_event(
            viewer_id,
            publisher_id,
            channel_id,
            server_id,
            watching,
        ),
    );
}

async fn forget_peer(state: &AppState, peer_id: Uuid) {
    let Some((_, peer)) = state.peers.0.remove(&peer_id) else {
        return;
    };
    tracing::warn!("Backend instance {peer_id} stopped reporting; clearing its sessions");
    for user_id in peer.voice {
        if state.voice_session_connections.contains_key(&user_id)
            || state.peers.holds_voice(user_id)
        {
            continue;
        }
        if let Some(channel_id) = forget_voice_session(state, user_id) {
            announce_departure(state, user_id, channel_id).await;
        }
    }
    for user_id in peer.online {
        if !state.is_online(user_id) {
            notify_local_clients(
                state,
                WsEvent::PresenceUpdate {
                    user_id,
                    status: "offline".to_string(),
                },
            );
        }
    }
}

/// Writes this instance's snapshot and reads the others'.
pub async fn sync_peers(state: &AppState) -> Result<(), redis::RedisError> {
    let payload = match serde_json::to_string(&local_snapshot(state)) {
        Ok(payload) => payload,
        Err(error) => {
            tracing::warn!("Failed to serialize the instance snapshot: {error}");
            return Ok(());
        }
    };
    let now = now_ms();
    let oldest_alive = now.saturating_sub(INSTANCE_EXPIRY.as_millis() as u64);
    let mut connection = state.redis.connection().await?;
    let _: () = connection
        .set_ex(
            snapshot_key(state.instance_id),
            payload,
            INSTANCE_EXPIRY.as_secs(),
        )
        .await?;
    let _: () = connection
        .zadd(INSTANCES_KEY, state.instance_id.to_string(), now)
        .await?;
    let _: () = connection
        .zrembyscore(INSTANCES_KEY, 0, oldest_alive.saturating_sub(1))
        .await?;
    let instances: Vec<String> = connection.zrange(INSTANCES_KEY, 0, -1).await?;

    let mut alive = HashMap::new();
    for instance in instances {
        let Ok(instance_id) = Uuid::parse_str(&instance) else {
            continue;
        };
        if instance_id == state.instance_id {
            continue;
        }
        let snapshot: Option<String> = connection.get(snapshot_key(instance_id)).await?;
        let snapshot = snapshot.and_then(|raw| serde_json::from_str(&raw).ok());
        if let Some(snapshot) = snapshot {
            alive.insert(instance_id, snapshot);
        }
    }

    let gone: Vec<Uuid> = state
        .peers
        .0
        .iter()
        .filter(|peer| !alive.contains_key(peer.key()))
        .filter(|peer| peer.reported || peer.first_seen.elapsed() > INSTANCE_EXPIRY)
        .map(|peer| *peer.key())
        .collect();
    for peer_id in gone {
        forget_peer(state, peer_id).await;
    }
    for (peer_id, snapshot) in alive {
        reconcile_peer(state, peer_id, snapshot).await;
    }
    Ok(())
}

pub fn spawn_peer_sync(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(SYNC_INTERVAL);
        loop {
            interval.tick().await;
            if let Err(error) = sync_peers(&state).await {
                tracing::warn!("Syncing with other backend instances failed: {error}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_survive_the_trip_through_redis() {
        let snapshot = InstanceSnapshot {
            online: vec![Uuid::new_v4()],
            voice: vec![VoiceEntry {
                user_id: Uuid::new_v4(),
                channel_id: Uuid::new_v4(),
                channel_active_since_ms: Some(1),
                controls: Some((true, false, false, false, true, false)),
                participant_sid: Some("PA_1".into()),
            }],
            screen_share_viewers: Some(vec![(Uuid::new_v4(), Uuid::new_v4())]),
        };
        let text = serde_json::to_string(&snapshot).unwrap();
        assert_eq!(
            serde_json::from_str::<InstanceSnapshot>(&text).unwrap(),
            snapshot
        );
    }

    #[test]
    fn snapshots_from_instances_without_viewers_still_parse() {
        let text = r#"{"online":[],"voice":[]}"#;
        let snapshot = serde_json::from_str::<InstanceSnapshot>(text).unwrap();
        assert_eq!(snapshot.screen_share_viewers, None);
    }

    #[test]
    fn an_empty_peer_list_reports_nobody() {
        let peers = Peers::default();
        assert!(!peers.is_online(Uuid::new_v4()));
        assert!(!peers.holds_voice(Uuid::new_v4()));
    }
}
