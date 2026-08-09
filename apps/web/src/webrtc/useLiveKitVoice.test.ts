import { describe, expect, it, vi } from 'vitest'
import {
  clearRemoteMediaStartCue,
  getMicrophonePublishOptions,
  getScreenSharePublishOptions,
  reconcileFinalMediaDisconnect,
  remoteMediaKindForSource,
  remoteMediaStartCueKey,
  remoteMediaVoiceCue,
  resyncVoiceStateAfterReconnect,
  shouldSubscribeRemoteTrack,
  shouldPlayRemoteMediaStartCue,
  shouldPlayRemoteMediaStopCue,
  shouldRecoverMicrophoneTrack,
} from './useLiveKitVoice'
import { AudioPresets, ScreenSharePresets, Track } from 'livekit-client'

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

describe('media reliability', () => {
  it('publishes adaptive screen-share layers instead of one all-or-nothing layer', () => {
    expect(getScreenSharePublishOptions({
      maxBitrate: 6_000_000,
      maxFramerate: 60,
      contentHint: 'motion',
      degradationPreference: 'maintain-framerate',
    })).toMatchObject({
      source: Track.Source.ScreenShare,
      simulcast: true,
      screenShareEncoding: { maxBitrate: 6_000_000, maxFramerate: 60 },
      screenShareSimulcastLayers: [
        ScreenSharePresets.h360fps15,
        ScreenSharePresets.h720fps30,
      ],
    })
  })

  it('recovers only the active ended microphone in a joined call', () => {
    const activeTrack = { readyState: 'ended' } as MediaStreamTrack
    const staleTrack = { readyState: 'ended' } as MediaStreamTrack

    expect(shouldRecoverMicrophoneTrack(activeTrack, activeTrack, 'voice-1', false)).toBe(true)
    expect(shouldRecoverMicrophoneTrack(staleTrack, activeTrack, 'voice-1', false)).toBe(false)
    expect(shouldRecoverMicrophoneTrack(activeTrack, activeTrack, null, false)).toBe(false)
    expect(shouldRecoverMicrophoneTrack(activeTrack, activeTrack, 'voice-1', true)).toBe(false)
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
      participantSid: 'PA_current',
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
      participant_sid: 'PA_current',
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

describe('final LiveKit disconnect reconciliation', () => {
  it('leaves signaling presence after the media room is permanently disconnected', () => {
    const leaveVoice = vi.fn()

    expect(reconcileFinalMediaDisconnect({
      channelId: 'voice-channel-1',
      alreadyReconciled: false,
      isCurrentRoom: true,
      leaveVoice,
    })).toBe(true)

    expect(leaveVoice).toHaveBeenCalledOnce()
    expect(leaveVoice).toHaveBeenCalledWith({
      skipLeaveSound: true,
      skipRoomDisconnect: true,
    })
  })

  it('does not emit duplicate leave events for the same disconnect', () => {
    const leaveVoice = vi.fn()

    expect(reconcileFinalMediaDisconnect({
      channelId: 'voice-channel-1',
      alreadyReconciled: true,
      isCurrentRoom: true,
      leaveVoice,
    })).toBe(false)
    expect(leaveVoice).not.toHaveBeenCalled()
  })

  it('does not emit leave when no voice presence is active', () => {
    const leaveVoice = vi.fn()

    expect(reconcileFinalMediaDisconnect({
      channelId: null,
      alreadyReconciled: false,
      isCurrentRoom: true,
      leaveVoice,
    })).toBe(false)
    expect(leaveVoice).not.toHaveBeenCalled()
  })

  it('ignores a delayed disconnect event from a previous room', () => {
    const leaveVoice = vi.fn()

    expect(reconcileFinalMediaDisconnect({
      channelId: 'voice-channel-2',
      alreadyReconciled: false,
      isCurrentRoom: false,
      leaveVoice,
    })).toBe(false)
    expect(leaveVoice).not.toHaveBeenCalled()
  })
})

describe('remote media start cues', () => {
  it('creates stable remote media cue keys', () => {
    expect(remoteMediaStartCueKey('user-1', 'camera')).toBe('user-1:camera')
    expect(remoteMediaStartCueKey('user-1', 'screen')).toBe('user-1:screen')
  })

  it('does not play during initial remote media hydration', () => {
    const seen = new Set<string>()

    expect(shouldPlayRemoteMediaStartCue(seen, 'user-1', 'screen', false)).toBe(false)
    expect(seen.has('user-1:screen')).toBe(true)
  })

  it('plays once when remote media starts after voice is ready', () => {
    const seen = new Set<string>()

    expect(shouldPlayRemoteMediaStartCue(seen, 'user-1', 'screen', true)).toBe(true)
    expect(shouldPlayRemoteMediaStartCue(seen, 'user-1', 'screen', true)).toBe(false)
  })

  it('keeps camera cues local and broadcasts only screen-share cues', () => {
    expect(remoteMediaVoiceCue('camera', 'start')).toBeNull()
    expect(remoteMediaVoiceCue('camera', 'stop')).toBeNull()
    expect(remoteMediaVoiceCue('screen', 'start')).toBe('screen-start')
    expect(remoteMediaVoiceCue('screen', 'stop')).toBe('screen-stop')
  })

  it('plays a remote screen-stop cue once after an active share ends', () => {
    const seen = new Set<string>(['user-1:screen'])

    expect(shouldPlayRemoteMediaStopCue(seen, 'user-1', 'screen', true)).toBe(true)
    expect(shouldPlayRemoteMediaStopCue(seen, 'user-1', 'screen', true)).toBe(false)
  })

  it('clears initial screen-share state without a stop cue before voice is ready', () => {
    const seen = new Set<string>(['user-1:screen'])

    expect(shouldPlayRemoteMediaStopCue(seen, 'user-1', 'screen', false)).toBe(false)
    expect(seen.has('user-1:screen')).toBe(false)
  })

  it('can play again after the remote media key is cleared', () => {
    const seen = new Set<string>()

    expect(shouldPlayRemoteMediaStartCue(seen, 'user-1', 'screen', true)).toBe(true)
    clearRemoteMediaStartCue(seen, 'user-1', 'screen')
    expect(shouldPlayRemoteMediaStartCue(seen, 'user-1', 'screen', true)).toBe(true)
  })

  it('clears all media cue keys for a peer', () => {
    const seen = new Set<string>(['user-1:camera', 'user-1:screen', 'user-2:camera'])

    clearRemoteMediaStartCue(seen, 'user-1')

    expect(seen.has('user-1:camera')).toBe(false)
    expect(seen.has('user-1:screen')).toBe(false)
    expect(seen.has('user-2:camera')).toBe(true)
  })
})
