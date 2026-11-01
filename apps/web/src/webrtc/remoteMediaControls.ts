export type RemoteMediaKind = 'camera' | 'screen'
export type RemoteAudioKind = 'mic' | 'screen'

export interface VoxperyRemoteMediaTrack extends MediaStreamTrack {
  __voxpery_isScreenShareAudio?: boolean
  __voxpery_audioSource?: 'voice' | 'screen'
  __voxpery_isCamera?: boolean
  __voxpery_isScreenShare?: boolean
}

export function remoteMediaVisibilityKey(channelId: string, peerId: string, kind: RemoteMediaKind): string {
  return `${channelId}:${peerId}:${kind}`
}

export function isScreenShareAudioTrack(track: MediaStreamTrack): boolean {
  const remoteTrack = track as VoxperyRemoteMediaTrack
  return remoteTrack.__voxpery_audioSource === 'screen' || !!remoteTrack.__voxpery_isScreenShareAudio
}

export function markRemoteAudioTrackSource(track: MediaStreamTrack, source: 'voice' | 'screen'): void {
  Object.defineProperties(track, {
    __voxpery_audioSource: { value: source, writable: true, configurable: true },
    __voxpery_isScreenShareAudio: { value: source === 'screen', writable: true, configurable: true },
  })
}

/**
 * Records what a video track carries. A publisher switching between camera and screen can reuse
 * the same track, so both flags are written every time and the previous source never lingers.
 */
export function markRemoteVideoTrackSource(track: MediaStreamTrack, source: RemoteMediaKind): void {
  Object.defineProperties(track, {
    __voxpery_isCamera: { value: source === 'camera', writable: true, configurable: true },
    __voxpery_isScreenShare: { value: source === 'screen', writable: true, configurable: true },
  })
}

export function getRemoteMicrophoneAudioTracks(stream: MediaStream): MediaStreamTrack[] {
  return stream
    .getAudioTracks()
    .filter((track) => !isScreenShareAudioTrack(track))
}

export function getRemoteScreenShareAudioTracks(stream: MediaStream): MediaStreamTrack[] {
  return stream
    .getAudioTracks()
    .filter((track) => isScreenShareAudioTrack(track))
}

export function createRemoteAudioKindPlaybackStream(stream: MediaStream, kind: RemoteAudioKind): MediaStream {
  const tracks = kind === 'screen'
    ? getRemoteScreenShareAudioTracks(stream)
    : getRemoteMicrophoneAudioTracks(stream)
  return new MediaStream(tracks)
}

export function setRemoteMicrophoneTrackPlaybackMuted(track: MediaStreamTrack, muted: boolean): void {
  if (track.kind !== 'audio' || isScreenShareAudioTrack(track)) return
  track.enabled = !muted
}

export function setRemoteMicrophoneStreamsPlaybackMuted(
  streams: Iterable<MediaStream>,
  muted: boolean,
): void {
  for (const stream of streams) {
    for (const track of getRemoteMicrophoneAudioTracks(stream)) {
      setRemoteMicrophoneTrackPlaybackMuted(track, muted)
    }
  }
}

export function shouldMuteRemoteAudioPlayback(kind: RemoteAudioKind, voiceDeafened: boolean): boolean {
  return kind === 'mic' && voiceDeafened
}

export function shouldUseDirectRemoteAudioPlayback(
  kind: RemoteAudioKind,
  lightweightMobileVoice: boolean,
  desktopRuntime: boolean,
  audioTrackCount: number,
  playbackVolumeFactor = 1,
): boolean {
  return kind === 'screen'
    || desktopRuntime
    || lightweightMobileVoice
    || audioTrackCount === 0
    || playbackVolumeFactor <= 1
}
