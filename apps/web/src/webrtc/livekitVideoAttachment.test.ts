import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  associateLiveKitVideoTrack,
  attachRemoteVideoElement,
} from './livekitVideoAttachment'

function videoTrack(id = 'screen-track') {
  return {
    id,
    kind: 'video',
    enabled: true,
    muted: false,
    readyState: 'live',
  } as MediaStreamTrack
}

describe('livekitVideoAttachment', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  })

  it('uses the LiveKit attach lifecycle required by adaptive stream', () => {
    const element = document.createElement('video')
    const track = videoTrack()
    const liveKitTrack = {
      attach: vi.fn((target: HTMLMediaElement) => target),
      detach: vi.fn((target: HTMLMediaElement) => target),
    }
    associateLiveKitVideoTrack(track, liveKitTrack)

    const cleanup = attachRemoteVideoElement(element, track)

    expect(liveKitTrack.attach).toHaveBeenCalledWith(element)
    cleanup()
    expect(liveKitTrack.detach).toHaveBeenCalledWith(element)
  })

  it('keeps a MediaStream fallback for non-LiveKit video tracks', () => {
    const element = document.createElement('video')
    const track = videoTrack('fallback-track')

    const cleanup = attachRemoteVideoElement(element, track)

    expect((element.srcObject as MediaStream).getVideoTracks()).toEqual([track])
    cleanup()
    expect(element.srcObject).toBeNull()
  })
})
