import { apiFetch } from './client'
import type { LivekitTokenResponse, TurnCredentials } from './contracts'

/** Voice setup requests fail fast so a stuck join is retried instead of waiting 30 seconds. */
const VOICE_REQUEST_TIMEOUT_MS = 10_000

export const webrtcApi = {
    /** GET /api/webrtc/turn-credentials (auth via cookie or Bearer). */
    getTurnCredentials: (token: string | null) =>
        apiFetch<TurnCredentials>('/api/webrtc/turn-credentials', { token: token ?? undefined, timeoutMs: VOICE_REQUEST_TIMEOUT_MS }),
    /** GET /api/webrtc/livekit-token?channel_id=... (auth via cookie or Bearer). */
    getLivekitToken: (channelId: string, token: string | null) =>
        apiFetch<LivekitTokenResponse>(`/api/webrtc/livekit-token?channel_id=${encodeURIComponent(channelId)}`, { token: token ?? undefined, timeoutMs: VOICE_REQUEST_TIMEOUT_MS }),
}
