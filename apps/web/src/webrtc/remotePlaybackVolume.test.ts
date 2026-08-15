import { describe, expect, it } from 'vitest'
import {
  getRemotePlaybackVolume,
  normalizeRemoteScreenPlaybackVolume,
  normalizeRemotePlaybackVolume,
  normalizeRemoteVoicePlaybackVolume,
  parseRemotePlaybackVolumes,
  readPreviousScreenPlaybackVolume,
  readRemotePlaybackVolumes,
  REMOTE_PLAYBACK_VOLUME_STORAGE_KEY,
  remotePlaybackVolumeKey,
  writePreviousScreenPlaybackVolume,
  writeRemotePlaybackVolumes,
} from './remotePlaybackVolume'

describe('remote playback volume', () => {
  it('keeps voice and screen playback in their independent ranges', () => {
    expect(normalizeRemotePlaybackVolume(-20)).toBe(0)
    expect(normalizeRemoteVoicePlaybackVolume(65.6)).toBe(66)
    expect(normalizeRemoteVoicePlaybackVolume(200)).toBe(200)
    expect(normalizeRemoteVoicePlaybackVolume(250)).toBe(200)
    expect(normalizeRemoteScreenPlaybackVolume(200)).toBe(100)
  })

  it('migrates legacy peer keys and sanitizes each source independently', () => {
    expect(parseRemotePlaybackVolumes(JSON.stringify({
      peer: 150,
      'voice:other': 175,
      'screen:peer': 180,
      invalid: 'loud',
    }))).toEqual({
      'voice:peer': 150,
      'voice:other': 175,
      'screen:peer': 100,
    })
  })

  it('persists user and stream volume without either value changing the other', () => {
    const storage = window.localStorage
    storage.clear()
    storage.setItem(REMOTE_PLAYBACK_VOLUME_STORAGE_KEY, JSON.stringify({ peer: 125, 'screen:peer': 0 }))

    expect(readRemotePlaybackVolumes(storage)).toEqual({ 'voice:peer': 125, 'screen:peer': 0 })
    expect(storage.getItem(REMOTE_PLAYBACK_VOLUME_STORAGE_KEY)).toBe('{"voice:peer":125,"screen:peer":0}')

    const voiceChanged = writeRemotePlaybackVolumes({
      ...readRemotePlaybackVolumes(storage),
      [remotePlaybackVolumeKey('voice', 'peer')]: 200,
    }, storage)
    expect(getRemotePlaybackVolume(voiceChanged, 'voice', 'peer')).toBe(200)
    expect(getRemotePlaybackVolume(voiceChanged, 'screen', 'peer')).toBe(0)

    const streamChanged = writeRemotePlaybackVolumes({
      ...voiceChanged,
      [remotePlaybackVolumeKey('screen', 'peer')]: 25,
    }, storage)
    expect(getRemotePlaybackVolume(streamChanged, 'voice', 'peer')).toBe(200)
    expect(getRemotePlaybackVolume(streamChanged, 'screen', 'peer')).toBe(25)

    const voiceMuted = writeRemotePlaybackVolumes({
      ...streamChanged,
      [remotePlaybackVolumeKey('voice', 'peer')]: 0,
    }, storage)
    expect(getRemotePlaybackVolume(voiceMuted, 'voice', 'peer')).toBe(0)
    expect(getRemotePlaybackVolume(voiceMuted, 'screen', 'peer')).toBe(25)
  })

  it('keeps the screen unmute restore value outside user volume state', () => {
    const storage = window.localStorage
    storage.clear()

    expect(writePreviousScreenPlaybackVolume('peer', 40, storage)).toBe(40)
    expect(readPreviousScreenPlaybackVolume('peer', storage)).toBe(40)

    writeRemotePlaybackVolumes({
      'voice:peer': 200,
      'screen:peer': 0,
    }, storage)
    expect(readPreviousScreenPlaybackVolume('peer', storage)).toBe(40)
  })
})
