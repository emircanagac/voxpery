import { create } from 'zustand'
import { createWebSocket, type WsEvent } from '../api'
import { reportObservabilityEvent } from '../observability'
import { createSecureRandomFraction } from '../secureId'

/** Receives each parsed server event; narrow on `type` for typed `data`. */
type WsListener = (event: WsEvent) => void
type ReconnectListener = () => void

const AUTH_EXPIRED_CLOSE_CODE = 4001
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30000
/** Reconnecting never stops while signed in; this attempt only marks a long outage in telemetry. */
const RECONNECT_LONG_OUTAGE_ATTEMPT = 8
/** The first retry is spread over this window, so a server restart is not followed by every client at once. */
const RECONNECT_FIRST_DELAY_MAX_MS = 3000
const RECONNECT_JITTER_RATIO = 0.25

export function websocketReconnectDelayMs(
    attempt: number,
    random: () => number = createSecureRandomFraction,
): number {
    if (attempt <= 1) return Math.round(random() * RECONNECT_FIRST_DELAY_MAX_MS)
    const exponent = Math.max(0, attempt - 1)
    const rawDelay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** exponent)
    const jitter = 1 + (random() * 2 - 1) * RECONNECT_JITTER_RATIO
    return Math.round(rawDelay * jitter)
}

// While the user is in a voice channel the server keeps their session for a short reconnect
// grace (10 s). The first retry then goes out at once instead of after the random spread that
// keeps everyone from returning together after a server restart.
let voiceSessionActive = false

export function setVoiceSessionActive(active: boolean): void {
    voiceSessionActive = active
}

function firstReconnectIsUrgent(): boolean {
    return voiceSessionActive && (typeof navigator === 'undefined' || navigator.onLine !== false)
}

interface SocketState {
    socket: WebSocket | null
    isConnected: boolean
    token: string | null
    shouldReconnect: boolean
    foregroundReconnectAllowed: boolean
    listeners: Set<WsListener>
    reconnectListeners: Set<ReconnectListener>
    reconnectAttempt: number
    reconnectTimer: ReturnType<typeof setTimeout> | null
    connectionId: number
    wasConnectedBefore: boolean
    /** When the connection the app is trying to restore went down; null while connected or signed out. */
    disconnectedSince: number | null

    // Actions
    connect: (token: string | null) => void
    resumeConnection: () => void
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
    foregroundReconnectAllowed: false,
    listeners: new Set(),
    reconnectListeners: new Set(),
    reconnectAttempt: 0,
    reconnectTimer: null,
    connectionId: 0,
    wasConnectedBefore: false,
    disconnectedSince: null,

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
        set({ token, shouldReconnect: true, foregroundReconnectAllowed: true, connectionId })
        const ws = createWebSocket(token)

        ws.onopen = () => {
            if (get().connectionId !== connectionId) return

            const wasConnected = get().wasConnectedBefore
            const reconnectAttempt = get().reconnectAttempt
            set({
                isConnected: true,
                socket: ws,
                reconnectAttempt: 0,
                reconnectTimer: null,
                wasConnectedBefore: true,
                disconnectedSince: null,
            })

            // Fire reconnect listeners if this was a re-establishment (not first connect)
            if (wasConnected) {
                if (reconnectAttempt > 0) {
                    reportObservabilityEvent('websocket_reconnect_succeeded')
                }
                get().reconnectListeners.forEach((cb) => {
                    try { cb() } catch (e) { console.error('[WS] reconnect listener error:', e) }
                })
            }
        }

        ws.onclose = (event) => {
            if (get().connectionId !== connectionId) return

            if (event.code === AUTH_EXPIRED_CLOSE_CODE) {
                const timer = get().reconnectTimer
                if (timer) clearTimeout(timer)
                set({
                    isConnected: false,
                    socket: null,
                    shouldReconnect: false,
                    foregroundReconnectAllowed: false,
                    reconnectAttempt: 0,
                    reconnectTimer: null,
                    disconnectedSince: null,
                })
                return
            }

            set({
                isConnected: false,
                socket: null,
                disconnectedSince: get().shouldReconnect ? get().disconnectedSince ?? Date.now() : null,
            })

            // Auto-reconnect for active sessions. It never gives up: after the delay reaches its cap
            // the retries simply continue at that pace until the server is back.
            // Web cookie-auth sessions use token=null, so reconnect intent must
            // be tracked separately from the bearer token itself.
            const { shouldReconnect, reconnectAttempt } = get()
            if (shouldReconnect) {
                const nextAttempt = reconnectAttempt + 1
                if (nextAttempt === 1) {
                    reportObservabilityEvent('websocket_reconnect_started')
                }
                if (nextAttempt === RECONNECT_LONG_OUTAGE_ATTEMPT + 1) {
                    reportObservabilityEvent('websocket_reconnect_exhausted')
                }
                const delayMs = nextAttempt === 1 && firstReconnectIsUrgent()
                    ? 0
                    : websocketReconnectDelayMs(nextAttempt)
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
            }
        }

        ws.onmessage = (event) => {
            if (get().connectionId !== connectionId) return

            let data: Parameters<WsListener>[0]
            try {
                data = JSON.parse(event.data)
            } catch (e) {
                console.error('WS Parse error', e)
                return
            }
            // One listener failing must not keep the event from the others.
            get().listeners.forEach((listener) => {
                try {
                    listener(data)
                } catch (e) {
                    console.error('WS listener error', e)
                }
            })
        }

        set({ socket: ws })
    },

    resumeConnection: () => {
        const state = get()
        if (!state.foregroundReconnectAllowed) return
        if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) return
        get().connect(state.token)
    },

    disconnect: () => {
        const { reconnectTimer } = get()
        if (reconnectTimer) clearTimeout(reconnectTimer)

        // Clear token first to prevent auto-reconnect.
        set({
            token: null,
            shouldReconnect: false,
            foregroundReconnectAllowed: false,
            reconnectAttempt: 0,
            reconnectTimer: null,
            disconnectedSince: null,
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
