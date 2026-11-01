import { apiFetch } from './client'
import type { AuthToken } from './contracts'

export interface UserNote {
    note: string | null
    updated_at: string | null
}

export const userNoteApi = {
    get: (userId: string, token: AuthToken) =>
        apiFetch<UserNote>(`/api/users/${encodeURIComponent(userId)}/note`, { token }),

    save: (userId: string, note: string, token: AuthToken) =>
        apiFetch<UserNote>(`/api/users/${encodeURIComponent(userId)}/note`, {
            method: 'PUT',
            body: { note },
            token,
        }),
}
