import {
  getRemoteAudioPlaybackTracks,
  getRemoteMicrophoneAudioTracks,
  getRemoteScreenShareAudioTracks,
  isScreenShareAudioTrack,
  markRemoteAudioTrackSource,
  remoteMediaVisibilityKey,
  shouldMuteRemoteAudioPlayback,
  shouldUseDirectRemoteAudioPlayback,
} from './remoteMediaControls'

function audioTrack(screenShareAudio = false) {
  const track = {} as MediaStreamTrack
  if (screenShareAudio) {
    Object.defineProperty(track, '__voxpery_isScreenShareAudio', { value: true, configurable: true })
  }
  return track
}

describe('remote media controls', () => {
  it('creates stable session-local visibility keys', () => {
    expect(remoteMediaVisibilityKey('voice-1', 'user-2', 'screen')).toBe('voice-1:user-2:screen')
  })

  it('detects Voxpery screen share audio tracks', () => {
    const voice = audioTrack()
    const screen = audioTrack()
    markRemoteAudioTrackSource(voice, 'voice')
    markRemoteAudioTrackSource(screen, 'screen')

    expect(isScreenShareAudioTrack(voice)).toBe(false)
    expect(isScreenShareAudioTrack(screen)).toBe(true)
    expect(isScreenShareAudioTrack(audioTrack(true))).toBe(true)
  })

  it('filters screen share audio while keeping microphone audio', () => {
    const mic = audioTrack()
    const screen = audioTrack(true)
    const source = { getAudioTracks: () => [mic, screen] } as unknown as MediaStream

    expect(getRemoteAudioPlaybackTracks(source, true)).toHaveLength(2)
    expect(getRemoteAudioPlaybackTracks(source, false)).toEqual([mic])
  })

  it('splits microphone and screen share audio for independent playback controls', () => {
    const mic = audioTrack()
    const screen = audioTrack()
    markRemoteAudioTrackSource(mic, 'voice')
    markRemoteAudioTrackSource(screen, 'screen')
    const source = { getAudioTracks: () => [mic, screen] } as unknown as MediaStream

    expect(getRemoteMicrophoneAudioTracks(source)).toEqual([mic])
    expect(getRemoteScreenShareAudioTracks(source)).toEqual([screen])
  })

  it('keeps watched screen audio audible while voice playback is deafened', () => {
    expect(shouldMuteRemoteAudioPlayback('mic', true)).toBe(true)
    expect(shouldMuteRemoteAudioPlayback('screen', true)).toBe(false)
    expect(shouldMuteRemoteAudioPlayback('mic', false)).toBe(false)
    expect(shouldMuteRemoteAudioPlayback('screen', false)).toBe(false)
  })

  it('uses direct playback in mobile and Tauri runtimes while keeping Web Audio for browsers', () => {
    expect(shouldUseDirectRemoteAudioPlayback('mic', true, false, 1)).toBe(true)
    expect(shouldUseDirectRemoteAudioPlayback('screen', true, false, 1)).toBe(true)
    expect(shouldUseDirectRemoteAudioPlayback('mic', false, true, 1)).toBe(true)
    expect(shouldUseDirectRemoteAudioPlayback('screen', false, true, 1)).toBe(true)
    expect(shouldUseDirectRemoteAudioPlayback('mic', false, false, 1)).toBe(false)
    expect(shouldUseDirectRemoteAudioPlayback('screen', false, false, 1)).toBe(false)
    expect(shouldUseDirectRemoteAudioPlayback('screen', false, false, 0)).toBe(true)
  })
})
