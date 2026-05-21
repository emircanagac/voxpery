import { describe, expect, it } from 'vitest'
import {
  normalizeScreenShareQuality,
  resolveScreenShareProfileForMode,
  SCREEN_SHARE_PRESET_PROFILE,
  toScreenShareConstraintsForProfile,
} from './useLocalMedia'

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
      bitrate: 5_000_000,
      contentHint: 'detail',
      degradationPreference: 'maintain-resolution',
    })
    expect(resolveScreenShareProfileForMode('video')).toEqual({
      resolution: '1080p',
      framerate: 60,
      bitrate: 7_000_000,
      contentHint: 'motion',
      degradationPreference: 'maintain-framerate',
    })
    expect(resolveScreenShareProfileForMode('gaming')).toEqual({
      resolution: '1080p',
      framerate: 60,
      bitrate: 9_000_000,
      contentHint: 'motion',
      degradationPreference: 'maintain-framerate',
    })
  })

  it('selects auto profile by shared surface', () => {
    expect(resolveScreenShareProfileForMode('auto', 'monitor')).toEqual(SCREEN_SHARE_PRESET_PROFILE.gaming)
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
})
