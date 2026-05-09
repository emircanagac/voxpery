import { apiFetch } from './client'
import type { LivekitTokenResponse, TurnCredentials } from './contracts'

export const webrtcApi = {
    /** GET /api/webrtc/turn-credentials (auth via cookie or Bearer). */
    getTurnCredentials: (token: string | null) =>
        apiFetch<TurnCredentials>('/api/webrtc/turn-credentials', { token: token ?? undefined }),
    /** GET /api/webrtc/livekit-token?channel_id=... (auth via cookie or Bearer). */
    getLivekitToken: (channelId: string, token: string | null) =>
        apiFetch<LivekitTokenResponse>(`/api/webrtc/livekit-token?channel_id=${encodeURIComponent(channelId)}`, { token: token ?? undefined }),
}
