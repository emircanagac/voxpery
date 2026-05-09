import type { User, Server, ServerInvitePreview, Channel, Message, SignalingMessage, WsEvent } from '../types'

export type { User, Server, ServerInvitePreview, Channel, Message, SignalingMessage, WsEvent }

export interface AuditLogEntry {
    id: string
    at: string
    actor_id: string
    server_id: string | null
    action: string
    resource_type: string
    resource_id: string | null
    details: unknown | null
    actor_username: string | null
    resource_username: string | null
}

// Re-export User as UserPublic for compat
export type UserPublic = User

export type AuthToken = string | null

export interface AuthResponse {
    token: string
    user: UserPublic
}

export interface DataExportPayload {
    exported_at: string
    account: {
        id: string
        username: string
        email: string
        avatar_url: string | null
        status: string
        dm_privacy: 'everyone' | 'friends'
        created_at: string
        google_connected: boolean
    }
    memberships: unknown[]
    friends: unknown[]
    friend_requests: unknown[]
    server_messages: unknown[]
    dm_messages: unknown[]
}

export interface DeleteAccountPayload {
    confirm: string
    password?: string
}

export interface LatestReleaseDownloads {
    windows?: string
    macos?: string
    linux?: string
}

export interface LatestReleaseResponse {
    tag?: string | null
    html_url: string
    published_at?: string | null
    downloads: LatestReleaseDownloads
}

export interface EmailVerificationConfirmResponse {
    message: string
}

export interface SystemFeatures {
    google_oauth_enabled: boolean
    email_delivery_enabled: boolean
    email_verification_enabled: boolean
    email_verification_required: boolean
    password_reset_enabled: boolean
}

export interface ServerDetail extends Server {
    my_permissions: number
    members: MemberInfo[]
}

export interface MemberInfo {
    user_id: string
    username: string
    avatar_url: string | null
    role: string
    status: string
    role_color: string | null
    roles?: string[]
}

export interface Friend {
    id: string
    username: string
    avatar_url: string | null
    status: string
}

export interface FriendRequest {
    id: string
    requester_id: string
    receiver_id: string
    requester_username: string
    receiver_username: string
    status: string
    created_at: string
}

export interface FriendRequestsResponse {
    incoming: FriendRequest[]
    outgoing: FriendRequest[]
}

export interface DmChannel {
    id: string
    peer_id: string
    peer_username: string
    peer_avatar_url: string | null
    peer_status: string
    last_message_at: string | null
}

export interface DmReadState {
    peer_last_read_message_id: string | null
}

export interface ServerRole {
    id: string
    name: string
    color: string | null
    position: number
    permissions: number
}

export interface ChannelOverride {
    role_id: string
    allow: number
    deny: number
}

export interface ServerBanEntry {
    user_id: string
    banned_by: string
    reason: string | null
    created_at: string
    username: string
    banned_by_username: string
}

export interface ServerReportEntry {
    id: string
    server_id: string
    reporter_user_id: string
    reporter_username: string
    reported_user_id: string
    reported_username: string
    channel_id: string | null
    channel_name: string | null
    message_id: string | null
    message_excerpt: string | null
    reason: string
    details: string | null
    status: 'open' | 'resolved'
    created_at: string
    resolved_at: string | null
    resolved_by: string | null
    resolved_by_username: string | null
}

export interface UploadedAttachment {
    id: string
    url: string
    type?: string
    name?: string
    size?: number
    sha256?: string
}

export interface ChannelCategory {
    name: string
}

export type MessageWithAuthor = Message

export interface TurnCredentials {
    urls: string[]
    username?: string
    credential?: string
}

export interface LivekitTokenResponse {
    ws_url: string
    token: string
    room: string
    identity: string
}
