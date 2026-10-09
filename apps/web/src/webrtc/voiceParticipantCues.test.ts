import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionState, DisconnectReason, Room, RoomEvent, type RemoteParticipant } from 'livekit-client'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { useSocketStore } from '../stores/socket'
import { useLiveKitVoice } from './useLiveKitVoice'

const mocks = vi.hoisted(() => ({
  cue: vi.fn(),
  stop: vi.fn(),
  audio: { state: 'running' },
  noop: vi.fn(),
  mic: vi.fn(),
  token: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  rooms: [] as Room[],
}))

vi.mock('../api', async importOriginal => ({
  ...await importOriginal<typeof import('../api')>(),
  webrtcApi: { getLivekitToken: mocks.token, getTurnCredentials: async () => ({ urls: [] }) },
}))
vi.mock('./hooks/useAudioEngine', async importOriginal => ({
  ...await importOriginal<typeof import('./hooks/useAudioEngine')>(),
  useAudioEngine: () => ({
    getAudioContext: () => mocks.audio,
    playVoiceCue: mocks.cue,
    disconnectAudioContext: mocks.noop,
    buildMicSendTrack: mocks.mic,
    updateMicProcessingSettings: mocks.noop,
    destroyRnnoise: mocks.noop,
  }),
}))
vi.mock('./hooks/useLocalMedia', () => ({
  useLocalMedia: () => ({
    applyLocalMicSettings: mocks.noop,
    getInputVolumeFactor: () => 1,
    getScreenShareEncoding: mocks.noop,
    cleanupLocalMedia: mocks.noop,
  }),
}))
vi.mock('./hooks/useVoiceActivity', () => ({
  useVoiceActivity: () => ({ voiceMode: 'voice_activity', startLocalSpeakingMonitor: mocks.noop, stopLocalSpeakingMonitor: mocks.noop }),
}))
vi.mock('./hooks/useWebrtcDiagnostics', () => ({ useWebrtcDiagnostics: () => ({}) }))
vi.mock('./hooks/useVoiceForegroundRecovery', () => ({ useVoiceForegroundRecovery: () => mocks.noop }))
vi.mock('livekit-client', async importOriginal => {
  const sdk = await importOriginal<typeof import('livekit-client')>()
  return {
    ...sdk,
    isBrowserSupported: () => true,
    Room: class extends sdk.Room {
      constructor(...args: ConstructorParameters<typeof sdk.Room>) {
        super(...args)
        mocks.rooms.push(this)
        this.connect = mocks.connect
        this.disconnect = mocks.disconnect
      }
    },
  }
})

let room: Room
function peer(identity: string): RemoteParticipant {
  return { identity, trackPublications: new Map(), setDisconnected: vi.fn() } as unknown as RemoteParticipant
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rooms.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  useAuthStore.setState({
    user: { id: 'cue-local', username: 'cue-local', email: 'cue@example.test', status: 'online', email_verified: true },
    token: 'test-token',
  })
  useAppStore.setState({ voiceStates: {}, voiceControls: {}, joinedVoiceChannelId: null })
  useSocketStore.setState({ isConnected: true })
  mocks.token.mockResolvedValue({ ws_url: 'ws://example.test', token: 'test-token' })
  mocks.mic.mockImplementation(async (stream: MediaStream) => ({
    track: stream.getAudioTracks()[0], vadStream: stream, source: 'raw', cancelGate: mocks.noop,
  }))
  mocks.connect.mockImplementation(async () => {
    room = mocks.rooms.at(-1)!
    room.state = ConnectionState.Connected
    const existing = peer('existing-peer')
    room.remoteParticipants.set(existing.identity, existing)
    room.emit(RoomEvent.ParticipantConnected, existing)
    vi.spyOn(room.localParticipant, 'publishTrack').mockResolvedValue({
      track: { stop: mocks.stop, mute: mocks.noop, unmute: mocks.noop },
    } as never)
  })
  mocks.disconnect.mockImplementation(async function (this: Room) {
    this.state = ConnectionState.Disconnected
    this.removeAllListeners()
  })
})

afterEach(() => {
  vi.useRealTimers()
  room?.removeAllListeners()
  cleanup()
  useSocketStore.getState().disconnect()
  useAuthStore.setState({ user: null, token: null })
  useAppStore.setState({ joinedVoiceChannelId: null, voiceStates: {}, voiceControls: {} })
  vi.restoreAllMocks()
})

async function join() {
  const hook = renderHook(() => useLiveKitVoice())
  const track = { kind: 'audio', enabled: true, stop: mocks.stop } as unknown as MediaStreamTrack
  await act(async () => { await hook.result.current.joinVoice('cue-channel', { preflightStream: new MediaStream([track]) }) })
  return hook
}

describe('LiveKit participant cue lifecycle', () => {
  it('hydrates existing participants silently, with only the local join confirmation', async () => {
    await join()
    expect(mocks.cue.mock.calls).toEqual([['join']])
  })

  it('keeps the actual SDK full-restart teardown and restored snapshot silent', async () => {
    await join()
    mocks.cue.mockClear()
    await act(async () => {
      // LiveKit removes participants BEFORE emitting Reconnecting. Exercise that
      // exact installed SDK ordering, not a friendlier mocked event sequence.
      const sdk = room as unknown as { handleRestarting: () => void }
      sdk.handleRestarting()
    })
    expect(room.state).toBe(ConnectionState.Reconnecting)
    expect(mocks.cue).not.toHaveBeenCalled()
    await act(async () => {
      const restored = peer('existing-peer')
      room.remoteParticipants.set(restored.identity, restored)
      room.state = ConnectionState.Connected
      room.emit(RoomEvent.Reconnected)
      room.emit(RoomEvent.ParticipantConnected, restored)
    })
    expect(mocks.cue).not.toHaveBeenCalled()
  })

  it('plays real membership transitions once, including a genuine leave and rejoin', async () => {
    await join()
    mocks.cue.mockClear()
    const newcomer = peer('new-peer')
    await act(async () => {
      room.remoteParticipants.set(newcomer.identity, newcomer)
      room.emit(RoomEvent.ParticipantConnected, newcomer)
      room.emit(RoomEvent.ParticipantConnected, newcomer)
    })
    expect(mocks.cue.mock.calls).toEqual([['join']])
    await act(async () => {
      room.remoteParticipants.delete(newcomer.identity)
      room.emit(RoomEvent.ParticipantDisconnected, newcomer, DisconnectReason.CLIENT_INITIATED)
      room.emit(RoomEvent.ParticipantDisconnected, newcomer, DisconnectReason.CLIENT_INITIATED)
    })
    expect(mocks.cue.mock.calls).toEqual([['join'], ['leave']])
    await act(async () => {
      room.remoteParticipants.set(newcomer.identity, newcomer)
      room.emit(RoomEvent.ParticipantConnected, newcomer)
    })
    expect(mocks.cue.mock.calls).toEqual([['join'], ['leave'], ['join']])
  })

  it('does not announce a remote participant who returns after a brief signal loss', async () => {
    await join()
    mocks.cue.mockClear()
    vi.useFakeTimers()
    const existing = room.remoteParticipants.get('existing-peer')!
    await act(async () => {
      room.remoteParticipants.delete(existing.identity)
      room.emit(RoomEvent.ParticipantDisconnected, existing, DisconnectReason.SIGNAL_CLOSE)
    })
    expect(mocks.cue).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1500)
      const restored = peer(existing.identity)
      room.remoteParticipants.set(restored.identity, restored)
      room.emit(RoomEvent.ParticipantConnected, restored)
    })
    act(() => vi.advanceTimersByTime(3000))
    expect(mocks.cue).not.toHaveBeenCalled()
  })

  it('announces a remote participant who does not return after the reconnect grace', async () => {
    await join()
    mocks.cue.mockClear()
    vi.useFakeTimers()
    const existing = room.remoteParticipants.get('existing-peer')!
    await act(async () => {
      room.remoteParticipants.delete(existing.identity)
      room.emit(RoomEvent.ParticipantDisconnected, existing, DisconnectReason.SIGNAL_CLOSE)
    })
    expect(mocks.cue).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(2999))
    expect(mocks.cue).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(mocks.cue.mock.calls).toEqual([['leave']])
    await act(async () => {
      const restored = peer(existing.identity)
      room.remoteParticipants.set(restored.identity, restored)
      room.emit(RoomEvent.ParticipantConnected, restored)
    })
    expect(mocks.cue.mock.calls).toEqual([['leave'], ['join']])
  })

  it('does not play a queued remote cue after leaving the room', async () => {
    const hook = await join()
    mocks.cue.mockClear()
    await act(async () => {
      const newcomer = peer('new-peer')
      room.remoteParticipants.set(newcomer.identity, newcomer)
      room.emit(RoomEvent.ParticipantConnected, newcomer)
      hook.result.current.leaveVoice({ skipLeaveSound: true })
    })
    expect(mocks.cue).not.toHaveBeenCalled()
  })

  it('keeps signaling resync and buffered duplicate membership silent', async () => {
    await join()
    mocks.cue.mockClear()
    await act(async () => {
      room.state = ConnectionState.SignalReconnecting
      room.emit(RoomEvent.SignalReconnecting)
      room.remoteParticipants.set('snapshot-peer', peer('snapshot-peer'))
      room.state = ConnectionState.Connected
      room.emit(RoomEvent.Reconnected)
      for (const participant of room.remoteParticipants.values()) room.emit(RoomEvent.ParticipantConnected, participant)
    })
    expect(mocks.cue).not.toHaveBeenCalled()
    await act(async () => {
      const departed = room.remoteParticipants.get('snapshot-peer')!
      room.remoteParticipants.delete(departed.identity)
      room.emit(RoomEvent.ParticipantDisconnected, departed, DisconnectReason.CLIENT_INITIATED)
    })
    expect(mocks.cue.mock.calls).toEqual([['leave']])
  })

  it('cancels a pending remote leave cue when the local room reconnects', async () => {
    await join()
    mocks.cue.mockClear()
    vi.useFakeTimers()
    const existing = room.remoteParticipants.get('existing-peer')!
    await act(async () => {
      room.remoteParticipants.delete(existing.identity)
      room.emit(RoomEvent.ParticipantDisconnected, existing, DisconnectReason.SIGNAL_CLOSE)
      room.state = ConnectionState.Reconnecting
      room.emit(RoomEvent.Reconnecting)
    })
    act(() => vi.advanceTimersByTime(3000))
    expect(mocks.cue).not.toHaveBeenCalled()
    await act(async () => {
      const restored = peer(existing.identity)
      room.remoteParticipants.set(restored.identity, restored)
      room.state = ConnectionState.Connected
      room.emit(RoomEvent.Reconnected)
      room.emit(RoomEvent.ParticipantConnected, restored)
    })
    expect(mocks.cue).not.toHaveBeenCalled()
  })

  it('cancels a pending remote leave cue when this user leaves the room', async () => {
    const hook = await join()
    mocks.cue.mockClear()
    vi.useFakeTimers()
    const existing = room.remoteParticipants.get('existing-peer')!
    await act(async () => {
      room.remoteParticipants.delete(existing.identity)
      room.emit(RoomEvent.ParticipantDisconnected, existing, DisconnectReason.SIGNAL_CLOSE)
      hook.result.current.leaveVoice({ skipLeaveSound: true })
    })
    act(() => vi.advanceTimersByTime(3000))
    expect(mocks.cue).not.toHaveBeenCalled()
  })

  it('ignores unknown departures and pending events from a disconnected room', async () => {
    await join()
    mocks.cue.mockClear()
    await act(async () => { room.emit(RoomEvent.ParticipantDisconnected, peer('unknown-peer')) })
    expect(mocks.cue).not.toHaveBeenCalled()
    await act(async () => {
      room.emit(RoomEvent.ParticipantDisconnected, room.remoteParticipants.get('existing-peer')!)
      room.state = ConnectionState.Disconnected
      room.emit(RoomEvent.Disconnected)
    })
    expect(mocks.cue).not.toHaveBeenCalled()
  })
})
