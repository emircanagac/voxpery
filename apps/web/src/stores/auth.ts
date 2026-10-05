import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { authApi, getAuthErrorMessage, isAuthError, type LegalConsentStatus, type UserPublic } from '../api'
import {
    isTauri,
    getSecureToken,
    setSecureToken,
    removeSecureToken,
} from '../secureStorage'

interface AuthState {
    token: string | null
    user: UserPublic | null
    /** True while we're logging out (web); prevents App from restoring session from cookie. */
    loggingOut: boolean
    sessionState: 'idle' | 'loading' | 'ready' | 'error'
    sessionError: string | null
    legalConsent: LegalConsentStatus | null
    restoreSession: () => Promise<void>
    setLegalConsent: (status: LegalConsentStatus | null, userId: string, token: string | null) => void
    setAuth: (token: string, user: UserPublic) => void
    setUser: (user: UserPublic) => void
    setUserStatus: (status: UserPublic['status']) => void
    clearSession: () => void
    logout: () => void
}

const AUTH_STORAGE_KEY = 'voxpery-auth'

type SetState = (partial: Partial<AuthState> | ((s: AuthState) => Partial<AuthState>)) => void
type GetState = () => AuthState

const authSlice = (set: SetState, get: GetState): AuthState => {
    let generation = 0
    let pending: { generation: number; task: Promise<void> } | null = null
    const invalidate = () => { generation++; pending = null }
    return {
        token: null,
        user: null,
        loggingOut: false,
        sessionState: 'idle',
        sessionError: null,
        legalConsent: null,
        restoreSession: () => {
            if (pending?.generation === generation) return pending.task
            if (get().loggingOut) return Promise.resolve()
            const request = generation
            set({ sessionState: 'loading', sessionError: null, legalConsent: null })
            const task = (async () => {
                try {
                    const desktop = isTauri()
                    const token = desktop ? get().token ?? await getSecureToken() : null
                    if (request !== generation) return
                    if (desktop && !token) {
                        set({ token: null, user: null, sessionState: 'ready' })
                        return
                    }
                    const session = await authApi.getSession(token)
                    if (request !== generation) return
                    if (!session.legal_consent) throw new Error('The server did not return session document status.')
                    set({
                        token, user: session.user, legalConsent: session.legal_consent,
                        sessionState: 'ready', sessionError: null,
                    })
                } catch (error) {
                    if (request !== generation) return
                    if (isAuthError(error)) {
                        get().clearSession()
                    } else {
                        set({ sessionState: 'error', sessionError: getAuthErrorMessage(error).message })
                    }
                } finally {
                    if (pending?.generation === request) pending = null
                }
            })()
            pending = { generation: request, task }
            return task
        },
        setLegalConsent: (status, userId, token) => {
            if (get().user?.id === userId && get().token === token) set({ legalConsent: status })
        },
        setAuth: (token: string, user: UserPublic) => {
            invalidate()
            set({ legalConsent: null, sessionState: 'idle', sessionError: null, loggingOut: false })
            if (isTauri()) {
                set({ token, user })
                setSecureToken(token).catch(() => { })
            } else {
                // Web: keep token only in memory; persistence relies on httpOnly cookie session.
                set({ token, user })
            }
        },
        setUser: (user: UserPublic) => {
            if (get().user?.id !== user.id) {
                invalidate()
                set({ legalConsent: null, sessionState: 'idle', sessionError: null })
            }
            set({ user })
        },
        setUserStatus: (status: UserPublic['status']) =>
            set((s) => ({
                user: s.user ? { ...s.user, status } : s.user,
            })),
        clearSession: () => {
            invalidate()
            if (isTauri()) {
                removeSecureToken().catch(() => { })
            }
            set({ loggingOut: false, token: null, user: null, legalConsent: null, sessionState: 'ready', sessionError: null })
        },
        logout: () => {
            const currentToken = get().token
            invalidate()
            const request = generation
            set({ legalConsent: null, sessionState: 'ready', sessionError: null })
            if (isTauri()) {
                removeSecureToken().catch(() => { })
                set({ token: null, user: null })
                authApi.logout(currentToken).catch(() => { })
            } else {
                // Clear state immediately so UI shows login without delay. Set loggingOut so App
                // skips restoring session from cookie. Clear cookie in background.
                set({ loggingOut: true, token: null, user: null })
                authApi
                    .logout(null)
                    .catch(() => {})
                    .finally(() => { if (request === generation) set({ loggingOut: false }) })
            }
        },
    }
}

/** Persist only display profile hints. Session validity and consent are restored from the server. */
export const useAuthStore = create<AuthState>()(
    persist(authSlice, {
        name: AUTH_STORAGE_KEY,
        storage: createJSONStorage(() => localStorage),
        version: 2,
        merge: (persisted, current) => ({
            ...current,
            user: (persisted as Partial<AuthState> | null)?.user ?? null,
            token: null, legalConsent: null, sessionState: 'idle', sessionError: null, loggingOut: false,
        }),
        migrate: (persistedState) => {
            if (!persistedState || typeof persistedState !== 'object') {
                return persistedState as AuthState
            }
            const stateObj = persistedState as { token?: unknown }
            return {
                ...stateObj,
                token: null,
            } as AuthState
        },
        partialize: (state) => ({
            token: null,
            user: state.user,
        }),
    })
)
