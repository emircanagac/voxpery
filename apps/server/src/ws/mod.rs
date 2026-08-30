pub mod access;
pub mod bus;
pub mod handler;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::MessageWithAuthor;

pub use bus::{publish_event, publish_user_event};

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
    /// A DM channel was read by one session for the current user.
    DmRead {
        channel_id: Uuid,
        user_id: Uuid,
        last_read_message_id: Option<Uuid>,
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
    /// Server channels/categories/overrides changed; clients should refresh visible channel tree.
    ServerChannelsUpdated { server_id: Uuid },
    /// Voice channel state update.
    VoiceStateUpdate {
        channel_id: Option<Uuid>, // None if left voice
        user_id: Uuid,
        server_id: Option<Uuid>, // server that owns the channel; None if left voice
        channel_active_since_ms: Option<u64>, // Same for every client while the voice channel remains non-empty
    },
    /// Voice control state update (mute/deafen).
    VoiceControlUpdate {
        user_id: Uuid,
        server_id: Option<Uuid>,
        muted: bool,
        deafened: bool,
        server_muted: bool,
        server_deafened: bool,
        screen_sharing: bool,
        camera_on: bool,
    },
    /// A moderator requested that the current user join another voice channel.
    VoiceMemberMoveRequested {
        source_channel_id: Uuid,
        channel_id: Uuid,
        server_id: Uuid,
        actor_id: Uuid,
    },
    /// A voice participant started or stopped watching another participant's active screen share.
    ScreenShareViewerUpdate {
        viewer_id: Uuid,
        publisher_id: Uuid,
        channel_id: Uuid,
        server_id: Option<Uuid>,
        watching: bool,
    },
    /// User profile details updated (safe public subset only).
    UserUpdated {
        user: crate::models::UserBroadcastProfile,
    },
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

#[cfg(test)]
mod tests {
    use super::{WsClientMessage, WsEvent};
    use uuid::Uuid;

    #[test]
    fn serializes_screen_share_viewer_updates() {
        let viewer_id = Uuid::new_v4();
        let publisher_id = Uuid::new_v4();
        let channel_id = Uuid::new_v4();
        let server_id = Uuid::new_v4();
        let event = WsEvent::ScreenShareViewerUpdate {
            viewer_id,
            publisher_id,
            channel_id,
            server_id: Some(server_id),
            watching: true,
        };

        let json = serde_json::to_value(event).expect("viewer update serializes");
        assert_eq!(json["type"], "ScreenShareViewerUpdate");
        assert_eq!(json["data"]["viewer_id"], viewer_id.to_string());
        assert_eq!(json["data"]["publisher_id"], publisher_id.to_string());
        assert_eq!(json["data"]["channel_id"], channel_id.to_string());
        assert_eq!(json["data"]["server_id"], server_id.to_string());
        assert_eq!(json["data"]["watching"], true);
    }

    #[test]
    fn parses_screen_share_viewer_subscription_request() {
        let publisher_id = Uuid::new_v4();
        let payload = format!(
            r#"{{"type":"SetScreenShareWatching","data":{{"publisher_user_id":"{publisher_id}","watching":true}}}}"#,
        );

        let message = serde_json::from_str::<WsClientMessage>(&payload)
            .expect("viewer subscription request parses");
        assert!(matches!(
            message,
            WsClientMessage::SetScreenShareWatching {
                publisher_user_id,
                watching: true,
            } if publisher_user_id == publisher_id
        ));
    }

    #[test]
    fn parses_voice_member_move_request_with_reason() {
        let target_user_id = Uuid::new_v4();
        let channel_id = Uuid::new_v4();
        let payload = format!(
            r#"{{"type":"MoveVoiceMember","data":{{"target_user_id":"{target_user_id}","channel_id":"{channel_id}","reason":"Requested support"}}}}"#,
        );

        let message = serde_json::from_str::<WsClientMessage>(&payload)
            .expect("voice member move request parses");
        assert!(matches!(
            message,
            WsClientMessage::MoveVoiceMember {
                target_user_id: parsed_target,
                channel_id: parsed_channel,
                reason: Some(reason),
            } if parsed_target == target_user_id
                && parsed_channel == channel_id
                && reason == "Requested support"
        ));
    }

    #[test]
    fn serializes_targeted_voice_member_move_event() {
        let source_channel_id = Uuid::new_v4();
        let channel_id = Uuid::new_v4();
        let server_id = Uuid::new_v4();
        let actor_id = Uuid::new_v4();
        let event = WsEvent::VoiceMemberMoveRequested {
            source_channel_id,
            channel_id,
            server_id,
            actor_id,
        };

        let json = serde_json::to_value(event).expect("voice member move event serializes");
        assert_eq!(json["type"], "VoiceMemberMoveRequested");
        assert_eq!(
            json["data"]["source_channel_id"],
            source_channel_id.to_string()
        );
        assert_eq!(json["data"]["channel_id"], channel_id.to_string());
        assert_eq!(json["data"]["server_id"], server_id.to_string());
        assert_eq!(json["data"]["actor_id"], actor_id.to_string());
    }
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
    JoinVoice {
        channel_id: Uuid,
        #[serde(default)]
        participant_sid: Option<String>,
    },
    /// Leave voice channel.
    LeaveVoice,
    /// Disconnect another member from voice (server moderation).
    DisconnectVoiceMember {
        target_user_id: Uuid,
        #[serde(default)]
        reason: Option<String>,
    },
    /// Move another member to a voice channel in the same server.
    MoveVoiceMember {
        target_user_id: Uuid,
        channel_id: Uuid,
        #[serde(default)]
        reason: Option<String>,
    },
    /// Update voice controls.
    SetVoiceControl {
        #[serde(default)]
        target_user_id: Option<Uuid>,
        muted: bool,
        deafened: bool,
        screen_sharing: bool,
        camera_on: bool,
        #[serde(default)]
        reason: Option<String>,
    },
    /// Opt in or out of receiving an active participant's screen share.
    SetScreenShareWatching {
        publisher_user_id: Uuid,
        watching: bool,
    },
    /// WebRTC signaling message.
    Signal {
        target_user_id: Uuid,
        signal: SignalingMessage,
    },
    /// Ping request for latency measurement.
    Ping { sent_at_ms: u64 },
}
