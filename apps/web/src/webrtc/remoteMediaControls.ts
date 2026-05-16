export type RemoteMediaKind = 'camera' | 'screen'

export interface VoxperyRemoteMediaTrack extends MediaStreamTrack {
  __voxpery_isScreenShareAudio?: boolean
}

export function remoteMediaVisibilityKey(channelId: string, peerId: string, kind: RemoteMediaKind): string {
  return `${channelId}:${peerId}:${kind}`
}

export function isScreenShareAudioTrack(track: MediaStreamTrack): boolean {
  return !!(track as VoxperyRemoteMediaTrack).__voxpery_isScreenShareAudio
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
