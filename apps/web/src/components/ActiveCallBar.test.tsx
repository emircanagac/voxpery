import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberInfo } from '../api'
import { resolveAvatarUrl } from '../api'
import type { Channel, Server, User } from '../types'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useLiveKitVoice, type UseLiveKitVoiceState } from '../webrtc/useLiveKitVoice'
import {
  GLOBAL_MUTE_SHORTCUT_EVENT,
  GLOBAL_MUTE_SHORTCUT_STORAGE_KEY,
  setGlobalMuteShortcutCaptureActive,
} from '../globalMuteShortcut'
import ActiveCallBar from './ActiveCallBar'
import { SCREEN_SHARE_CAPTURE_READY_EVENT } from '../webrtc/hooks/useLocalMedia'
import * as voiceDevices from '../voiceDevices'
import { isBrowserSupported } from 'livekit-client'

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
afterEach(() => {
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
})
import {
  markRemoteAudioTrackSource,
  setRemoteMicrophoneStreamsPlaybackMuted,
} from '../webrtc/remoteMediaControls'
import {
  getRemotePlaybackVolume,
  readRemotePlaybackVolumes,
  writePreviousScreenPlaybackVolume,
  writeRemotePlaybackVolumes,
} from '../webrtc/remotePlaybackVolume'

vi.mock('../webrtc/useLiveKitVoice', () => ({
  useLiveKitVoice: vi.fn(),
}))

vi.mock('livekit-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('livekit-client')>(),
  isBrowserSupported: vi.fn(() => true),
}))

const localUser: User = {
  id: 'user-local',
  username: 'cooluser',
  email: 'cooluser@example.test',
  email_verified: true,
  status: 'online',
}

const server: Server = {
  id: 'server-1',
  name: 'Voxpery',
  owner_id: localUser.id,
  invite_code: 'invite',
}

const voiceChannel: Channel = {
  id: 'voice-1',
  server_id: server.id,
  name: 'General',
  channel_type: 'voice',
  position: 0,
}

const members: MemberInfo[] = [
  {
    user_id: localUser.id,
    username: localUser.username,
    avatar_url: null,
    role: 'member',
    status: 'online',
    role_color: null,
  },
  {
    user_id: 'peer-1',
    username: 'admin',
    avatar_url: null,
    role: 'member',
    status: 'online',
    role_color: null,
  },
]

function mediaTrack(kind: 'audio' | 'video', id: string, flags?: Partial<MediaStreamTrack>) {
  return {
    id,
    kind,
    enabled: true,
    label: kind === 'video' ? 'screen share' : 'microphone',
    muted: false,
    readyState: 'live',
    ...flags,
  } as MediaStreamTrack
}

function mockMobileViewport(matches: boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

type MockAudioContextInstance = {
  createMediaStreamDestination: ReturnType<typeof vi.fn>
  createMediaStreamSource: ReturnType<typeof vi.fn>
  createGain: ReturnType<typeof vi.fn>
}

let restoreAudioContextMock: (() => void) | null = null

function installAudioContextMock(options: { failMediaStreamSource?: boolean } = {}): MockAudioContextInstance[] {
  const original = Object.getOwnPropertyDescriptor(window, 'AudioContext')
  const instances: MockAudioContextInstance[] = []

  class MockAudioContext {
    state: AudioContextState = 'running'
    currentTime = 0
    createMediaStreamSource = vi.fn(() => {
      if (options.failMediaStreamSource) throw new Error('Web Audio source unavailable')
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
    })
    createGain = vi.fn(() => ({
      context: this,
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
      },
    }))
    createDynamicsCompressor = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
    }))
    createMediaStreamDestination = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      stream: new MediaStream([mediaTrack('audio', 'mixed-output', { stop: vi.fn() })]),
    }))
    resume = vi.fn(async () => { this.state = 'running' })
    suspend = vi.fn(async () => { this.state = 'suspended' })
    close = vi.fn(async () => { this.state = 'closed' })

    constructor() {
      instances.push(this)
    }
  }

  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: MockAudioContext,
  })
  restoreAudioContextMock = () => {
    if (original) Object.defineProperty(window, 'AudioContext', original)
    else delete (window as Window & { AudioContext?: typeof AudioContext }).AudioContext
  }
  return instances
}

function voiceState(overrides?: Record<string, unknown>): UseLiveKitVoiceState {
  return {
    joinedChannelId: voiceChannel.id,
    isJoining: false,
    localStream: new MediaStream([mediaTrack('audio', 'local-mic')]),
    screenStream: null,
    isScreenSharing: false,
    cameraStream: null,
    cameraFacingMode: 'user',
    canSwitchCamera: false,
    remoteStreams: new Map<string, MediaStream>(),
    remoteScreenTrackIds: new Set<string>(),
    watchedRemoteScreenPeerIds: new Set<string>(),
    pingMs: 7,
    lastError: null,
    livekit: {
      roomState: 'connected',
      participants: 2,
      remoteStreams: 0,
    },
    diagnostics: {
      enabled: false,
      voiceMode: 'voice_activity',
      wsPingMs: null,
      rtcPingMs: null,
      packetLossPct: null,
      jitterMs: null,
      pingJitterMs: null,
    },
    ...overrides,
  }
}

function renderActiveCallBar(
  overrides?: Record<string, unknown>,
  options: { activeChannelId?: string | null } = {},
) {
  const setRemoteMicrophonePlaybackMuted = vi.fn<(muted: boolean) => void>()
  const voice = {
    state: voiceState(overrides),
    joinVoice: vi.fn(),
    moveVoice: vi.fn().mockResolvedValue(undefined),
    leaveVoice: vi.fn(),
    startScreenShare: vi.fn().mockResolvedValue({ hasAudio: true, audioPublished: true }),
    stopScreenShare: vi.fn(),
    startCamera: vi.fn(),
    stopCamera: vi.fn(),
    switchCamera: vi.fn().mockResolvedValue(undefined),
    setVoiceControls: vi.fn(),
    setRemoteMicrophonePlaybackMuted,
    setRemoteMediaSubscribed: vi.fn(),
    playVoiceCue: vi.fn(),
  }
  setRemoteMicrophonePlaybackMuted.mockImplementation((muted) => {
    setRemoteMicrophoneStreamsPlaybackMuted(voice.state.remoteStreams.values(), muted)
  })

  vi.mocked(useLiveKitVoice).mockReturnValue(voice as unknown as ReturnType<typeof useLiveKitVoice>)

  const result = render(
    <MemoryRouter>
      <ActiveCallBar
        selectedVoiceChannelId={voiceChannel.id}
        activeChannelId={options.activeChannelId ?? voiceChannel.id}
      />
    </MemoryRouter>
  )

  return { ...result, voice }
}

describe('ActiveCallBar regressions', () => {
  it.each([
    { message: 'WebSocket is not connected', title: 'Voice service reconnecting' },
    { message: 'CONNECTION_ERROR: token request failed', title: 'Voice server unreachable' },
  ])(
    'reports each explicit retry of the same connection failure: $message',
    async ({ message, title }) => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
      const capture = vi.spyOn(voiceDevices, 'getPreferredMicrophoneStream')
        .mockImplementation(async () => new MediaStream([new MediaStreamTrack()]))
      try {
        const { voice } = renderActiveCallBar({ joinedChannelId: null, localStream: null })
        voice.joinVoice.mockRejectedValue(new Error(message))
        const join = (window as Window & { __voxperyJoinVoice?: (id: string) => Promise<void> }).__voxperyJoinVoice!
        await act(async () => { await expect(join(voiceChannel.id)).rejects.toThrow(message) })
        const firstToast = useToastStore.getState().toasts[0]
        expect(firstToast.title).toBe(title)
        act(() => useToastStore.getState().dismissToast(firstToast.id))
        expect(useToastStore.getState().toasts).toHaveLength(0)

        await act(async () => { await expect(join(voiceChannel.id)).rejects.toThrow(message) })
        expect(voice.joinVoice).toHaveBeenCalledTimes(2)
        expect(useToastStore.getState().toasts).toHaveLength(1)
        const retryToast = useToastStore.getState().toasts[0]
        expect(retryToast.title).toBe(title)
        expect(retryToast.id).not.toBe(firstToast.id)

        await act(async () => { await expect(join(voiceChannel.id)).rejects.toThrow(message) })
        expect(voice.joinVoice).toHaveBeenCalledTimes(3)
        expect(useToastStore.getState().toasts).toHaveLength(1)
        expect(useToastStore.getState().toasts[0].id).toBe(retryToast.id)
      } finally {
        capture.mockRestore()
      }
    },
  )

  it('keeps microphone denial visible and retries the original channel only on user action', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
    const stream = new MediaStream([new MediaStreamTrack()])
    const capture = vi.spyOn(voiceDevices, 'getPreferredMicrophoneStream')
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce(stream)
    const { voice } = renderActiveCallBar({ joinedChannelId: null, localStream: null })
    const join = (window as Window & { __voxperyJoinVoice?: (id: string) => Promise<void> }).__voxperyJoinVoice!
    await act(async () => { await expect(join('voice-retry-target')).rejects.toThrow('Denied') })
    expect(screen.getByRole('alert', { name: 'Microphone access required' })).toBeVisible()
    expect(capture).toHaveBeenCalledTimes(1)
    expect(voice.joinVoice).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(voice.joinVoice).toHaveBeenCalledWith('voice-retry-target', { preflightStream: stream }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    capture.mockRestore()
  })

  it('blocks duplicate captures and stops a capture that resolves after unmount', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
    let grant!: (stream: MediaStream) => void
    const capture = vi.spyOn(voiceDevices, 'getPreferredMicrophoneStream').mockImplementation(() => new Promise((resolve) => { grant = resolve }))
    const stream = new MediaStream([new MediaStreamTrack()])
    const stop = vi.spyOn(stream.getAudioTracks()[0], 'stop')
    const { voice, unmount } = renderActiveCallBar({ joinedChannelId: null, localStream: null })
    const join = (window as Window & { __voxperyJoinVoice?: (id: string) => Promise<void> }).__voxperyJoinVoice!
    let pending!: Promise<void>
    act(() => { pending = join('voice-1') })
    await expect(join('voice-2')).rejects.toThrow('already in progress')
    unmount()
    await act(async () => { grant(stream); await pending })
    expect(stop).toHaveBeenCalled()
    expect(voice.joinVoice).not.toHaveBeenCalled()
    capture.mockRestore()
  })

  it('reports unsupported WebRTC before asking for microphone permission', async () => {
    vi.mocked(isBrowserSupported).mockReturnValueOnce(false)
    const capture = vi.spyOn(voiceDevices, 'getPreferredMicrophoneStream')
    renderActiveCallBar({ joinedChannelId: null, localStream: null })
    const join = (window as Window & { __voxperyJoinVoice?: (id: string) => Promise<void> }).__voxperyJoinVoice!
    await act(async () => { await expect(join('voice-1')).rejects.toThrow('WebRTC') })
    expect(capture).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert', { name: 'Microphone access required' })).not.toBeInTheDocument()
    capture.mockRestore()
  })

  it('does not join an obsolete channel when capture resolves after navigation', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
    let grant!: (stream: MediaStream) => void
    const capture = vi.spyOn(voiceDevices, 'getPreferredMicrophoneStream').mockImplementation(() => new Promise((resolve) => { grant = resolve }))
    const stream = new MediaStream([new MediaStreamTrack()])
    const stop = vi.spyOn(stream.getAudioTracks()[0], 'stop')
    const { voice } = renderActiveCallBar({ joinedChannelId: null, localStream: null })
    const join = (window as Window & { __voxperyJoinVoice?: (id: string) => Promise<void> }).__voxperyJoinVoice!
    let pending!: Promise<void>
    act(() => { pending = join(voiceChannel.id) })
    act(() => useAppStore.getState().setActiveChannel('another-channel'))
    await act(async () => { grant(stream); await pending })
    expect(stop).toHaveBeenCalled()
    expect(voice.joinVoice).not.toHaveBeenCalled()
    capture.mockRestore()
  })
  it('prepares voice controls without a stream or joining and restores the previous mute choice after deafen', () => {
    const { voice, container } = renderActiveCallBar({ joinedChannelId: null, localStream: null })
    expect(screen.getByRole('group', { name: 'Voice preferences' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Voice preferences' })).toHaveClass('callbar-frame')
    expect(screen.getByText('Not in voice')).toBeVisible()
    expect(container.querySelector('.active-call-bar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Turn on camera' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share screen' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }))
    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(true, false, false)
    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))
    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(true, true, false)
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toHaveClass('is-off')
    expect(screen.getByRole('button', { name: 'Undeafen' })).toHaveClass('is-off')
    fireEvent.click(screen.getByRole('button', { name: 'Undeafen' }))
    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(true, false, false)
    fireEvent.click(screen.getByRole('button', { name: 'Unmute microphone' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undeafen' }))
    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(false, false, false)
    expect(voice.joinVoice).not.toHaveBeenCalled()
    expect(voice.startCamera).not.toHaveBeenCalled()
    expect(voice.startScreenShare).not.toHaveBeenCalled()
  })

  it('keeps pre-join deafen and mute across connection and disconnection', async () => {
    const { voice, rerender } = renderActiveCallBar({ joinedChannelId: null, localStream: null })
    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))
    const mic = mediaTrack('audio', 'joined-muted-mic')
    voice.state.joinedChannelId = voiceChannel.id
    voice.state.localStream = new MediaStream([mic])
    rerender(<MemoryRouter><ActiveCallBar selectedVoiceChannelId={voiceChannel.id} activeChannelId={voiceChannel.id} /></MemoryRouter>)
    expect(mic.enabled).toBe(false)
    expect(screen.queryByText('Not in voice')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undeafen' }).closest('.active-call-bar')).toHaveClass('callbar-frame')
    expect(screen.getByRole('button', { name: 'Undeafen' })).toHaveClass('is-off')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Leave voice channel' })) })
    expect(voice.leaveVoice).toHaveBeenCalledOnce()
    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(true, true, false)
    voice.state.joinedChannelId = null
    voice.state.localStream = null
    rerender(<MemoryRouter><ActiveCallBar selectedVoiceChannelId={voiceChannel.id} activeChannelId={voiceChannel.id} /></MemoryRouter>)
    expect(screen.getByText('Not in voice')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Undeafen' }))
    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(false, false, false)
  })

  it('locks audio preferences while joining to avoid changing the capture mid-connection', () => {
    localStorage.setItem(GLOBAL_MUTE_SHORTCUT_STORAGE_KEY, 'F9')
    const { voice } = renderActiveCallBar({ joinedChannelId: null, localStream: null, isJoining: true })
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deafen' })).toBeDisabled()
    expect(screen.queryByText('Not in voice')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { code: 'F9' })
    fireEvent(window, new Event(GLOBAL_MUTE_SHORTCUT_EVENT))
    expect(voice.setVoiceControls).not.toHaveBeenCalled()
  })

  afterEach(() => {
    restoreAudioContextMock?.()
    restoreAudioContextMock = null
  })

  beforeEach(() => {
    localStorage.clear()
    setGlobalMuteShortcutCaptureActive(false)
    vi.clearAllMocks()
    mockMobileViewport(false)
    useToastStore.setState({ toasts: [] })
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    useAuthStore.setState({
      token: 'token',
      user: localUser,
      loggingOut: false,
    })
    useAppStore.setState({
      servers: [server],
      channels: [voiceChannel],
      channelsByServerId: { [server.id]: [voiceChannel] },
      members,
      voiceStates: {
        [localUser.id]: voiceChannel.id,
        'peer-1': voiceChannel.id,
      },
      voiceControls: {},
      voiceSpeakingUserIds: [],
      voiceLocalSpeaking: false,
    })
  })

  it('requires an explicit action before subscribing to an available screen share', () => {
    useAppStore.getState().setVoiceControl('peer-1', false, false, true)

    const { voice } = renderActiveCallBar()

    fireEvent.click(screen.getByRole('button', { name: 'Watch stream' }))

    expect(voice.setRemoteMediaSubscribed).toHaveBeenCalledWith('peer-1', 'screen', true)
  })

  it('stops only the viewer subscription for a watched screen share', () => {
    const screenTrack = mediaTrack('video', 'screen-track')
    const remoteStream = new MediaStream([screenTrack])

    const { voice } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', remoteStream]]),
      remoteScreenTrackIds: new Set(['screen-track']),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })

    fireEvent.click(screen.getByTitle('Stop watching'))

    expect(voice.setRemoteMediaSubscribed).toHaveBeenCalledWith('peer-1', 'screen', false)
    expect(voice.leaveVoice).not.toHaveBeenCalled()
  })

  it('keeps a watched screen share available as a mini player outside the voice view', () => {
    const screenTrack = mediaTrack('video', 'screen-track')
    const { container, voice, rerender } = renderActiveCallBar(
      {
        remoteStreams: new Map([['peer-1', new MediaStream([screenTrack])]]),
        remoteScreenTrackIds: new Set(['screen-track']),
        watchedRemoteScreenPeerIds: new Set(['peer-1']),
      },
      { activeChannelId: 'text-1' },
    )

    expect(container.querySelector('.screen-share-stage')).toBeNull()
    expect(screen.getByRole('button', { name: "Return to admin's stream" })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: "Return to admin's stream" }))
    expect(useAppStore.getState().activeChannelId).toBe(voiceChannel.id)

    rerender(
      <MemoryRouter>
        <ActiveCallBar selectedVoiceChannelId={voiceChannel.id} activeChannelId={voiceChannel.id} />
      </MemoryRouter>,
    )
    expect(container.querySelector('.screen-share-stage')).toHaveClass('screen-share-stage--theater')
    expect(voice.setRemoteMediaSubscribed).not.toHaveBeenCalled()
  })

  it.each(['screen', 'camera', 'both'] as const)('replaces the remote empty avatar with %s media without changing participant count', (mode) => {
    const tracks = [
      ...(mode !== 'camera' ? [mediaTrack('video', 'screen-track')] : []),
      ...(mode !== 'screen' ? [mediaTrack('video', 'camera-track', { label: 'webcam' })] : []),
    ]
    const { container, voice } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', new MediaStream(tracks)]]),
      remoteScreenTrackIds: new Set(['screen-track']),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })
    const stage = container.querySelector('.screen-share-stage')!
    expect(stage).toHaveAttribute('data-participant-count', '2')
    expect(stage.querySelectorAll('.voice-stage-tile')).toHaveLength(1)
    expect(stage.querySelectorAll('.voice-stage-share-tile')).toHaveLength(mode === 'both' ? 2 : 1)
    expect(stage.querySelector('.voice-stage-tile')).toHaveTextContent('cooluser')
    expect(voice.setRemoteMediaSubscribed).not.toHaveBeenCalled()
  })

  it('represents an unwatched stream by its available card rather than another empty avatar', () => {
    useAppStore.setState({ members: members.map(member => ({ ...member, avatar_url: member.user_id === 'peer-1' ? 'https://example.test/admin-avatar.png' : null })) })
    useAppStore.getState().setVoiceControl('peer-1', false, false, true)
    const { container } = renderActiveCallBar()
    expect(container.querySelectorAll('.voice-stage-tile')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Watch stream' })).toBeVisible()
    expect(screen.getByRole('img', { name: "admin's profile" })).toHaveAttribute('src', resolveAvatarUrl('https://example.test/admin-avatar.png'))
    expect(container.querySelector('.screen-share-stage')).toHaveAttribute('data-participant-count', '2')
  })

  it('retains the camera owner photo when hiding camera, without restoring a duplicate card', () => {
    useAppStore.setState({ members: members.map(member => ({ ...member, avatar_url: member.user_id === 'peer-1' ? 'https://example.test/admin-avatar.png' : null })) })
    const { container } = renderActiveCallBar({ remoteStreams: new Map([['peer-1', new MediaStream([mediaTrack('video', 'camera-track', { label: 'webcam' })])]]) })
    expect(screen.getByRole('img', { name: "admin's profile" })).toHaveAttribute('src', resolveAvatarUrl('https://example.test/admin-avatar.png'))
    fireEvent.click(screen.getByTitle('Hide camera'))
    expect(container.querySelector('.voice-stage-hidden-media-tile')).toHaveTextContent('Camera hidden')
    expect(screen.getByRole('img', { name: "admin's profile" })).toHaveAttribute('src', resolveAvatarUrl('https://example.test/admin-avatar.png'))
    expect(container.querySelectorAll('.voice-stage-tile')).toHaveLength(1)
  })

  it('restores the remote avatar when the last media track stops', () => {
    const { container, voice, rerender } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', new MediaStream([mediaTrack('video', 'screen-track')])]]),
      remoteScreenTrackIds: new Set(['screen-track']),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })
    expect(container.querySelectorAll('.voice-stage-tile')).toHaveLength(1)
    voice.state = voiceState() as typeof voice.state
    rerender(<MemoryRouter><ActiveCallBar selectedVoiceChannelId={voiceChannel.id} activeChannelId={voiceChannel.id} /></MemoryRouter>)
    expect(container.querySelectorAll('.voice-stage-tile')).toHaveLength(2)
    expect(container.querySelector('.screen-share-stage')).toHaveAttribute('data-participant-count', '2')
  })

  it.each([false, true])('does not duplicate the local sharing user with camera enabled: %s', (camera) => {
    const { container } = renderActiveCallBar({
      isScreenSharing: true,
      screenStream: new MediaStream([mediaTrack('video', 'local-screen')]),
      cameraStream: camera ? new MediaStream([mediaTrack('video', 'local-camera', { label: 'webcam' })]) : null,
    })
    const stage = container.querySelector('.screen-share-stage')!
    expect(stage.querySelectorAll('.voice-stage-tile')).toHaveLength(1)
    expect(stage.querySelector('.voice-stage-tile')).toHaveTextContent('admin')
    expect(stage.querySelectorAll('.voice-stage-share-tile')).toHaveLength(camera ? 2 : 1)
    expect(stage).toHaveAttribute('data-participant-count', '2')
  })

  it('removes the mini player immediately when the viewer stops watching', () => {
    const screenTrack = mediaTrack('video', 'screen-track')
    const { voice } = renderActiveCallBar(
      {
        remoteStreams: new Map([['peer-1', new MediaStream([screenTrack])]]),
        remoteScreenTrackIds: new Set(['screen-track']),
        watchedRemoteScreenPeerIds: new Set(['peer-1']),
      },
      { activeChannelId: 'text-1' },
    )

    fireEvent.click(screen.getByRole('button', { name: "Stop watching admin's screen share" }))

    expect(voice.setRemoteMediaSubscribed).toHaveBeenCalledWith('peer-1', 'screen', false)
    expect(screen.queryByRole('button', { name: "Return to admin's stream" })).toBeNull()
  })

  it('shows only current channel viewers on an active screen share', () => {
    const screenTrack = mediaTrack('video', 'screen-track')
    useAppStore.setState({
      screenShareViewerIdsByPublisherId: {
        'peer-1': [localUser.id],
      },
    })

    renderActiveCallBar({
      remoteStreams: new Map([['peer-1', new MediaStream([screenTrack])]]),
      remoteScreenTrackIds: new Set(['screen-track']),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })

    expect(screen.getByRole('status', { name: 'Watching: cooluser' })).toBeVisible()

    act(() => {
      useAppStore.getState().clearScreenShareViewerMembership(localUser.id)
    })

    expect(screen.queryByRole('status', { name: 'Watching: cooluser' })).not.toBeInTheDocument()
  })

  it('focuses a watched screen share in the in-app theater view without changing its subscription', () => {
    const screenTrack = mediaTrack('video', 'screen-track')
    const remoteStream = new MediaStream([screenTrack])
    const { container, voice } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', remoteStream]]),
      remoteScreenTrackIds: new Set(['screen-track']),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Focus stream' }))

    expect(container.querySelector('.screen-share-stage')).toHaveClass('screen-share-stage--theater')
    expect(container.querySelector('.remote-screen-preview')).toHaveClass('is-theater-focused')
    expect(voice.setRemoteMediaSubscribed).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Exit focus view' }))

    expect(container.querySelector('.screen-share-stage')).not.toHaveClass('screen-share-stage--theater')
    expect(container.querySelector('.remote-screen-preview')).not.toHaveClass('is-theater-focused')
  })

  it('switches directly from browser fullscreen to the in-app focus view', () => {
    const screenTrack = mediaTrack('video', 'screen-track')
    const { container } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', new MediaStream([screenTrack])]]),
      remoteScreenTrackIds: new Set(['screen-track']),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })
    const tile = container.querySelector('.remote-screen-preview') as HTMLElement

    expect(screen.getByRole('button', { name: 'Focus stream' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeVisible()

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: tile })
    fireEvent(document, new Event('fullscreenchange'))
    const exitFullscreen = vi.fn().mockImplementation(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
      fireEvent(document, new Event('fullscreenchange'))
    })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })

    expect(screen.getByRole('button', { name: 'Switch to focus view' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to focus view' }))

    expect(exitFullscreen).toHaveBeenCalledOnce()
    expect(container.querySelector('.screen-share-stage')).toHaveClass('screen-share-stage--theater')
    expect(container.querySelector('.remote-screen-preview')).toHaveClass('is-theater-focused')
    expect(screen.getByRole('button', { name: 'Exit focus view' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeVisible()
  })

  it('switches an existing voice session without starting a new microphone preflight', async () => {
    const { voice } = renderActiveCallBar({ joinedChannelId: voiceChannel.id })
    const exposedJoin = (window as Window & {
      __voxperyJoinVoice?: (channelId: string) => Promise<void>
    }).__voxperyJoinVoice

    expect(exposedJoin).toBeDefined()
    await act(async () => {
      await exposedJoin?.('voice-destination')
    })

    expect(voice.moveVoice).toHaveBeenCalledWith('voice-destination')
    expect(voice.joinVoice).not.toHaveBeenCalled()
  })

  it('keeps user volume and stream mute state independent', async () => {
    const micTrack = mediaTrack('audio', 'peer-mic')
    const screenAudioTrack = mediaTrack('audio', 'peer-screen-audio')
    const screenTrack = mediaTrack('video', 'peer-screen-video')
    markRemoteAudioTrackSource(micTrack, 'voice')
    markRemoteAudioTrackSource(screenAudioTrack, 'screen')
    writeRemotePlaybackVolumes({
      'voice:peer-1': 200,
      'screen:peer-1': 0,
    })
    writePreviousScreenPlaybackVolume('peer-1', 40)

    renderActiveCallBar({
      remoteStreams: new Map([['peer-1', new MediaStream([micTrack, screenAudioTrack, screenTrack])]]),
      remoteScreenTrackIds: new Set(['peer-screen-video']),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })

    expect(screen.getByTitle('Unmute')).toBeVisible()
    writeRemotePlaybackVolumes({
      ...readRemotePlaybackVolumes(),
      'voice:peer-1': 25,
    })
    expect(screen.getByTitle('Unmute')).toBeVisible()
    let volumes = readRemotePlaybackVolumes()
    expect(getRemotePlaybackVolume(volumes, 'voice', 'peer-1')).toBe(25)
    expect(getRemotePlaybackVolume(volumes, 'screen', 'peer-1')).toBe(0)

    fireEvent.click(screen.getByTitle('Unmute'))
    volumes = readRemotePlaybackVolumes()
    expect(getRemotePlaybackVolume(volumes, 'voice', 'peer-1')).toBe(25)
    expect(getRemotePlaybackVolume(volumes, 'screen', 'peer-1')).toBe(40)
  })

  it('uses an isolated preview stream for the local screen share', () => {
    const localScreen = new MediaStream([mediaTrack('video', 'local-screen')])
    const { container } = renderActiveCallBar({
      screenStream: localScreen,
      isScreenSharing: true,
    })

    const preview = container.querySelector('[data-fullscreen-key="screen"] video') as HTMLVideoElement
    expect(preview.srcObject).toBeInstanceOf(MediaStream)
    expect(preview.srcObject).not.toBe(localScreen)
    expect((preview.srcObject as MediaStream).getVideoTracks()).toEqual(localScreen.getVideoTracks())
  })

  it('reasserts remote microphone playback after the macOS share picker returns', async () => {
    const remoteMic = mediaTrack('audio', 'peer-mic')
    const remoteStream = new MediaStream([remoteMic])
    const play = vi.mocked(HTMLMediaElement.prototype.play)

    renderActiveCallBar({
      remoteStreams: new Map([['peer-1', remoteStream]]),
    })
    await act(async () => {
      await Promise.resolve()
    })
    play.mockClear()

    window.dispatchEvent(new Event(SCREEN_SHARE_CAPTURE_READY_EVENT))

    expect(play).toHaveBeenCalledOnce()
  })

  it('plays distinct confirmations when local camera and screen sharing start', async () => {
    const { voice } = renderActiveCallBar()

    fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Turn on camera' }).at(-1)!)
    await waitFor(() => expect(voice.playVoiceCue).toHaveBeenCalledWith('camera-start'))

    fireEvent.click(screen.getByRole('button', { name: 'Share screen' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Share screen' }).at(-1)!)
    await waitFor(() => expect(voice.playVoiceCue).toHaveBeenCalledWith('screen-start'))
  })

  it('treats an intentionally silent screen share as a valid session', async () => {
    const { voice } = renderActiveCallBar()
    voice.startScreenShare.mockResolvedValueOnce({ hasAudio: false, audioPublished: false })

    fireEvent.click(screen.getByRole('button', { name: 'Share screen' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Share screen' }).at(-1)!)

    await waitFor(() => expect(voice.startScreenShare).toHaveBeenCalledOnce())
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('plays separate confirmations when local camera and screen sharing stop', () => {
    const cameraTrack = mediaTrack('video', 'local-camera')
    const screenTrack = mediaTrack('video', 'local-screen')
    const { voice } = renderActiveCallBar({
      cameraStream: new MediaStream([cameraTrack]),
      screenStream: new MediaStream([screenTrack]),
      isScreenSharing: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Turn off camera' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))

    expect(voice.stopCamera).toHaveBeenCalledOnce()
    expect(voice.stopScreenShare).toHaveBeenCalledOnce()
    expect(voice.playVoiceCue).toHaveBeenCalledWith('camera-stop')
    expect(voice.playVoiceCue).toHaveBeenCalledWith('screen-stop')
  })

  it('switches between available mobile cameras without stopping the camera', async () => {
    mockMobileViewport(true)
    const cameraTrack = mediaTrack('video', 'local-camera')
    const { voice } = renderActiveCallBar({
      cameraStream: new MediaStream([cameraTrack]),
      cameraFacingMode: 'user',
      canSwitchCamera: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Switch to rear camera' }))

    await waitFor(() => expect(voice.switchCamera).toHaveBeenCalledOnce())
    expect(voice.stopCamera).not.toHaveBeenCalled()
  })

  it('keeps mute, deafen, and leave controls wired to the joined voice session', () => {
    const localMic = mediaTrack('audio', 'local-mic')
    const { voice } = renderActiveCallBar({
      localStream: new MediaStream([localMic]),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }))

    expect(localMic.enabled).toBe(false)
    expect(voice.setVoiceControls).toHaveBeenCalledWith(true, false, false)
    expect(voice.playVoiceCue).toHaveBeenCalledWith('mute')

    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))

    expect(voice.setVoiceControls).toHaveBeenCalledWith(true, true, false)
    expect(voice.playVoiceCue).toHaveBeenCalledWith('deafen')

    fireEvent.click(screen.getByRole('button', { name: 'Leave voice channel' }))

    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(true, true, false)
    expect(voice.setVoiceControls).toHaveBeenCalledTimes(2)
    expect(voice.leaveVoice).toHaveBeenCalledOnce()
  })

  it('deafens remote microphones without muting watched screen audio', () => {
    const micTrack = mediaTrack('audio', 'peer-mic')
    const screenAudioTrack = mediaTrack('audio', 'peer-screen-audio')
    markRemoteAudioTrackSource(micTrack, 'voice')
    markRemoteAudioTrackSource(screenAudioTrack, 'screen')

    const { container } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', new MediaStream([micTrack, screenAudioTrack])]]),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })

    const voiceAudio = container.querySelector('audio[data-remote-audio-kind="mic"]') as HTMLAudioElement | null
    const screenAudio = container.querySelector('audio[data-remote-audio-kind="screen"]') as HTMLAudioElement | null
    if (!voiceAudio || !screenAudio) throw new Error('Remote audio playback elements were not rendered.')

    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))

    expect(voiceAudio.muted).toBe(true)
    expect(screenAudio.muted).toBe(false)
  })

  it('immediately mutes native microphone playback while keeping watched screen audio active', () => {
    const audioContexts = installAudioContextMock()
    const micTrack = mediaTrack('audio', 'peer-mic')
    const screenAudioTrack = mediaTrack('audio', 'peer-screen-audio')
    markRemoteAudioTrackSource(micTrack, 'voice')
    markRemoteAudioTrackSource(screenAudioTrack, 'screen')

    const { container } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', new MediaStream([micTrack, screenAudioTrack])]]),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })

    expect(audioContexts).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))

    const microphoneOutput = container.querySelector('audio[data-remote-audio-kind="mic"]') as HTMLAudioElement | null
    const screenOutput = container.querySelector('audio[data-remote-audio-kind="screen"]') as HTMLAudioElement | null
    expect(microphoneOutput?.muted).toBe(true)
    expect(screenOutput?.muted).toBe(false)
  })

  it('starts microphone tracks that arrive while deafened at zero gain', () => {
    const audioContexts = installAudioContextMock()
    const { voice, rerender } = renderActiveCallBar()

    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))

    const reconnectingMic = mediaTrack('audio', 'peer-reconnected-mic')
    markRemoteAudioTrackSource(reconnectingMic, 'voice')
    voice.state = voiceState({
      remoteStreams: new Map([['peer-1', new MediaStream([reconnectingMic])]]),
    })
    rerender(
      <MemoryRouter>
        <ActiveCallBar
          selectedVoiceChannelId={voiceChannel.id}
          activeChannelId={voiceChannel.id}
        />
      </MemoryRouter>
    )

    expect(audioContexts).toHaveLength(0)
    const remoteMic = document.querySelector('audio[data-remote-audio-kind="mic"]') as HTMLAudioElement | null
    expect(remoteMic?.muted).toBe(true)
  })

  it('keeps a previously muted microphone suppressed when the same track unmutes after deafen', () => {
    const micTrack = mediaTrack('audio', 'peer-muted-mic', { muted: true })
    markRemoteAudioTrackSource(micTrack, 'voice')
    const remoteStream = new MediaStream([micTrack])
    const { voice, rerender, container } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', remoteStream]]),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))
    expect(micTrack.enabled).toBe(false)

    Object.assign(micTrack, { muted: false, enabled: true })
    voice.state = voiceState({
      remoteStreams: new Map([['peer-1', remoteStream]]),
    })
    rerender(
      <MemoryRouter>
        <ActiveCallBar
          selectedVoiceChannelId={voiceChannel.id}
          activeChannelId={voiceChannel.id}
        />
      </MemoryRouter>
    )

    const remoteMic = container.querySelector('audio[data-remote-audio-kind="mic"]') as HTMLAudioElement | null
    expect(micTrack.enabled).toBe(false)
    expect(remoteMic?.muted).toBe(true)
    expect(voice.setRemoteMicrophonePlaybackMuted).toHaveBeenLastCalledWith(true)
  })

  it('hides remote speaking indicators while locally deafened and restores them on undeafen', () => {
    useAppStore.setState({ voiceSpeakingUserIds: ['peer-1'] })

    const { container } = renderActiveCallBar()
    const remoteTile = screen.getByText('admin').closest('.voice-stage-tile')
    expect(remoteTile?.querySelector('.voice-stage-avatar')).toHaveClass('is-speaking')
    expect(remoteTile?.querySelector('.voice-stage-name')).toHaveClass('is-speaking')

    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))

    expect(remoteTile?.querySelector('.voice-stage-avatar')).not.toHaveClass('is-speaking')
    expect(remoteTile?.querySelector('.voice-stage-name')).not.toHaveClass('is-speaking')
    expect(useAppStore.getState().voiceSpeakingUserIds).toEqual(['peer-1'])

    fireEvent.click(screen.getByRole('button', { name: 'Undeafen' }))

    expect(container.querySelector('.voice-stage-avatar.is-speaking')).not.toBeNull()
    expect(remoteTile?.querySelector('.voice-stage-name')).toHaveClass('is-speaking')
  })

  it('uses a stable scrollable grid for crowded voice stages', () => {
    const crowdedMembers = Array.from({ length: 7 }, (_, index) => ({
      user_id: index === 0 ? localUser.id : `peer-${index}`,
      username: index === 0 ? localUser.username : `peer${index}`,
      avatar_url: null,
      role: 'member',
      status: 'online',
      role_color: null,
    }))
    useAppStore.setState({
      members: crowdedMembers,
      voiceStates: Object.fromEntries(crowdedMembers.map((member) => [member.user_id, voiceChannel.id])),
    })

    const { container } = renderActiveCallBar()
    const stage = container.querySelector('.screen-share-stage')
    expect(stage).toHaveAttribute('data-stage-density', 'crowded')
    expect(stage).toHaveAttribute('data-stage-columns', '3')
    expect(stage?.querySelectorAll('.voice-stage-tile')).toHaveLength(7)
  })

  it('uses a four-column dense grid for large voice stages', () => {
    const crowdedMembers = Array.from({ length: 12 }, (_, index) => ({
      user_id: index === 0 ? localUser.id : `peer-${index}`,
      username: index === 0 ? localUser.username : `peer${index}`,
      avatar_url: null,
      role: 'member',
      status: 'online',
      role_color: null,
    }))
    useAppStore.setState({
      members: crowdedMembers,
      voiceStates: Object.fromEntries(crowdedMembers.map((member) => [member.user_id, voiceChannel.id])),
    })

    const { container } = renderActiveCallBar()
    const stage = container.querySelector('.screen-share-stage')

    expect(stage).toHaveAttribute('data-stage-density', 'dense')
    expect(stage).toHaveAttribute('data-stage-columns', '4')
    expect(stage?.querySelectorAll('.voice-stage-tile')).toHaveLength(12)
  })

  it('keeps five remote voices and watched screen audio stable across speaking changes', () => {
    const audioContexts = installAudioContextMock()
    const sharerMic = mediaTrack('audio', 'peer-1-mic')
    const screenAudio = mediaTrack('audio', 'peer-screen-audio')
    markRemoteAudioTrackSource(sharerMic, 'voice')
    markRemoteAudioTrackSource(screenAudio, 'screen')
    const additionalPeerTracks = Array.from({ length: 4 }, (_, index) => {
      const track = mediaTrack('audio', `peer-${index + 2}-mic`)
      markRemoteAudioTrackSource(track, 'voice')
      return track
    })
    const play = vi.mocked(HTMLMediaElement.prototype.play)

    useAppStore.setState({
      members: [
        ...members,
        ...additionalPeerTracks.map((_, index) => ({
          user_id: `peer-${index + 2}`,
          username: `viewer-${index + 2}`,
          avatar_url: null,
          role: 'member',
          status: 'online',
          role_color: null,
        })),
      ],
      voiceStates: {
        [localUser.id]: voiceChannel.id,
        'peer-1': voiceChannel.id,
        ...Object.fromEntries(additionalPeerTracks.map((_, index) => [
          `peer-${index + 2}`,
          voiceChannel.id,
        ])),
      },
    })

    const { container } = renderActiveCallBar({
      remoteStreams: new Map<string, MediaStream>([
        ['peer-1', new MediaStream([sharerMic, screenAudio])],
        ...additionalPeerTracks.map((track, index) => [
          `peer-${index + 2}`,
          new MediaStream([track]),
        ] as [string, MediaStream]),
      ]),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
      livekit: {
        roomState: 'connected',
        participants: 6,
        remoteStreams: 5,
      },
    })
    expect(audioContexts).toHaveLength(0)
    const sourceElements = Array.from(container.querySelectorAll<HTMLAudioElement>(
      'audio[data-remote-audio-kind="mic"], audio[data-peer-id="peer-1"][data-remote-audio-kind="screen"]',
    ))
    expect(sourceElements).toHaveLength(6)
    expect(sourceElements.every((element) => element.srcObject instanceof MediaStream && !element.muted)).toBe(true)
    expect(sourceElements.every((element) => play.mock.instances.includes(element))).toBe(true)
    const initialOutputStreams = sourceElements.map((element) => element.srcObject)
    play.mockClear()

    act(() => useAppStore.getState().setVoiceSpeaking(['peer-2', 'peer-3'], false))
    act(() => useAppStore.getState().setVoiceSpeaking(['peer-1', 'peer-2', 'peer-5'], true))
    act(() => useAppStore.getState().setVoiceSpeaking([], false))

    expect(play).not.toHaveBeenCalled()
    expect(sourceElements.map((element) => element.srcObject)).toEqual(initialOutputStreams)
  })

  it('starts newly watched screen audio only once while subscription state settles', async () => {
    installAudioContextMock()
    const screenAudio = mediaTrack('audio', 'peer-screen-audio')
    markRemoteAudioTrackSource(screenAudio, 'screen')
    const play = vi.mocked(HTMLMediaElement.prototype.play)
    let resolvePlayback!: () => void
    play.mockImplementation(() => new Promise<void>((resolve) => {
      resolvePlayback = resolve
    }))
    const remoteStream = new MediaStream([screenAudio])

    const { voice, rerender } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', remoteStream]]),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })

    expect(play).toHaveBeenCalledOnce()
    for (let update = 0; update < 3; update += 1) {
      voice.state = voiceState({
        remoteStreams: new Map([['peer-1', new MediaStream([screenAudio])]]),
        watchedRemoteScreenPeerIds: new Set(['peer-1']),
      })
      rerender(
        <MemoryRouter>
          <ActiveCallBar
            selectedVoiceChannelId={voiceChannel.id}
            activeChannelId={voiceChannel.id}
          />
        </MemoryRouter>
      )
    }

    expect(play).toHaveBeenCalledOnce()
    await act(async () => {
      resolvePlayback()
      await Promise.resolve()
    })

    voice.state = voiceState({
      remoteStreams: new Map([['peer-1', new MediaStream([screenAudio])]]),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })
    rerender(
      <MemoryRouter>
        <ActiveCallBar
          selectedVoiceChannelId={voiceChannel.id}
          activeChannelId={voiceChannel.id}
        />
      </MemoryRouter>
    )

    expect(play).toHaveBeenCalledOnce()
  })

  it('starts screen audio again after the viewer stops and resumes watching', async () => {
    installAudioContextMock()
    const screenAudio = mediaTrack('audio', 'peer-screen-audio')
    markRemoteAudioTrackSource(screenAudio, 'screen')
    const remoteStream = new MediaStream([screenAudio])
    const play = vi.mocked(HTMLMediaElement.prototype.play)
    const { voice, rerender } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', remoteStream]]),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(play).toHaveBeenCalledOnce()

    voice.state = voiceState({
      remoteStreams: new Map([['peer-1', remoteStream]]),
      watchedRemoteScreenPeerIds: new Set(),
    })
    rerender(
      <MemoryRouter>
        <ActiveCallBar selectedVoiceChannelId={voiceChannel.id} activeChannelId={voiceChannel.id} />
      </MemoryRouter>
    )
    expect(play).toHaveBeenCalledOnce()

    voice.state = voiceState({
      remoteStreams: new Map([['peer-1', remoteStream]]),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })
    rerender(
      <MemoryRouter>
        <ActiveCallBar selectedVoiceChannelId={voiceChannel.id} activeChannelId={voiceChannel.id} />
      </MemoryRouter>
    )

    expect(play).toHaveBeenCalledTimes(2)
  })

  it('uses direct remote playback at normal voice volume without creating Web Audio', () => {
    const audioContexts = installAudioContextMock()
    const remoteMic = mediaTrack('audio', 'peer-mic')
    markRemoteAudioTrackSource(remoteMic, 'voice')
    const play = vi.mocked(HTMLMediaElement.prototype.play)

    const { container } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', new MediaStream([remoteMic])]]),
    })

    const remoteMicOutput = container.querySelector(
      'audio[data-peer-id="peer-1"][data-remote-audio-kind="mic"]',
    ) as HTMLAudioElement | null
    if (!remoteMicOutput) throw new Error('Remote microphone output was not rendered.')

    expect(audioContexts).toHaveLength(0)
    expect(remoteMicOutput.srcObject).toBeInstanceOf(MediaStream)
    expect((remoteMicOutput.srcObject as MediaStream).getAudioTracks()).toEqual([remoteMic])
    expect(remoteMicOutput.muted).toBe(false)
    expect(play.mock.instances).toContain(remoteMicOutput)
  })

  it('creates an isolated Web Audio gain graph only for voice amplification above 100 percent', () => {
    const audioContexts = installAudioContextMock()
    writeRemotePlaybackVolumes({ 'voice:peer-1': 150 })
    const remoteMic = mediaTrack('audio', 'amplified-peer-mic')
    markRemoteAudioTrackSource(remoteMic, 'voice')

    renderActiveCallBar({
      remoteStreams: new Map([['peer-1', new MediaStream([remoteMic])]]),
    })

    expect(audioContexts).toHaveLength(1)
    expect(audioContexts[0].createMediaStreamSource).toHaveBeenCalledOnce()
    expect(audioContexts[0].createMediaStreamDestination).toHaveBeenCalledOnce()
    const gain = audioContexts[0].createGain.mock.results[0]?.value
    expect(gain?.gain.value).toBe(1.5)
  })

  it('uses direct remote playback in Tauri without creating a Web Audio destination', () => {
    const audioContexts = installAudioContextMock()
    ;(window as Window & { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__ = {}
    const remoteMic = mediaTrack('audio', 'desktop-peer-mic')
    const remoteScreenAudio = mediaTrack('audio', 'desktop-peer-screen-audio')
    markRemoteAudioTrackSource(remoteMic, 'voice')
    markRemoteAudioTrackSource(remoteScreenAudio, 'screen')
    const play = vi.mocked(HTMLMediaElement.prototype.play)

    const { container } = renderActiveCallBar({
      remoteStreams: new Map([['peer-1', new MediaStream([remoteMic, remoteScreenAudio])]]),
      watchedRemoteScreenPeerIds: new Set(['peer-1']),
    })

    const remoteMicOutput = container.querySelector(
      'audio[data-peer-id="peer-1"][data-remote-audio-kind="mic"]',
    ) as HTMLAudioElement | null
    const remoteScreenOutput = container.querySelector(
      'audio[data-peer-id="peer-1"][data-remote-audio-kind="screen"]',
    ) as HTMLAudioElement | null
    if (!remoteMicOutput || !remoteScreenOutput) throw new Error('Desktop remote audio outputs were not rendered.')

    expect(audioContexts).toHaveLength(0)
    expect(remoteMicOutput.srcObject).toBeInstanceOf(MediaStream)
    expect((remoteMicOutput.srcObject as MediaStream).getAudioTracks()).toEqual([remoteMic])
    expect((remoteScreenOutput.srcObject as MediaStream).getAudioTracks()).toEqual([remoteScreenAudio])
    expect(remoteMicOutput.muted).toBe(false)
    expect(remoteScreenOutput.muted).toBe(false)
    expect(play.mock.instances).toContain(remoteMicOutput)
    expect(play.mock.instances).toContain(remoteScreenOutput)

    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))

    expect(remoteMicOutput.muted).toBe(true)
    expect(remoteScreenOutput.muted).toBe(false)
  })

  it('uses the configured shortcut while the web tab is focused', () => {
    localStorage.setItem(GLOBAL_MUTE_SHORTCUT_STORAGE_KEY, 'CommandOrControl+Shift+M')
    const localMic = mediaTrack('audio', 'local-mic')
    const { voice } = renderActiveCallBar({
      localStream: new MediaStream([localMic]),
    })

    fireEvent.keyDown(window, { code: 'KeyM', ctrlKey: true, shiftKey: true })

    expect(localMic.enabled).toBe(false)
    expect(voice.setVoiceControls).toHaveBeenCalledWith(true, false, false)
  })

  it('uses a single key without triggering while typing or conflicting with push-to-talk', () => {
    localStorage.setItem(GLOBAL_MUTE_SHORTCUT_STORAGE_KEY, 'F')
    const localMic = mediaTrack('audio', 'local-mic')
    const { voice } = renderActiveCallBar({ localStream: new MediaStream([localMic]) })

    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { code: 'KeyF' })
    input.remove()
    expect(localMic.enabled).toBe(true)
    fireEvent.keyDown(window, { code: 'KeyF' })
    expect(localMic.enabled).toBe(false)

    localStorage.setItem('voxpery-settings-voice-mode', 'push_to_talk')
    localStorage.setItem('voxpery-settings-ptt-key', 'F')
    fireEvent.keyDown(window, { code: 'KeyF' })
    expect(localMic.enabled).toBe(false)
    expect(voice.setVoiceControls).toHaveBeenCalledTimes(1)
  })

  it('routes desktop global shortcut events through the existing mute control', () => {
    const localMic = mediaTrack('audio', 'local-mic')
    const { voice } = renderActiveCallBar({
      localStream: new MediaStream([localMic]),
    })

    fireEvent(window, new Event(GLOBAL_MUTE_SHORTCUT_EVENT))

    expect(localMic.enabled).toBe(false)
    expect(voice.setVoiceControls).toHaveBeenCalledWith(true, false, false)
    expect(voice.playVoiceCue).toHaveBeenCalledWith('mute')
  })

  it('prepares idle microphone preferences through desktop shortcut events without joining', () => {
    const { voice } = renderActiveCallBar({
      joinedChannelId: null,
      localStream: null,
    })

    fireEvent(window, new Event(GLOBAL_MUTE_SHORTCUT_EVENT))

    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(true, false, false)
    expect(voice.playVoiceCue).toHaveBeenCalledWith('mute')
    fireEvent(window, new Event(GLOBAL_MUTE_SHORTCUT_EVENT))
    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(false, false, false)
    expect(voice.joinVoice).not.toHaveBeenCalled()
  })

  it.each([
    { shortcut: 'F9', code: 'F9', modifiers: {} },
    { shortcut: 'G', code: 'KeyG', modifiers: {} },
    { shortcut: 'CommandOrControl+Shift+M', code: 'KeyM', modifiers: { ctrlKey: true, shiftKey: true } },
  ])('uses $shortcut before joining while preserving typing, repeat and deafen guards', ({ shortcut, code, modifiers }) => {
    localStorage.setItem(GLOBAL_MUTE_SHORTCUT_STORAGE_KEY, shortcut)
    const { voice } = renderActiveCallBar({ joinedChannelId: null, localStream: null })
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { code, ...modifiers })
    input.remove()
    fireEvent.keyDown(window, { code, ...modifiers, repeat: true })
    expect(voice.setVoiceControls).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { code, ...modifiers })
    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(true, false, false)
    fireEvent.keyDown(window, { code, ...modifiers })
    expect(voice.setVoiceControls).toHaveBeenLastCalledWith(false, false, false)
    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))
    fireEvent.keyDown(window, { code, ...modifiers })
    expect(voice.setVoiceControls).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeDisabled()
    expect(voice.joinVoice).not.toHaveBeenCalled()
    expect(voice.startCamera).not.toHaveBeenCalled()
    expect(voice.startScreenShare).not.toHaveBeenCalled()
  })
})
