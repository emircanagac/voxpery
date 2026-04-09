import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSocketStore } from './socket'
import { act } from '@testing-library/react'

// WebSocket ready state constants
const WS_CONNECTING = 0
const WS_OPEN = 1
const WS_CLOSED = 3

// Mock WebSocket
class MockWebSocket {
  url: string
  readyState = WS_CONNECTING
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    // Simulate async connection
    setTimeout(() => {
      this.readyState = WS_OPEN
      this.onopen?.(new Event('open'))
    }, 0)
  }

  send(_data: string) {
    void _data
    if (this.readyState !== WS_OPEN) {
      throw new Error('WebSocket is not open')
    }
  }

  close() {
    this.readyState = WS_CLOSED
    this.onclose?.(new CloseEvent('close'))
  }
}

// Mock createWebSocket API
vi.mock('../api', () => ({
  createWebSocket: (token: string | null) => {
    return new MockWebSocket(`ws://test.local/ws?token=${token}`)
  },
  authApi: {},
  serversApi: {},
  channelsApi: {},
  messagesApi: {},
  friendsApi: {},
  dmApi: {},
  webrtcApi: {},
}))

describe('WebSocket Store', () => {
  beforeEach(() => {
    // Reset store state
    useSocketStore.setState({
      socket: null,
      isConnected: false,
      token: null,
      shouldReconnect: false,
      listeners: new Set(),
      reconnectListeners: new Set(),
    })
    vi.clearAllTimers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('should initialize with disconnected state', () => {
    const state = useSocketStore.getState()
    expect(state.isConnected).toBe(false)
    expect(state.socket).toBe(null)
    expect(state.token).toBe(null)
  })

  it('should connect to WebSocket with token', async () => {
    const { connect } = useSocketStore.getState()

    act(() => {
      connect('test-token')
    })

    // Wait for connection to open
    await vi.runAllTimersAsync()

    const state = useSocketStore.getState()
    expect(state.token).toBe('test-token')
    expect(state.socket).toBeTruthy()
    expect(state.isConnected).toBe(true)
  })

  it('should disconnect and close socket', async () => {
    const { connect, disconnect } = useSocketStore.getState()

    // Connect first
    act(() => {
      connect('test-token')
    })
    await vi.runAllTimersAsync()

    // Now disconnect
    act(() => {
      disconnect()
    })

    const state = useSocketStore.getState()
    expect(state.isConnected).toBe(false)
    expect(state.token).toBe(null)
  })

  it('should send message when connected', async () => {
    const { connect, send } = useSocketStore.getState()

    act(() => {
      connect('test-token')
    })
    await vi.runAllTimersAsync()

    const state = useSocketStore.getState()
    const sendSpy = vi.spyOn(state.socket!, 'send')

    act(() => {
      send('test_event', { key: 'value' })
    })

    expect(sendSpy).toHaveBeenCalledWith(
      JSON.stringify({ type: 'test_event', data: { key: 'value' } })
    )
  })

  it('should not send message when disconnected', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { send } = useSocketStore.getState()

    act(() => {
      send('test_event', { key: 'value' })
    })

    expect(consoleSpy).toHaveBeenCalledWith(
      'Cannot send message, socket not open',
      'test_event'
    )
  })

  it('should subscribe to messages', async () => {
    const { connect, subscribe } = useSocketStore.getState()
    const listener = vi.fn()

    act(() => {
      connect('test-token')
    })
    await vi.runAllTimersAsync()

    const unsubscribe = subscribe(listener)

    // Simulate incoming message
    const state = useSocketStore.getState()
    const mockMessage = { type: 'MessageCreate', data: { content: 'Hello' } }
    act(() => {
      state.socket?.onmessage?.(
        new MessageEvent('message', { data: JSON.stringify(mockMessage) })
      )
    })

    expect(listener).toHaveBeenCalledWith(mockMessage)

    // Unsubscribe
    unsubscribe()

    // Should not receive further messages
    listener.mockClear()
    act(() => {
      state.socket?.onmessage?.(
        new MessageEvent('message', { data: JSON.stringify(mockMessage) })
      )
    })
    expect(listener).not.toHaveBeenCalled()
  })

  it('should handle reconnection', async () => {
    const { connect } = useSocketStore.getState()
    const reconnectListener = vi.fn()

    act(() => {
      connect('test-token')
    })
    await vi.runAllTimersAsync()

    // Register reconnect listener
    const unsubscribe = useSocketStore.getState().onReconnect(reconnectListener)

    // Simulate disconnect
    const state = useSocketStore.getState()
    act(() => {
      state.socket?.close()
    })

    // Wait for auto-reconnect (3s delay)
    await vi.advanceTimersByTimeAsync(3100)

    expect(reconnectListener).toHaveBeenCalled()
    unsubscribe()
  })

  it('should reconnect web cookie-auth sessions even when token is null', async () => {
    const { connect } = useSocketStore.getState()
    const reconnectListener = vi.fn()

    act(() => {
      connect(null)
    })
    await vi.runAllTimersAsync()

    const unsubscribe = useSocketStore.getState().onReconnect(reconnectListener)

    const state = useSocketStore.getState()
    act(() => {
      state.socket?.close()
    })

    await vi.advanceTimersByTimeAsync(3100)

    const next = useSocketStore.getState()
    expect(next.socket).toBeTruthy()
    expect(next.isConnected).toBe(true)
    expect(reconnectListener).toHaveBeenCalled()
    unsubscribe()
  })

  it('should handle multiple subscribers', async () => {
    const { connect, subscribe } = useSocketStore.getState()
    const listener1 = vi.fn()
    const listener2 = vi.fn()

    act(() => {
      connect('test-token')
    })
    await vi.runAllTimersAsync()

    subscribe(listener1)
    subscribe(listener2)

    // Simulate incoming message
    const state = useSocketStore.getState()
    const mockMessage = { type: 'ChannelUpdate', data: { id: '1' } }
    act(() => {
      state.socket?.onmessage?.(
        new MessageEvent('message', { data: JSON.stringify(mockMessage) })
      )
    })

    expect(listener1).toHaveBeenCalledWith(mockMessage)
    expect(listener2).toHaveBeenCalledWith(mockMessage)
  })

  it('should handle malformed JSON gracefully', async () => {
    const { connect, subscribe } = useSocketStore.getState()
    const listener = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    act(() => {
      connect('test-token')
    })
    await vi.runAllTimersAsync()

    subscribe(listener)

    // Send invalid JSON
    const state = useSocketStore.getState()
    act(() => {
      state.socket?.onmessage?.(new MessageEvent('message', { data: 'invalid json' }))
    })

    expect(listener).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('WS Parse error', expect.any(Error))
  })
})
