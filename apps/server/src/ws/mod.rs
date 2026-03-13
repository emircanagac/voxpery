pub mod access;
pub mod handler;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::MessageWithAuthor;

/// Events sent over WebSocket connections.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum WsEvent {
    /// A new message was sent in a channel.
    NewMessage {
        channel_id: Uuid,
        channel_type: String,
        message: MessageWithAuthor,
    },
    /// A message was deleted in a server channel.
    MessageDeleted { channel_id: Uuid, message_id: Uuid },
    /// A message was updated (edited) in a server channel.
    MessageUpdated {
        channel_id: Uuid,
        message: MessageWithAuthor,
    },
    /// A user started/stopped typing.
    Typing {
        channel_id: Uuid,
        user_id: Uuid,
        username: String,
        is_typing: bool,
    },
    /// User presence update.
    PresenceUpdate { user_id: Uuid, status: String },
    /// Friend list/request state changed for a user.
    FriendUpdate { user_id: Uuid },
    /// User joined a server.
    MemberJoined {
        server_id: Uuid,
        user_id: Uuid,
        username: String,
    },
    /// User left a server.
    MemberLeft { server_id: Uuid, user_id: Uuid },
    /// Member role was updated.
    MemberRoleUpdated {
        server_id: Uuid,
        user_id: Uuid,
        role: String,
    },
    /// Server roles (name/color/permissions/order) changed; clients should refresh derived UI.
    ServerRolesUpdated { server_id: Uuid },
    /// Voice channel state update.
    VoiceStateUpdate {
        channel_id: Option<Uuid>, // None if left voice
        user_id: Uuid,
        server_id: Option<Uuid>, // server that owns the channel; None if left voice
    },
    /// Voice control state update (mute/deafen).
    VoiceControlUpdate {
        user_id: Uuid,
        muted: bool,
        deafened: bool,
        screen_sharing: bool,
        camera_on: bool,
    },
    /// User profile details updated (e.g. avatar, username).
    UserUpdated { user: crate::models::UserPublic },
    /// WebRTC signaling message (Offer, Answer, ICE Candidate).
    Signal {
        sender_id: Uuid,
        signal: SignalingMessage,
    },
    /// Pong response for latency measurement.
    Pong { sent_at_ms: u64 },
}

/// WebRTC signaling data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum SignalingMessage {
    Offer {
        sdp: String,
    },
    Answer {
        sdp: String,
    },
    IceCandidate {
        candidate: String,
        sdp_mid: Option<String>,
        sdp_m_line_index: Option<u16>,
    },
}

/// Client-to-server WebSocket messages.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum WsClientMessage {
    /// Subscribe to events for specific channels.
    Subscribe { channel_ids: Vec<Uuid> },
    /// Unsubscribe from channels.
    Unsubscribe { channel_ids: Vec<Uuid> },
    /// Typing indicator.
    Typing { channel_id: Uuid, is_typing: bool },
    /// Join a voice channel.
    JoinVoice { channel_id: Uuid },
    /// Leave voice channel.
    LeaveVoice,
    /// Update voice controls.
    SetVoiceControl {
        muted: bool,
        deafened: bool,
        screen_sharing: bool,
        camera_on: bool,
    },
    /// WebRTC signaling message.
    Signal {
        target_user_id: Uuid,
        signal: SignalingMessage,
    },
    /// Ping request for latency measurement.
    Ping { sent_at_ms: u64 },
}
