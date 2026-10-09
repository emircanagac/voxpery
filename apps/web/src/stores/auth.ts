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
    setAuth: (token: string, user: UserPublic) => Promise<void>
    setUser: (user: UserPublic) => void
    setUserStatus: (status: UserPublic['status']) => void
    clearSession: () => void
    logout: () => void
}

const AUTH_STORAGE_KEY = 'voxpery-auth'
// A non-secret logout tombstone prevents restoring an undeleted credential after restart.
const DESKTOP_LOGOUT_PENDING = 'voxpery-desktop-logout-pending'

type SetState = (partial: Partial<AuthState> | ((s: AuthState) => Partial<AuthState>)) => void
type GetState = () => AuthState

const authSlice = (set: SetState, get: GetState): AuthState => {
    let generation = 0
    let pending: { generation: number; task: Promise<void> } | null = null
    let desktopTask: Promise<void> = Promise.resolve()
    const invalidate = () => { generation++; pending = null }
    const onDesktopQueue = (operation: () => Promise<void>) => {
        const task = desktopTask.then(operation)
        desktopTask = task.catch(() => {})
        return task
    }
    const cleanupDesktopSession = async (revoke = true) => {
        const storedToken = await getSecureToken()
        if (revoke && storedToken) await authApi.logout(storedToken)
        await removeSecureToken()
    }
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
                    if (desktop && localStorage.getItem(DESKTOP_LOGOUT_PENDING)) {
                        await onDesktopQueue(cleanupDesktopSession)
                        if (request === generation) {
                            localStorage.removeItem(DESKTOP_LOGOUT_PENDING)
                            set({ token: null, user: null, sessionState: 'ready', sessionError: null })
                        }
                        return
                    }
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
        setAuth: async (token: string, user: UserPublic) => {
            invalidate()
            const request = generation
            if (isTauri()) {
                set({ sessionState: 'loading', sessionError: null, legalConsent: null })
                try {
                    await onDesktopQueue(async () => {
                        if (request !== generation) throw new Error('Sign-in was cancelled. Please try again.')
                        if (localStorage.getItem(DESKTOP_LOGOUT_PENDING)) await cleanupDesktopSession()
                        localStorage.setItem(DESKTOP_LOGOUT_PENDING, '1')
                        await setSecureToken(token)
                        if (request !== generation) throw new Error('Sign-in was cancelled. Please try again.')
                        localStorage.removeItem(DESKTOP_LOGOUT_PENDING)
                    })
                    if (request !== generation) throw new Error('Sign-in was cancelled. Please try again.')
                } catch (error) {
                    if (request === generation) set({ token: null, user: null, sessionState: 'error', sessionError: getAuthErrorMessage(error).message })
                    throw error
                }
            }
            // Web tokens remain in memory; desktop commits only after the keyring write succeeds.
            set({ token, user, legalConsent: null, sessionState: 'idle', sessionError: null, loggingOut: false })
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
            const request = generation
            if (isTauri()) {
                localStorage.setItem(DESKTOP_LOGOUT_PENDING, '1')
                void onDesktopQueue(removeSecureToken).then(() => {
                    if (request === generation) localStorage.removeItem(DESKTOP_LOGOUT_PENDING)
                }).catch(error => {
                    if (request === generation) set({ sessionState: 'error', sessionError: getAuthErrorMessage(error).message })
                })
            }
            set({ loggingOut: false, token: null, user: null, legalConsent: null, sessionState: 'ready', sessionError: null })
        },
        logout: () => {
            const currentToken = get().token
            invalidate()
            const request = generation
            set({ legalConsent: null, sessionState: 'ready', sessionError: null })
            if (isTauri()) {
                localStorage.setItem(DESKTOP_LOGOUT_PENDING, '1')
                set({ token: null, user: null, loggingOut: true })
                void onDesktopQueue(async () => {
                    if (currentToken) await authApi.logout(currentToken)
                    await cleanupDesktopSession(false)
                }).then(() => {
                    if (request === generation) {
                        localStorage.removeItem(DESKTOP_LOGOUT_PENDING)
                        set({ loggingOut: false })
                    }
                }).catch(error => {
                    if (request === generation) set({ loggingOut: false, sessionState: 'error', sessionError: getAuthErrorMessage(error).message })
                })
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
