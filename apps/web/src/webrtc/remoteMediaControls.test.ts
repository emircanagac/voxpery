import {
  getRemoteAudioPlaybackTracks,
  getRemoteMicrophoneAudioTracks,
  getRemoteScreenShareAudioTracks,
  isScreenShareAudioTrack,
  remoteMediaVisibilityKey,
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
    expect(isScreenShareAudioTrack(audioTrack())).toBe(false)
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
    const screen = audioTrack(true)
    const source = { getAudioTracks: () => [mic, screen] } as unknown as MediaStream

    expect(getRemoteMicrophoneAudioTracks(source)).toEqual([mic])
    expect(getRemoteScreenShareAudioTracks(source)).toEqual([screen])
  })
})
