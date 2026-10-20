export interface User {
    id: string;
    created_at?: string;
    username: string;
    email: string;
    email_verified: boolean;
    avatar_url?: string;
    about_me?: string;
    status: 'online' | 'dnd' | 'offline' | 'invisible';
    dm_privacy?: 'everyone' | 'friends';
    google_connected?: boolean;
    has_password?: boolean;
    /** ISO date when user last changed username; used for the seven-day change limit. */
    username_changed_at?: string | null;
}

export interface Server {
    id: string;
    name: string;
    icon_url?: string;
    description?: string;
    owner_id: string;
    invite_code: string;
}

export interface ServerInvitePreview {
    id: string;
    name: string;
    icon_url?: string;
    description?: string;
    invite_code: string;
    member_count: number;
    icon_grant?: string | null;
}

export interface Channel {
    id: string;
    server_id: string;
    name: string;
    description?: string | null;
    channel_type: 'text' | 'voice';
    category?: string;
    position: number;
    my_permissions?: number;
}

export interface Attachment {
    id?: string;
    url: string;
    type?: string;
    name?: string;
    size?: number;
    sha256?: string;
}

export interface Message {
    id: string;
    channel_id: string;
    content: string;
    attachments?: Attachment[];
    reactions?: MessageReaction[];
    edited_at?: string | null;
    created_at: string;
    author: {
        user_id: string;
        username: string;
        avatar_url?: string;
        role_color?: string | null;
    };
}

export interface MessageReaction {
    emoji: string;
    count: number;
    reacted: boolean;
    users?: Array<{
        username: string;
    }>;
}

/**
 * Payloads of the server's WebSocket events (`WsEvent` in apps/server/src/ws/mod.rs).
 * `.github/scripts/check-ws-event-sync.mjs` fails CI when names or fields drift apart.
 */
export interface WsEventDataMap {
    NewMessage: { channel_id: string; channel_type: string; message: Message };
    DmRead: { channel_id: string; user_id: string; last_read_message_id: string | null };
    MessageDeleted: { channel_id: string; message_id: string };
    MessageUpdated: { channel_id: string; message: Message };
    Typing: { channel_id: string; user_id: string; username: string; is_typing: boolean };
    PresenceUpdate: { user_id: string; status: string };
    FriendUpdate: { user_id: string };
    DmChannelsUpdated: { channel_id: string };
    MemberJoined: { server_id: string; user_id: string; username: string };
    MemberLeft: { server_id: string; user_id: string; reason?: 'left' | 'kicked' | 'banned' | 'deleted' };
    MemberRoleUpdated: { server_id: string; user_id: string };
    MemberTimeoutUpdated: { server_id: string; user_id: string; timed_out_until: string | null };
    ServerRolesUpdated: { server_id: string };
    ServerChannelsUpdated: { server_id: string };
    VoiceStateUpdate: {
        channel_id: string | null;
        user_id: string;
        server_id: string | null;
        channel_active_since_ms: number | null;
        previous_channel_id?: string;
    };
    VoiceControlUpdate: {
        user_id: string;
        server_id: string | null;
        muted: boolean;
        deafened: boolean;
        server_muted: boolean;
        server_deafened: boolean;
        screen_sharing: boolean;
        camera_on: boolean;
    };
    VoiceMemberMoveRequested: {
        request_id: string;
        source_channel_id: string;
        channel_id: string;
        server_id: string;
        actor_id: string;
    };
    VoiceMemberMoveResult: {
        request_id: string;
        target_user_id: string;
        channel_id: string;
        success: boolean;
        message: string;
    };
    ScreenShareViewerUpdate: {
        viewer_id: string;
        publisher_id: string;
        channel_id: string;
        server_id: string | null;
        watching: boolean;
    };
    UserUpdated: { user: { id: string; username: string; avatar_url: string | null; status: string } };
    Pong: { sent_at_ms: number };
}

export type WsEventType = keyof WsEventDataMap;

/** A WebSocket event as received: narrowing on `type` gives the matching `data`. */
export type WsEvent = { [K in WsEventType]: { type: K; data: WsEventDataMap[K] } }[WsEventType];
