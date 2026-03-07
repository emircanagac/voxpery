import { create } from 'zustand'
import { createWebSocket } from '../api'

type WsListener = (data: unknown) => void
type ReconnectListener = () => void

interface SocketState {
    socket: WebSocket | null
    isConnected: boolean
    token: string | null
    listeners: Set<WsListener>
    reconnectListeners: Set<ReconnectListener>

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
    listeners: new Set(),
    reconnectListeners: new Set(),
    _wasConnectedBefore: false,

    connect: (token) => {
        const state = get()
        // If we already have a valid socket, just update token if needed
        if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
            if (state.token !== token) set({ token })
            return
        }

        set({ token })
        const ws = createWebSocket(token)

        ws.onopen = () => {
            const wasConnected = (get() as SocketState & { _wasConnectedBefore?: boolean })._wasConnectedBefore
            set({ isConnected: true, socket: ws, _wasConnectedBefore: true } as Partial<SocketState>)
            // Fire reconnect listeners if this was a re-establishment (not first connect)
            if (wasConnected) {
                get().reconnectListeners.forEach((cb) => {
                    try { cb() } catch (e) { console.error('[WS] reconnect listener error:', e) }
                })
            }
        }

        ws.onclose = () => {
            set({ isConnected: false, socket: null })

            // Auto-reconnect if we still have a token
            const currentToken = get().token
            if (currentToken) {
                setTimeout(() => {
                    const latestToken = get().token
                    const currentSocket = get().socket
                    // Only try to reconnect if we still have a token and we aren't already trying
                    if (latestToken && (!currentSocket || currentSocket.readyState === WebSocket.CLOSED)) {
                        get().connect(latestToken)
                    }
                }, 3000)
            }
        }

        ws.onmessage = (event) => {
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
        // Clear token first to prevent auto-reconnect
        set({ token: null })
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
