import { create } from 'zustand'
import { createWebSocket } from '../api'

type WsListener = (data: unknown) => void
type ReconnectListener = () => void

const AUTH_EXPIRED_CLOSE_CODE = 4001
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30000
const RECONNECT_MAX_ATTEMPTS = 8
const RECONNECT_JITTER_RATIO = 0.25

export function websocketReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
    const exponent = Math.max(0, attempt - 1)
    const rawDelay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** exponent)
    const jitter = 1 + (random() * 2 - 1) * RECONNECT_JITTER_RATIO
    return Math.round(rawDelay * jitter)
}

interface SocketState {
    socket: WebSocket | null
    isConnected: boolean
    token: string | null
    shouldReconnect: boolean
    listeners: Set<WsListener>
    reconnectListeners: Set<ReconnectListener>
    reconnectAttempt: number
    reconnectTimer: ReturnType<typeof setTimeout> | null
    connectionId: number
    wasConnectedBefore: boolean

    // Actions
    connect: (token: string | null) => void
    disconnect: () => void
    send: (type: string, data: unknown) => void
    subscribe: (listener: WsListener) => () => void
    /** Register a callback invoked each time the WS reconnects (after a prior disconnect). */
    onReconnect: (listener: ReconnectListener) => () => void
}

export const useSocketStore = create<SocketState>((set, get) => ({
    socket: null,
    isConnected: false,
    token: null,
    shouldReconnect: false,
    listeners: new Set(),
    reconnectListeners: new Set(),
    reconnectAttempt: 0,
    reconnectTimer: null,
    connectionId: 0,
    wasConnectedBefore: false,

    connect: (token) => {
        const state = get()
        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer)
            set({ reconnectTimer: null })
        }

        // If we already have a valid socket, just update token if needed.
        if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
            if (state.token !== token || !state.shouldReconnect) set({ token, shouldReconnect: true })
            return
        }

        const connectionId = state.connectionId + 1
        set({ token, shouldReconnect: true, connectionId })
        const ws = createWebSocket(token)

        ws.onopen = () => {
            if (get().connectionId !== connectionId) return

            const wasConnected = get().wasConnectedBefore
            set({
                isConnected: true,
                socket: ws,
                reconnectAttempt: 0,
                reconnectTimer: null,
                wasConnectedBefore: true,
            })

            // Fire reconnect listeners if this was a re-establishment (not first connect)
            if (wasConnected) {
                get().reconnectListeners.forEach((cb) => {
                    try { cb() } catch (e) { console.error('[WS] reconnect listener error:', e) }
                })
            }
        }

        ws.onclose = (event) => {
            if (get().connectionId !== connectionId) return

            if (event.code === AUTH_EXPIRED_CLOSE_CODE) {
                set({
                    isConnected: false,
                    socket: null,
                    shouldReconnect: false,
                    reconnectAttempt: 0,
                    reconnectTimer: null,
                })
                return
            }

            set({ isConnected: false, socket: null })

            // Auto-reconnect for active sessions.
            // Web cookie-auth sessions use token=null, so reconnect intent must
            // be tracked separately from the bearer token itself.
            const { shouldReconnect, reconnectAttempt } = get()
            if (shouldReconnect && reconnectAttempt < RECONNECT_MAX_ATTEMPTS) {
                const nextAttempt = reconnectAttempt + 1
                const delayMs = websocketReconnectDelayMs(nextAttempt)
                const reconnectTimer = setTimeout(() => {
                    const { token: latestToken, shouldReconnect: latestShouldReconnect, connectionId: latestConnectionId } = get()
                    const currentSocket = get().socket
                    const hasActiveSocket = currentSocket && (
                        currentSocket.readyState === WebSocket.OPEN ||
                        currentSocket.readyState === WebSocket.CONNECTING
                    )

                    if (latestShouldReconnect && latestConnectionId === connectionId && !hasActiveSocket) {
                        get().connect(latestToken)
                    }
                }, delayMs)

                set({ reconnectAttempt: nextAttempt, reconnectTimer })
            } else if (shouldReconnect) {
                set({ shouldReconnect: false, reconnectAttempt: 0, reconnectTimer: null })
            }
        }

        ws.onmessage = (event) => {
            if (get().connectionId !== connectionId) return

            try {
                const data = JSON.parse(event.data)
                get().listeners.forEach((listener) => listener(data))
            } catch (e) {
                console.error('WS Parse error', e)
            }
        }

        set({ socket: ws })
    },

    disconnect: () => {
        const { reconnectTimer } = get()
        if (reconnectTimer) clearTimeout(reconnectTimer)

        // Clear token first to prevent auto-reconnect.
        set({
            token: null,
            shouldReconnect: false,
            reconnectAttempt: 0,
            reconnectTimer: null,
            connectionId: get().connectionId + 1,
        })
        get().socket?.close()
        set({ socket: null, isConnected: false })
    },

    send: (type, data) => {
        const { socket } = get()
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type, data }))
        } else {
            // Unsubscribe during teardown/navigation is normal; avoid noisy warn
            if (type !== 'Unsubscribe') {
                console.warn('Cannot send message, socket not open', type)
            }
        }
    },

    subscribe: (listener) => {
        set((state) => {
            const newListeners = new Set(state.listeners)
            newListeners.add(listener)
            return { listeners: newListeners }
        })

        return () => {
            set((state) => {
                const newListeners = new Set(state.listeners)
                newListeners.delete(listener)
                return { listeners: newListeners }
            })
        }
    },

    onReconnect: (listener) => {
        set((state) => {
            const next = new Set(state.reconnectListeners)
            next.add(listener)
            return { reconnectListeners: next }
        })
        return () => {
            set((state) => {
                const next = new Set(state.reconnectListeners)
                next.delete(listener)
                return { reconnectListeners: next }
            })
        }
    }
}))
