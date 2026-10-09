import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getPreferredMicrophoneStream } from '../../voiceDevices'
import {
  normalizeScreenShareQuality,
  resolveScreenShareProfileForMode,
  SCREEN_SHARE_PRESET_PROFILE,
  SCREEN_SHARE_CAPTURE_READY_EVENT,
  toScreenShareDisplayMediaOptions,
  toScreenShareCaptureDiagnostics,
  toScreenShareConstraintsForProfile,
  useLocalMedia,
} from './useLocalMedia'

vi.mock('../../voiceDevices', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../voiceDevices')>(),
  getPreferredMicrophoneStream: vi.fn(),
}))

describe('microphone capture lifecycle', () => {
  it('stops a delayed capture after leaving rather than caching it for the next session', async () => {
    let resolve!: (stream: MediaStream) => void
    vi.mocked(getPreferredMicrophoneStream).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const { result } = renderHook(() => useLocalMedia())
    const pending = result.current.getMicrophoneStream()
    const rejected = expect(pending).rejects.toThrow('no longer active')
    act(() => result.current.cleanupLocalMedia())
    const track = { stop: vi.fn(), readyState: 'live' }
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream
    resolve(stream)
    await rejected
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('does not let an older capture overwrite the current room capture', async () => {
    let resolve!: (stream: MediaStream) => void
    const obsoleteTrack = { stop: vi.fn(), readyState: 'live' }
    const currentTrack = { stop: vi.fn(), readyState: 'live' }
    const obsolete = { getTracks: () => [obsoleteTrack], getAudioTracks: () => [obsoleteTrack] } as unknown as MediaStream
    const current = { getTracks: () => [currentTrack], getAudioTracks: () => [currentTrack] } as unknown as MediaStream
    vi.mocked(getPreferredMicrophoneStream)
      .mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      .mockResolvedValueOnce(current)
    const { result } = renderHook(() => useLocalMedia())
    const pending = result.current.getMicrophoneStream(true)
    const rejected = expect(pending).rejects.toThrow('no longer active')
    expect(await result.current.getMicrophoneStream(true)).toBe(current)
    resolve(obsolete)
    await rejected
    expect(await result.current.getMicrophoneStream()).toBe(current)
    expect(obsoleteTrack.stop).toHaveBeenCalledOnce()
    expect(currentTrack.stop).not.toHaveBeenCalled()
    act(() => result.current.cleanupLocalMedia())
  })
})

describe('screen share quality profiles', () => {
  it('normalizes unknown and legacy values to auto', () => {
    expect(normalizeScreenShareQuality('presentation')).toBe('presentation')
    expect(normalizeScreenShareQuality('video')).toBe('video')
    expect(normalizeScreenShareQuality('gaming')).toBe('gaming')
    expect(normalizeScreenShareQuality('manual')).toBe('auto')
    expect(normalizeScreenShareQuality('unknown')).toBe('auto')
    expect(normalizeScreenShareQuality(null)).toBe('auto')
  })

  it('maps explicit presets to their release smoke expectations', () => {
    expect(resolveScreenShareProfileForMode('presentation')).toEqual({
      resolution: '1080p',
      framerate: 30,
      bitrate: 4_000_000,
      contentHint: 'detail',
      degradationPreference: 'maintain-resolution',
    })
    expect(resolveScreenShareProfileForMode('video')).toEqual({
      resolution: '1080p',
      framerate: 60,
      bitrate: 8_000_000,
      contentHint: 'motion',
      degradationPreference: 'maintain-framerate',
    })
    expect(resolveScreenShareProfileForMode('gaming')).toEqual({
      resolution: '1080p',
      framerate: 60,
      bitrate: 12_000_000,
      contentHint: 'motion',
      degradationPreference: 'maintain-framerate',
    })
  })

  it('selects auto profile by shared surface', () => {
    expect(resolveScreenShareProfileForMode('auto', 'monitor')).toEqual(SCREEN_SHARE_PRESET_PROFILE.video)
    expect(resolveScreenShareProfileForMode('auto', 'browser')).toEqual(SCREEN_SHARE_PRESET_PROFILE.video)
    expect(resolveScreenShareProfileForMode('auto', 'window')).toEqual(SCREEN_SHARE_PRESET_PROFILE.presentation)
    expect(resolveScreenShareProfileForMode('auto')).toEqual(SCREEN_SHARE_PRESET_PROFILE.presentation)
  })

  it('keeps 1080p frame constraints aligned with the selected profile', () => {
    expect(toScreenShareConstraintsForProfile(SCREEN_SHARE_PRESET_PROFILE.presentation)).toEqual({
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 30, max: 30 },
    })
    expect(toScreenShareConstraintsForProfile(SCREEN_SHARE_PRESET_PROFILE.gaming)).toEqual({
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 60, max: 60 },
    })
  })

  it('keeps call playback audible while the screen picker changes focus', () => {
    const video = toScreenShareConstraintsForProfile(SCREEN_SHARE_PRESET_PROFILE.presentation)

    expect(toScreenShareDisplayMediaOptions(video)).toEqual({
      video,
      systemAudio: 'include',
      windowAudio: 'window',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        restrictOwnAudio: true,
        suppressLocalAudioPlayback: false,
      },
    })
    expect(SCREEN_SHARE_CAPTURE_READY_EVENT).toBe('voxpery-screen-share-capture-ready')
  })

  it('records non-identifying screen audio quality settings', () => {
    const videoTrack = {
      getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }),
    } as unknown as MediaStreamTrack
    const audioTrack = {
      contentHint: 'music',
      getSettings: () => ({
        sampleRate: 48000,
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        restrictOwnAudio: true,
        deviceId: 'private-audio-id',
      }),
    } as unknown as MediaStreamTrack

    expect(toScreenShareCaptureDiagnostics(
      SCREEN_SHARE_PRESET_PROFILE.video,
      videoTrack,
      true,
      true,
      audioTrack,
    )).toMatchObject({
      audioCaptured: true,
      audioSampleRate: 48000,
      audioChannelCount: 2,
      audioContentHint: 'music',
      audioProcessing: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        restrictOwnAudio: true,
        suppressLocalAudioPlayback: undefined,
      },
    })
  })

  it('records requested and actual capture quality without device identifiers', () => {
    const track = {
      getSettings: () => ({
        width: 1440,
        height: 900,
        frameRate: 28,
        displaySurface: 'window',
        deviceId: 'private-display-id',
      }),
    } as unknown as MediaStreamTrack

    expect(toScreenShareCaptureDiagnostics(
      SCREEN_SHARE_PRESET_PROFILE.presentation,
      track,
      false,
      false,
    )).toEqual({
      requestedWidth: 1920,
      requestedHeight: 1080,
      requestedFramerate: 30,
      actualWidth: 1440,
      actualHeight: 900,
      actualFramerate: 28,
      displaySurface: 'window',
      constraintsApplied: false,
      audioCaptured: false,
      videoPublished: false,
      audioPublished: false,
      simulcast: true,
    })
  })
})
