import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useLiveKitVoice } from './useLiveKitVoice'

const mocks = vi.hoisted(() => ({
  getAudioContext: vi.fn(() => { throw new Error('QA microphone pipeline reached') }),
  createWebSocket: vi.fn(),
}))

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  createWebSocket: mocks.createWebSocket,
}))

vi.mock('./hooks/useAudioEngine', async (importOriginal) => ({
  ...await importOriginal<typeof import('./hooks/useAudioEngine')>(),
  useAudioEngine: () => ({
    getAudioContext: mocks.getAudioContext,
    playVoiceCue: vi.fn(),
    disconnectAudioContext: vi.fn(),
    buildMicSendTrack: vi.fn(),
    updateMicProcessingSettings: vi.fn(),
    destroyRnnoise: vi.fn(),
  }),
}))

vi.mock('livekit-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('livekit-client')>(),
  isBrowserSupported: () => true,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  useSocketStore.getState().disconnect()
  useAuthStore.setState({
    user: { id: 'qa-user', username: 'qa-user', email: 'qa@example.test', status: 'online', email_verified: true },
    token: 'qa-token',
  })
  mocks.createWebSocket.mockImplementation(() => ({
    readyState: WebSocket.CONNECTING,
    close: vi.fn(),
    send: vi.fn(),
  }))
})

afterEach(() => {
  cleanup()
  useSocketStore.getState().disconnect()
  useAuthStore.setState({ user: null, token: null })
  vi.restoreAllMocks()
})

function stream() {
  return new MediaStream([{ kind: 'audio', stop: vi.fn() } as unknown as MediaStreamTrack])
}

describe('voice join socket boundary', () => {
  it('uses current connectivity after the permission-wait callback was captured', async () => {
    const { result } = renderHook(() => useLiveKitVoice())
    const capturedJoin = result.current.joinVoice
    act(() => useSocketStore.setState({ isConnected: true }))
    await act(async () => {
      await expect(capturedJoin('qa-channel', { preflightStream: stream() })).rejects.toThrow('QA microphone pipeline reached')
    })
    expect(mocks.getAudioContext).toHaveBeenCalledOnce()
  })

  it('rejects a disconnect that happened after the callback was captured', async () => {
    useSocketStore.setState({ isConnected: true })
    const { result } = renderHook(() => useLiveKitVoice())
    const capturedJoin = result.current.joinVoice
    act(() => useSocketStore.getState().disconnect())
    await act(async () => {
      await expect(capturedJoin('qa-channel', { preflightStream: stream() })).rejects.toThrow('WebSocket is not connected')
    })
    expect(mocks.getAudioContext).not.toHaveBeenCalled()
    expect(mocks.createWebSocket).not.toHaveBeenCalled()
  })

  it('starts one explicit recovery attempt after retries were exhausted without joining offline', async () => {
    useSocketStore.setState({ foregroundReconnectAllowed: true, shouldReconnect: false, token: 'qa-token' })
    const { result } = renderHook(() => useLiveKitVoice())
    await act(async () => {
      await expect(result.current.joinVoice('qa-channel', { preflightStream: stream() })).rejects.toThrow('WebSocket is not connected')
      await expect(result.current.joinVoice('qa-channel', { preflightStream: stream() })).rejects.toThrow('WebSocket is not connected')
    })
    expect(mocks.createWebSocket).toHaveBeenCalledOnce()
    expect(mocks.getAudioContext).not.toHaveBeenCalled()
    expect(useSocketStore.getState().shouldReconnect).toBe(true)
  })

  it('allows the captured join only after the recovered socket actually opens', async () => {
    useSocketStore.setState({ foregroundReconnectAllowed: true, token: 'qa-token' })
    const { result } = renderHook(() => useLiveKitVoice())
    const capturedJoin = result.current.joinVoice
    await act(async () => {
      await expect(capturedJoin('qa-channel', { preflightStream: stream() })).rejects.toThrow('WebSocket is not connected')
    })
    const socket = useSocketStore.getState().socket!
    act(() => {
      Object.defineProperty(socket, 'readyState', { value: WebSocket.OPEN })
      socket.onopen?.(new Event('open'))
    })
    await act(async () => {
      await expect(capturedJoin('qa-channel', { preflightStream: stream() })).rejects.toThrow('QA microphone pipeline reached')
    })
    expect(mocks.createWebSocket).toHaveBeenCalledOnce()
    expect(mocks.getAudioContext).toHaveBeenCalledOnce()
  })

  it('does not restart an authentication-expired socket on explicit join', async () => {
    useSocketStore.getState().connect('qa-token')
    const socket = useSocketStore.getState().socket!
    socket.onclose?.(new CloseEvent('close', { code: 4001 }))
    mocks.createWebSocket.mockClear()
    const { result } = renderHook(() => useLiveKitVoice())
    await act(async () => {
      await expect(result.current.joinVoice('qa-channel', { preflightStream: stream() })).rejects.toThrow('WebSocket is not connected')
    })
    expect(mocks.createWebSocket).not.toHaveBeenCalled()
    expect(mocks.getAudioContext).not.toHaveBeenCalled()
    expect(useSocketStore.getState().foregroundReconnectAllowed).toBe(false)
  })
})
