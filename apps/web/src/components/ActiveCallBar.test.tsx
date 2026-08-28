import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberInfo } from '../api'
import type { Channel, Server, User } from '../types'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useLiveKitVoice } from '../webrtc/useLiveKitVoice'
import {
  GLOBAL_MUTE_SHORTCUT_EVENT,
  GLOBAL_MUTE_SHORTCUT_STORAGE_KEY,
} from '../globalMuteShortcut'
import ActiveCallBar from './ActiveCallBar'
import { SCREEN_SHARE_CAPTURE_READY_EVENT } from '../webrtc/hooks/useLocalMedia'
import { markRemoteAudioTrackSource } from '../webrtc/remoteMediaControls'
import {
  getRemotePlaybackVolume,
  readRemotePlaybackVolumes,
  writePreviousScreenPlaybackVolume,
  writeRemotePlaybackVolumes,
} from '../webrtc/remotePlaybackVolume'

vi.mock('../webrtc/useLiveKitVoice', () => ({
  useLiveKitVoice: vi.fn(),
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

function voiceState(overrides?: Record<string, unknown>) {
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

function renderActiveCallBar(overrides?: Record<string, unknown>) {
  const voice = {
    state: voiceState(overrides),
    joinVoice: vi.fn(),
    leaveVoice: vi.fn(),
    startScreenShare: vi.fn().mockResolvedValue({ hasAudio: true, audioPublished: true }),
    stopScreenShare: vi.fn(),
    startCamera: vi.fn(),
    stopCamera: vi.fn(),
    switchCamera: vi.fn().mockResolvedValue(undefined),
    setVoiceControls: vi.fn(),
    setRemoteMediaSubscribed: vi.fn(),
    playVoiceCue: vi.fn(),
  }

  vi.mocked(useLiveKitVoice).mockReturnValue(voice as unknown as ReturnType<typeof useLiveKitVoice>)

  const result = render(
    <MemoryRouter>
      <ActiveCallBar
        selectedVoiceChannelId={voiceChannel.id}
        activeChannelId={voiceChannel.id}
      />
    </MemoryRouter>
  )

  return { ...result, voice }
}

describe('ActiveCallBar regressions', () => {
  afterEach(() => {
    restoreAudioContextMock?.()
    restoreAudioContextMock = null
  })

  beforeEach(() => {
    localStorage.clear()
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

    expect(voice.setVoiceControls).toHaveBeenCalledWith(false, false, false)
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

  it('routes desktop global shortcut events through the existing mute control', () => {
    const localMic = mediaTrack('audio', 'local-mic')
    const { voice } = renderActiveCallBar({
      localStream: new MediaStream([localMic]),
    })

    window.dispatchEvent(new Event(GLOBAL_MUTE_SHORTCUT_EVENT))

    expect(localMic.enabled).toBe(false)
    expect(voice.setVoiceControls).toHaveBeenCalledWith(true, false, false)
    expect(voice.playVoiceCue).toHaveBeenCalledWith('mute')
  })

  it('ignores shortcut events without an active voice session', () => {
    const { voice } = renderActiveCallBar({
      joinedChannelId: null,
      localStream: null,
    })

    window.dispatchEvent(new Event(GLOBAL_MUTE_SHORTCUT_EVENT))

    expect(voice.setVoiceControls).not.toHaveBeenCalled()
    expect(voice.playVoiceCue).not.toHaveBeenCalled()
  })
})
