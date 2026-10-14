import { apiFetch } from './client'
import type { AuthToken, ServerRule } from './contracts'

// Separate from `serverApi` so it stays out of the startup bundle; only the invite page uses it.
/** Rules shown on an invite page before joining; the invite code grants access. */
export const listInviteRules = (inviteCode: string, token?: AuthToken) =>
    apiFetch<ServerRule[]>(`/api/servers/invite/${encodeURIComponent(inviteCode)}/rules`, { token })
