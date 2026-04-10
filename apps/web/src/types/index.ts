export interface User {
    id: string;
    username: string;
    avatar_url?: string;
    status: 'online' | 'dnd' | 'offline' | 'invisible';
    dm_privacy?: 'everyone' | 'friends';
    google_connected?: boolean;
    has_password?: boolean;
    /** ISO date when user last changed username; used for 30-day change limit. */
    username_changed_at?: string | null;
}

export interface Server {
    id: string;
    name: string;
    icon_url?: string;
    owner_id: string;
    invite_code: string;
}

export interface ServerInvitePreview {
    id: string;
    name: string;
    icon_url?: string;
    invite_code: string;
    member_count: number;
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
}

export interface SignalingMessage {
    type: 'Offer' | 'Answer' | 'IceCandidate';
    payload: {
        sdp?: string;
        candidate?: string;
        sdp_mid?: string;
        sdp_m_line_index?: number;
    };
}

export interface WsEvent {
    type: 'NewMessage' | 'MessageDeleted' | 'MessageUpdated' | 'Typing' | 'PresenceUpdate' | 'FriendUpdate' | 'MemberJoined' | 'MemberLeft' | 'MemberRoleUpdated' | 'ServerRolesUpdated' | 'ServerChannelsUpdated' | 'VoiceStateUpdate' | 'VoiceControlUpdate' | 'Signal' | 'Pong';
    data: unknown;
}
