export type RemoteMediaKind = 'camera' | 'screen'

export interface VoxperyRemoteMediaTrack extends MediaStreamTrack {
  __voxpery_isScreenShareAudio?: boolean
  __voxpery_audioSource?: 'voice' | 'screen'
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

export function getRemoteAudioPlaybackTracks(stream: MediaStream, includeScreenShareAudio: boolean): MediaStreamTrack[] {
  return stream
    .getAudioTracks()
    .filter((track) => includeScreenShareAudio || !isScreenShareAudioTrack(track))
}

export function createRemoteAudioPlaybackStream(stream: MediaStream, includeScreenShareAudio: boolean): MediaStream {
  const tracks = getRemoteAudioPlaybackTracks(stream, includeScreenShareAudio)
  return new MediaStream(tracks)
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

export function createRemoteAudioKindPlaybackStream(stream: MediaStream, kind: 'mic' | 'screen'): MediaStream {
  const tracks = kind === 'screen'
    ? getRemoteScreenShareAudioTracks(stream)
    : getRemoteMicrophoneAudioTracks(stream)
  return new MediaStream(tracks)
}
