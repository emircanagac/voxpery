import { describe, expect, it, vi } from 'vitest'
import { createBackgroundMicrophoneSwitch, type ReplaceableMicrophoneTrack } from './backgroundMicrophone'

function fakeTrack(readyState: MediaStreamTrackState = 'live'): MediaStreamTrack {
  return { readyState, enabled: true } as MediaStreamTrack
}

function fakePublished(initial: MediaStreamTrack) {
  const published = {
    mediaStreamTrack: initial,
    replaceTrack: vi.fn(async (track: MediaStreamTrack) => {
      await Promise.resolve()
      published.mediaStreamTrack = track
    }),
  }
  return published as ReplaceableMicrophoneTrack & { mediaStreamTrack: MediaStreamTrack; replaceTrack: ReturnType<typeof vi.fn> }
}

describe('background microphone switch', () => {
  it('publishes the captured microphone while hidden and restores the processed track', async () => {
    const raw = fakeTrack()
    const processed = fakeTrack()
    const published = fakePublished(processed)
    const microphoneSwitch = createBackgroundMicrophoneSwitch()

    expect(await microphoneSwitch.publishCaptured(published, raw)).toBe(true)
    expect(published.mediaStreamTrack).toBe(raw)
    expect(microphoneSwitch.active).toBe(true)

    expect(await microphoneSwitch.restoreProcessed(published, true)).toBe('restored')
    expect(published.mediaStreamTrack).toBe(processed)
    expect(processed.enabled).toBe(false)
    expect(microphoneSwitch.active).toBe(false)
  })

  it('asks for a rebuild when the processed track ended in the background', async () => {
    const raw = fakeTrack()
    const processed = fakeTrack()
    const published = fakePublished(processed)
    const microphoneSwitch = createBackgroundMicrophoneSwitch()
    await microphoneSwitch.publishCaptured(published, raw)
    Object.assign(processed, { readyState: 'ended' })

    expect(await microphoneSwitch.restoreProcessed(published, false)).toBe('rebuild')
    expect(published.mediaStreamTrack).toBe(raw)
  })

  it('leaves a microphone rebuilt while hidden alone', async () => {
    const raw = fakeTrack()
    const published = fakePublished(fakeTrack())
    const microphoneSwitch = createBackgroundMicrophoneSwitch()
    await microphoneSwitch.publishCaptured(published, raw)
    const rebuilt = fakeTrack()
    published.mediaStreamTrack = rebuilt

    expect(await microphoneSwitch.restoreProcessed(published, false)).toBe('none')
    expect(published.mediaStreamTrack).toBe(rebuilt)
  })

  it('ends on the processed track when the page is shown before the switch finished', async () => {
    const raw = fakeTrack()
    const processed = fakeTrack()
    const published = fakePublished(processed)
    const microphoneSwitch = createBackgroundMicrophoneSwitch()

    const hidden = microphoneSwitch.publishCaptured(published, raw)
    const shown = microphoneSwitch.restoreProcessed(published, false)
    await Promise.all([hidden, shown])

    expect(await shown).toBe('restored')
    expect(published.mediaStreamTrack).toBe(processed)
  })

  it('does not switch to an ended or already published microphone', async () => {
    const raw = fakeTrack()
    const published = fakePublished(raw)
    const microphoneSwitch = createBackgroundMicrophoneSwitch()

    expect(await microphoneSwitch.publishCaptured(published, raw)).toBe(false)
    expect(await microphoneSwitch.publishCaptured(fakePublished(fakeTrack()), fakeTrack('ended'))).toBe(false)
    expect(published.replaceTrack).not.toHaveBeenCalled()
    expect(await microphoneSwitch.restoreProcessed(published, false)).toBe('none')
  })
})
