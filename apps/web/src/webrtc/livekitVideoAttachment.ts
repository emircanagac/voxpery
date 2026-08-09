export interface AttachableLiveKitVideoTrack {
  attach(element: HTMLMediaElement): HTMLMediaElement
  detach(element: HTMLMediaElement): HTMLMediaElement
}

export interface VoxperyMediaStreamTrack extends MediaStreamTrack {
  __voxpery_isCamera?: boolean
  __voxpery_isScreenShare?: boolean
  __voxpery_isScreenShareAudio?: boolean
  __voxpery_livekitVideoTrack?: AttachableLiveKitVideoTrack
}

export function associateLiveKitVideoTrack(
  mediaTrack: MediaStreamTrack,
  liveKitTrack: AttachableLiveKitVideoTrack,
): void {
  Object.defineProperty(mediaTrack, '__voxpery_livekitVideoTrack', {
    value: liveKitTrack,
    writable: true,
    configurable: true,
  })
}

export function attachRemoteVideoElement(
  element: HTMLVideoElement,
  mediaTrack: MediaStreamTrack,
): () => void {
  const voxperyTrack = mediaTrack as VoxperyMediaStreamTrack
  const liveKitTrack = voxperyTrack.__voxpery_livekitVideoTrack

  if (liveKitTrack) {
    liveKitTrack.attach(element)
    void element.play().catch(() => undefined)
    return () => {
      liveKitTrack.detach(element)
      if (element.srcObject) element.srcObject = null
    }
  }

  const stream = new MediaStream([mediaTrack])
  element.srcObject = stream
  void element.play().catch(() => undefined)
  return () => {
    if (element.srcObject === stream) element.srcObject = null
  }
}
