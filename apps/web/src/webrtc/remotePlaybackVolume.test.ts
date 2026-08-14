import { describe, expect, it } from 'vitest'
import {
  normalizeRemotePlaybackVolume,
  parseRemotePlaybackVolumes,
  readRemotePlaybackVolumes,
  REMOTE_PLAYBACK_VOLUME_STORAGE_KEY,
  writeRemotePlaybackVolumes,
} from './remotePlaybackVolume'

describe('remote playback volume', () => {
  it('keeps playback in the distortion-safe media element range', () => {
    expect(normalizeRemotePlaybackVolume(-20)).toBe(0)
    expect(normalizeRemotePlaybackVolume(65.6)).toBe(66)
    expect(normalizeRemotePlaybackVolume(100)).toBe(100)
    expect(normalizeRemotePlaybackVolume(200)).toBe(100)
  })

  it('sanitizes saved peer and screen-share volumes', () => {
    expect(parseRemotePlaybackVolumes(JSON.stringify({
      peer: 150,
      'screen:peer': 80,
      invalid: 'loud',
    }))).toEqual({
      peer: 100,
      'screen:peer': 80,
    })
  })

  it('migrates legacy amplified values in storage', () => {
    const storage = window.localStorage
    storage.clear()
    storage.setItem(REMOTE_PLAYBACK_VOLUME_STORAGE_KEY, JSON.stringify({ peer: 200 }))

    expect(readRemotePlaybackVolumes(storage)).toEqual({ peer: 100 })
    expect(storage.getItem(REMOTE_PLAYBACK_VOLUME_STORAGE_KEY)).toBe('{"peer":100}')

    expect(writeRemotePlaybackVolumes({ peer: 125, 'screen:peer': 40 }, storage)).toEqual({
      peer: 100,
      'screen:peer': 40,
    })
  })
})
