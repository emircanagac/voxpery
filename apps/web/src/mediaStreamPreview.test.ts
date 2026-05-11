import { describe, expect, it, vi } from 'vitest'
import { attachMediaStreamPreview } from './mediaStreamPreview'

function createVideoElement() {
  const video = document.createElement('video')
  Object.defineProperty(video, 'srcObject', {
    configurable: true,
    writable: true,
    value: null,
  })
  Object.defineProperty(video, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  return video
}

describe('attachMediaStreamPreview', () => {
  it('attaches the stream, retries playback, and clears the preview on cleanup', () => {
    vi.useFakeTimers()
    const video = createVideoElement()
    const stream = new MediaStream()

    const cleanup = attachMediaStreamPreview(video, stream)

    expect(video.srcObject).not.toBe(stream)
    expect((video.srcObject as MediaStream).getTracks()).toEqual([])
    vi.advanceTimersByTime(150)
    expect(video.play).toHaveBeenCalled()

    cleanup()

    expect(video.srcObject).toBeNull()
    vi.useRealTimers()
  })

  it('can attach the same live stream to a newly mounted video element', () => {
    vi.useFakeTimers()
    const stream = new MediaStream()
    const firstVideo = createVideoElement()
    const firstCleanup = attachMediaStreamPreview(firstVideo, stream)
    firstCleanup()

    const nextVideo = createVideoElement()
    const nextCleanup = attachMediaStreamPreview(nextVideo, stream)

    expect(nextVideo.srcObject).not.toBe(stream)
    expect((nextVideo.srcObject as MediaStream).getTracks()).toEqual([])
    vi.advanceTimersByTime(150)
    expect(nextVideo.play).toHaveBeenCalled()

    nextCleanup()
    vi.useRealTimers()
  })
})
