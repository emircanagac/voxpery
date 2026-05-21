import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberInfo } from '../api'
import type { Channel, Server, User } from '../types'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useLiveKitVoice } from '../webrtc/useLiveKitVoice'
import ActiveCallBar from './ActiveCallBar'

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
    startScreenShare: vi.fn(),
    stopScreenShare: vi.fn(),
    startCamera: vi.fn(),
    stopCamera: vi.fn(),
    setVoiceControls: vi.fn(),
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

  it('keeps remote screen share hide and show available in the voice stage', () => {
    const screenTrack = mediaTrack('video', 'screen-track')
    const remoteStream = new MediaStream([screenTrack])

    renderActiveCallBar({
      remoteStreams: new Map([['peer-1', remoteStream]]),
      remoteScreenTrackIds: new Set(['screen-track']),
    })

    fireEvent.click(screen.getByTitle('Stop watching screen'))

    expect(screen.getByText('Screen share hidden')).not.toBeNull()
    expect(screen.getAllByText('admin')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /show/i }))

    expect(screen.getByTitle('Stop watching screen')).not.toBeNull()
    expect(screen.queryByText('Screen share hidden')).toBeNull()
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
})
