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
    setAuth: (token: string, user: UserPublic) => void
    setUser: (user: UserPublic) => void
    setUserStatus: (status: UserPublic['status']) => void
    logout: () => void
}

const AUTH_STORAGE_KEY = 'voxpery-auth'

type SetState = (partial: Partial<AuthState> | ((s: AuthState) => Partial<AuthState>)) => void

const authSlice = (set: SetState): AuthState => ({
    token: null,
    user: null,
    setAuth: (token: string, user: UserPublic) => {
        if (isTauri()) {
            set({ token, user })
            setSecureToken(token).catch(() => { })
        } else {
            // Web: store token in localStorage for persistence across page refresh via zustand persist
            set({ token, user })
        }
    },
    setUser: (user: UserPublic) => set({ user }),
    setUserStatus: (status: UserPublic['status']) =>
        set((s) => ({
            user: s.user ? { ...s.user, status } : s.user,
        })),
    logout: () => {
        if (isTauri()) {
            removeSecureToken().catch(() => { })
        } else {
            // Clear cookie on server for complete logout
            authApi.logout().catch(() => { })
        }
        set({ token: null, user: null })
    },
})

/** Always use persist with localStorage. Desktop uses secure storage separately via restoreSecureSession(). */
export const useAuthStore = create<AuthState>()(
    persist(authSlice, {
        name: AUTH_STORAGE_KEY,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
            token: isTauri() ? null : state.token,  // Only persist token on web
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
