export interface User {
    id: string;
    username: string;
    avatar_url?: string;
    status: 'online' | 'dnd' | 'offline';
    dm_privacy?: 'everyone' | 'friends';
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

export interface Channel {
    id: string;
    server_id: string;
    name: string;
    channel_type: 'text' | 'voice';
    category?: string;
    position: number;
}

export interface Attachment {
    url: string;
    type?: string;
    name?: string;
}

export interface Message {
    id: string;
    channel_id: string;
    content: string;
    attachments?: Attachment[];
    edited_at?: string | null;
    created_at: string;
    author: {
        user_id: string;
        username: string;
        avatar_url?: string;
    };
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
    type: 'NewMessage' | 'MessageDeleted' | 'MessageUpdated' | 'Typing' | 'PresenceUpdate' | 'FriendUpdate' | 'MemberJoined' | 'MemberLeft' | 'MemberRoleUpdated' | 'ServerRolesUpdated' | 'VoiceStateUpdate' | 'VoiceControlUpdate' | 'Signal' | 'Pong';
    data: unknown;
}
