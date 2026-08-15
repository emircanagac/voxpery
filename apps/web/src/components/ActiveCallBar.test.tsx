import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

function voiceState(overrides?: Record<string, unknown>) {
  return {
    joinedChannelId: voiceChannel.id,
    isJoining: false,
    localStream: new MediaStream([mediaTrack('audio', 'local-mic')]),
    screenStream: null,
    isScreenSharing: false,
    cameraStream: null,
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
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
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

  it('reasserts remote microphone playback after the macOS share picker returns', () => {
    const remoteMic = mediaTrack('audio', 'peer-mic')
    const remoteStream = new MediaStream([remoteMic])
    const play = vi.mocked(HTMLMediaElement.prototype.play)

    renderActiveCallBar({
      remoteStreams: new Map([['peer-1', remoteStream]]),
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

  it('explains when the selected screen source has no publishable audio track', async () => {
    const { voice } = renderActiveCallBar()
    voice.startScreenShare.mockResolvedValueOnce({ hasAudio: false, audioPublished: false })

    fireEvent.click(screen.getByRole('button', { name: 'Share screen' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Share screen' }).at(-1)!)

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({
          level: 'info',
          title: 'Sharing without audio',
        }),
      ])
    })
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

    const [voiceAudio, screenAudio] = Array.from(container.querySelectorAll('audio'))
    if (!voiceAudio || !screenAudio) throw new Error('Remote audio playback elements were not rendered.')

    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }))

    expect(voiceAudio.muted).toBe(true)
    expect(screenAudio.muted).toBe(false)
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
