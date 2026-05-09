import { apiFetch } from './client'
import type { AuthToken, Friend, FriendRequestsResponse } from './contracts'

export const friendApi = {
    list: (token: AuthToken) =>
        apiFetch<Friend[]>('/api/friends', { token }),

    requests: (token: AuthToken) =>
        apiFetch<FriendRequestsResponse>('/api/friends/requests', { token }),

    sendRequest: (username: string, token: AuthToken) =>
        apiFetch<void>('/api/friends/requests', {
            method: 'POST',
            body: { username },
            token,
        }),

    acceptRequest: (requestId: string, token: AuthToken) =>
        apiFetch<void>(`/api/friends/requests/${requestId}/accept`, {
            method: 'POST',
            token,
        }),

    rejectRequest: (requestId: string, token: AuthToken) =>
        apiFetch<void>(`/api/friends/requests/${requestId}/reject`, {
            method: 'POST',
            token,
        }),

    remove: (friendId: string, token: AuthToken) =>
        apiFetch<void>(`/api/friends/${friendId}`, {
            method: 'DELETE',
            token,
        }),
}
