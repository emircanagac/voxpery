import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { authApi, isAuthError, type UserPublic } from '../api'
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
    setAuth: (token: string, user: UserPublic) => void
    setUser: (user: UserPublic) => void
    setUserStatus: (status: UserPublic['status']) => void
    clearSession: () => void
    logout: () => void
}

const AUTH_STORAGE_KEY = 'voxpery-auth'

type SetState = (partial: Partial<AuthState> | ((s: AuthState) => Partial<AuthState>)) => void

const authSlice = (set: SetState): AuthState => ({
    token: null,
    user: null,
    loggingOut: false,
    setAuth: (token: string, user: UserPublic) => {
        if (isTauri()) {
            set({ token, user })
            setSecureToken(token).catch(() => { })
        } else {
            // Web: keep token only in memory; persistence relies on httpOnly cookie session.
            set({ token, user })
        }
    },
    setUser: (user: UserPublic) => set({ user }),
    setUserStatus: (status: UserPublic['status']) =>
        set((s) => ({
            user: s.user ? { ...s.user, status } : s.user,
        })),
    clearSession: () => {
        if (isTauri()) {
            removeSecureToken().catch(() => { })
        }
        set({ loggingOut: false, token: null, user: null })
    },
    logout: () => {
        if (isTauri()) {
            removeSecureToken().catch(() => { })
            set({ token: null, user: null })
        } else {
            // Clear state immediately so UI shows login without delay. Set loggingOut so App
            // skips restoring session from cookie. Clear cookie in background.
            set({ loggingOut: true, token: null, user: null })
            authApi
                .logout()
                .catch(() => {})
                .finally(() => set({ loggingOut: false }))
        }
    },
})

/** Always use persist with localStorage. Desktop uses secure storage separately via restoreSecureSession(). */
export const useAuthStore = create<AuthState>()(
    persist(authSlice, {
        name: AUTH_STORAGE_KEY,
        storage: createJSONStorage(() => localStorage),
        version: 2,
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

/** Restore session from secure storage (desktop only). Call once on app mount when isTauri(). */
export async function restoreSecureSession(): Promise<boolean> {
    if (!isTauri()) return false
    const token = await getSecureToken()
    if (!token) return false
    try {
        const user = await authApi.getMe(token)
        useAuthStore.getState().setAuth(token, user)
        return true
    } catch (err) {
        if (isAuthError(err)) {
            await removeSecureToken()
        }
        return false
    }
}
