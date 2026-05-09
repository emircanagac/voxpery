import { isTauri } from '../secureStorage'
import { apiFetch, effectiveApiBase } from './client'
import type { AuthResponse, DataExportPayload, DeleteAccountPayload, EmailVerificationConfirmResponse, UserPublic } from './contracts'

const DESKTOP_OAUTH_VERIFIER_KEY = 'voxpery.desktop.oauth.code_verifier'

interface GoogleAuthUrlOptions {
    origin?: string
    codeChallenge?: string
}

function base64UrlEncode(bytes: Uint8Array): string {
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomPkceVerifier(length: number = 64): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    let out = ''
    for (const b of bytes) {
        out += alphabet[b % alphabet.length]
    }
    return out
}

async function createDesktopPkcePair(): Promise<{ verifier: string; challenge: string }> {
    const verifier = randomPkceVerifier()
    const data = new TextEncoder().encode(verifier)
    const digest = await crypto.subtle.digest('SHA-256', data)
    const challenge = base64UrlEncode(new Uint8Array(digest))
    return { verifier, challenge }
}

export function getStoredDesktopOAuthVerifier(): string | null {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(DESKTOP_OAUTH_VERIFIER_KEY)
}

export function clearStoredDesktopOAuthVerifier(): void {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(DESKTOP_OAUTH_VERIFIER_KEY)
}

export async function getDesktopGoogleAuthUrl(redirectPath: string = '/'): Promise<string> {
    const { verifier, challenge } = await createDesktopPkcePair()
    if (typeof window !== 'undefined') {
        window.localStorage.setItem(DESKTOP_OAUTH_VERIFIER_KEY, verifier)
    }
    return getGoogleAuthUrl(redirectPath, {
        origin: 'voxpery://auth',
        codeChallenge: challenge,
    })
}

/** URL to start Google OAuth. Redirects to Google then back to callback; frontend should use window.location or <a href>. */
export function getGoogleAuthUrl(redirectPath: string = '/', options?: GoogleAuthUrlOptions): string {
    const origin = options?.origin ?? (isTauri() ? 'voxpery://auth' : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'))
    const params = new URLSearchParams({
        redirect: redirectPath,
        origin,
    })
    if (options?.codeChallenge) {
        params.set('code_challenge', options.codeChallenge)
    }
    return `${effectiveApiBase()}/api/auth/google?${params.toString()}`
}

export const authApi = {
    register: (username: string, email: string, password: string, captcha_token?: string) =>
        apiFetch<AuthResponse>('/api/auth/register', {
            method: 'POST',
            body: { username, email, password, captcha_token },
        }),

    login: (identifier: string, password: string) =>
        apiFetch<AuthResponse>('/api/auth/login', {
            method: 'POST',
            body: { identifier, password },
        }),

    /** Desktop-only: exchange short-lived OAuth code from deep-link into JWT + user payload. */
    exchangeDesktopOAuthCode: (code: string, codeVerifier: string) =>
        apiFetch<AuthResponse>('/api/auth/google/desktop-exchange', {
            method: 'POST',
            body: { code, code_verifier: codeVerifier },
        }),

    /** token optional: web uses httpOnly cookie when null. */
    updateStatus: (status: 'online' | 'dnd' | 'invisible', token: string | null) =>
        apiFetch<UserPublic>('/api/auth/status', {
            method: 'PATCH',
            body: { status },
            token: token ?? undefined,
        }),

    getMe: (token: string | null) =>
        apiFetch<UserPublic>('/api/auth/me', { token: token ?? undefined }),

    /** GET /api/auth/check-username?username=xxx — returns { available: boolean }. */
    checkUsername: (username: string, token: string | null) =>
        apiFetch<{ available: boolean }>(
            `/api/auth/check-username?username=${encodeURIComponent(username.trim())}`,
            { token: token ?? undefined },
        ),

    /** token optional: web uses httpOnly cookie when null. */
    updateProfile: (
        payload: { avatar_url?: string; clear_avatar?: boolean; dm_privacy?: 'everyone' | 'friends'; username?: string },
        token: string | null,
    ) =>
        apiFetch<UserPublic>('/api/auth/profile', {
            method: 'PATCH',
            body: payload,
            token: token ?? undefined,
        }),

    /** Clears httpOnly auth cookie (web). No token needed; call with credentials. */
    logout: () =>
        apiFetch<void>('/api/auth/logout', { method: 'POST' }),

    /** Change password. Returns success message and clears cookie (forces re-login). */
    changePassword: (oldPassword: string, newPassword: string, token: string | null) =>
        apiFetch<{ message: string }>('/api/auth/change-password', {
            method: 'POST',
            body: { old_password: oldPassword, new_password: newPassword },
            token: token ?? undefined,
        }),

    /** Set local password for Google-only accounts. Returns refreshed auth payload. */
    setPassword: (newPassword: string, token: string | null) =>
        apiFetch<AuthResponse>('/api/auth/set-password', {
            method: 'POST',
            body: { new_password: newPassword },
            token: token ?? undefined,
        }),

    forgotPassword: (email: string) =>
        apiFetch<{ message: string }>('/api/auth/forgot-password', {
            method: 'POST',
            body: { email },
        }),

    requestEmailVerification: (token: string | null, email?: string) =>
        apiFetch<UserPublic>('/api/auth/email/request-verification', {
            method: 'POST',
            body: email ? { email } : {},
            token: token ?? undefined,
        }),

    confirmEmailVerification: (token: string | null, tokenValue: string) =>
        apiFetch<EmailVerificationConfirmResponse>('/api/auth/email/confirm', {
            method: 'POST',
            body: { token: tokenValue },
            token: token ?? undefined,
        }),

    resetPassword: (token: string, newPassword: string) =>
        apiFetch<{ message: string }>('/api/auth/reset-password', {
            method: 'POST',
            body: { token, new_password: newPassword },
        }),

    exportData: (token: string | null) =>
        apiFetch<DataExportPayload>('/api/auth/data-export', {
            method: 'GET',
            token: token ?? undefined,
        }),

    deleteAccount: (payload: DeleteAccountPayload, token: string | null) =>
        apiFetch<{ message: string }>('/api/auth/account', {
            method: 'DELETE',
            body: payload,
            token: token ?? undefined,
        }),
}
