import { describe, expect, it, vi } from 'vitest'
import {
  clearRemoteMediaStartCue,
  getMicrophonePublishOptions,
  remoteMediaKindForSource,
  remoteMediaStartCueKey,
  resyncVoiceStateAfterReconnect,
  shouldSubscribeRemoteTrack,
  shouldPlayRemoteMediaStartCue,
} from './useLiveKitVoice'
import { AudioPresets, Track } from 'livekit-client'

describe('microphone publish options', () => {
  it('uses a high-quality mono Opus profile with resilience enabled', () => {
    expect(getMicrophonePublishOptions()).toMatchObject({
      source: Track.Source.Microphone,
      audioPreset: AudioPresets.musicHighQuality,
      dtx: true,
      red: true,
      forceStereo: false,
    })
  })
})

describe('remote media subscriptions', () => {
  it('keeps remote audio subscribed while the app is hidden', () => {
    expect(shouldSubscribeRemoteTrack(Track.Kind.Audio, false)).toBe(true)
  })

  it('pauses remote video while hidden and restores it while visible', () => {
    expect(shouldSubscribeRemoteTrack(Track.Kind.Video, false)).toBe(false)
    expect(shouldSubscribeRemoteTrack(Track.Kind.Video, true)).toBe(true)
  })

  it('keeps user-hidden media unsubscribed even while the app is visible', () => {
    expect(shouldSubscribeRemoteTrack(Track.Kind.Video, true, true)).toBe(false)
    expect(shouldSubscribeRemoteTrack(Track.Kind.Audio, true, true)).toBe(false)
  })

  it('maps camera and screen publications to viewer controls', () => {
    expect(remoteMediaKindForSource(Track.Source.Camera)).toBe('camera')
    expect(remoteMediaKindForSource(Track.Source.ScreenShare)).toBe('screen')
    expect(remoteMediaKindForSource(Track.Source.ScreenShareAudio)).toBe('screen')
    expect(remoteMediaKindForSource(Track.Source.Microphone)).toBeNull()
  })
})

describe('resyncVoiceStateAfterReconnect', () => {
  it('re-sends voice join and control state after WebSocket reconnect', () => {
    const send = vi.fn()

    resyncVoiceStateAfterReconnect({
      channelId: 'voice-channel-1',
      roomState: 'connected',
      control: {
        muted: true,
        deafened: false,
        screenSharing: true,
        cameraOn: true,
      },
      send,
    })

    expect(send).toHaveBeenNthCalledWith(1, 'JoinVoice', {
      channel_id: 'voice-channel-1',
    })
    expect(send).toHaveBeenNthCalledWith(2, 'SetVoiceControl', {
      muted: true,
      deafened: false,
      screen_sharing: true,
      camera_on: true,
    })
  })

  it('defaults missing voice controls to false', () => {
    const send = vi.fn()

    resyncVoiceStateAfterReconnect({
      channelId: 'voice-channel-1',
      roomState: 'connected',
      control: null,
      send,
    })

    expect(send).toHaveBeenNthCalledWith(2, 'SetVoiceControl', {
      muted: false,
      deafened: false,
      screen_sharing: false,
      camera_on: false,
    })
  })

  it('does not resync when no voice channel is joined', () => {
    const send = vi.fn()

    resyncVoiceStateAfterReconnect({
      channelId: null,
      roomState: 'connected',
      control: null,
      send,
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('does not resync when the media room is gone', () => {
    const send = vi.fn()

    resyncVoiceStateAfterReconnect({
      channelId: 'voice-channel-1',
      roomState: null,
      control: null,
      send,
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('does not resync when the media room is disconnected', () => {
    const send = vi.fn()

    resyncVoiceStateAfterReconnect({
      channelId: 'voice-channel-1',
      roomState: 'disconnected',
      control: null,
      send,
    })

    expect(send).not.toHaveBeenCalled()
  })
})

describe('remote media start cues', () => {
  it('creates stable remote media cue keys', () => {
    expect(remoteMediaStartCueKey('user-1', 'camera')).toBe('user-1:camera')
    expect(remoteMediaStartCueKey('user-1', 'screen')).toBe('user-1:screen')
  })

  it('does not play during initial remote media hydration', () => {
    const seen = new Set<string>()

    expect(shouldPlayRemoteMediaStartCue(seen, 'user-1', 'camera', false)).toBe(false)
    expect(seen.has('user-1:camera')).toBe(true)
  })

  it('plays once when remote media starts after voice is ready', () => {
    const seen = new Set<string>()

    expect(shouldPlayRemoteMediaStartCue(seen, 'user-1', 'screen', true)).toBe(true)
    expect(shouldPlayRemoteMediaStartCue(seen, 'user-1', 'screen', true)).toBe(false)
  })

  it('can play again after the remote media key is cleared', () => {
    const seen = new Set<string>()

    expect(shouldPlayRemoteMediaStartCue(seen, 'user-1', 'camera', true)).toBe(true)
    clearRemoteMediaStartCue(seen, 'user-1', 'camera')
    expect(shouldPlayRemoteMediaStartCue(seen, 'user-1', 'camera', true)).toBe(true)
  })

  it('clears all media cue keys for a peer', () => {
    const seen = new Set<string>(['user-1:camera', 'user-1:screen', 'user-2:camera'])

    clearRemoteMediaStartCue(seen, 'user-1')

    expect(seen.has('user-1:camera')).toBe(false)
    expect(seen.has('user-1:screen')).toBe(false)
    expect(seen.has('user-2:camera')).toBe(true)
  })
})
