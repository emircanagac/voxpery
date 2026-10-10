import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useLiveKitVoice } from './useLiveKitVoice'

const mocks = vi.hoisted(() => ({
  getAudioContext: vi.fn(),
  buildMicSendTrack: vi.fn(),
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
    buildMicSendTrack: mocks.buildMicSendTrack,
    updateMicProcessingSettings: vi.fn(),
    destroyRnnoise: vi.fn(),
  }),
}))

vi.mock('livekit-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('livekit-client')>(),
  isBrowserSupported: () => true,
}))

function pausedAudioContext() {
  let resume!: () => void
  const context = {
    state: 'suspended' as AudioContextState,
    resume: () => new Promise<void>(done => {
      resume = () => { context.state = 'running'; done() }
    }),
  }
  return { context, release: () => resume() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  useAuthStore.setState({
    user: { id: 'qa-user', username: 'qa-user', email: 'qa@example.test', status: 'online', email_verified: true },
    token: 'qa-token',
  })
  mocks.createWebSocket.mockImplementation(() => ({ readyState: WebSocket.CONNECTING, close: vi.fn(), send: vi.fn() }))
  useSocketStore.setState({ isConnected: true })
})

afterEach(() => {
  cleanup()
  useSocketStore.getState().disconnect()
  useAuthStore.setState({ user: null, token: null })
  vi.restoreAllMocks()
})

describe('voice join cancellation', () => {
  it('releases the microphone and stops a join that was still pending when the hook unmounted', async () => {
    const audio = pausedAudioContext()
    mocks.getAudioContext.mockReturnValue(audio.context)
    const micTrack = { kind: 'audio', stop: vi.fn(), applyConstraints: vi.fn(async () => {}) }
    const { result, unmount } = renderHook(() => useLiveKitVoice())
    const join = result.current.joinVoice('qa-channel', {
      preflightStream: new MediaStream([micTrack as unknown as MediaStreamTrack]),
    })
    await act(async () => { await Promise.resolve() })

    unmount()
    audio.release()

    await expect(join).resolves.toBeUndefined()
    expect(micTrack.stop).toHaveBeenCalled()
    expect(mocks.buildMicSendTrack).not.toHaveBeenCalled()
  })

  it('treats a leave during a pending join as a silent cancellation', async () => {
    const audio = pausedAudioContext()
    mocks.getAudioContext.mockReturnValue(audio.context)
    const micTrack = { kind: 'audio', stop: vi.fn(), applyConstraints: vi.fn(async () => {}) }
    const { result } = renderHook(() => useLiveKitVoice())
    const join = result.current.joinVoice('qa-channel', {
      preflightStream: new MediaStream([micTrack as unknown as MediaStreamTrack]),
    })
    await act(async () => { await Promise.resolve() })

    act(() => result.current.leaveVoice({ skipLeaveSound: true }))
    audio.release()

    await act(async () => { await expect(join).resolves.toBeUndefined() })
    expect(micTrack.stop).toHaveBeenCalled()
    expect(mocks.buildMicSendTrack).not.toHaveBeenCalled()
    expect(result.current.state.lastError ?? null).toBeNull()
    expect(result.current.state.isJoining).toBe(false)
  })
})
