import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyPreferredAudioOutputDevice,
  getPreferredMicrophoneStream,
  VOICE_DEVICE_PREFERENCES_CHANGED_EVENT,
  VOICE_INPUT_DEVICE_KEY,
  VOICE_OUTPUT_DEVICE_KEY,
} from './voiceDevices'

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const originalSetSinkId = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'setSinkId')

function unavailableDeviceError(): DOMException {
  return new DOMException('Requested device is unavailable', 'NotFoundError')
}

describe('voice device preferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    if (originalMediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices')
    }
    if (originalSetSinkId) {
      Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', originalSetSinkId)
    } else {
      Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId')
    }
  })

  it('uses the system default microphone when no custom device is stored', async () => {
    const stream = {} as MediaStream
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })

    await expect(getPreferredMicrophoneStream({ channelCount: 1 })).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        deviceId: undefined,
        channelCount: 1,
      }),
      video: false,
    })
  })

  it('preserves and uses an available custom microphone', async () => {
    const stream = {} as MediaStream
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    localStorage.setItem(VOICE_INPUT_DEVICE_KEY, 'custom-mic')

    await expect(getPreferredMicrophoneStream()).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        deviceId: { exact: 'custom-mic' },
      }),
      video: false,
    })
    expect(localStorage.getItem(VOICE_INPUT_DEVICE_KEY)).toBe('custom-mic')
  })

  it('silently falls back to the system microphone when a saved device disappears', async () => {
    const fallbackStream = {} as MediaStream
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(unavailableDeviceError())
      .mockResolvedValueOnce(fallbackStream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    localStorage.setItem(VOICE_INPUT_DEVICE_KEY, 'removed-mic')
    const preferenceChanged = vi.fn()
    window.addEventListener(VOICE_DEVICE_PREFERENCES_CHANGED_EVENT, preferenceChanged)

    await expect(getPreferredMicrophoneStream()).resolves.toBe(fallbackStream)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[0][0]).toEqual({
      audio: expect.objectContaining({
        deviceId: { exact: 'removed-mic' },
      }),
      video: false,
    })
    expect(getUserMedia.mock.calls[1][0]).toEqual({
      audio: expect.objectContaining({
        deviceId: undefined,
      }),
      video: false,
    })
    expect(localStorage.getItem(VOICE_INPUT_DEVICE_KEY)).toBeNull()
    expect(preferenceChanged).toHaveBeenCalledOnce()
    window.removeEventListener(VOICE_DEVICE_PREFERENCES_CHANGED_EVENT, preferenceChanged)
  })

  it('does not replace a custom microphone when access fails for another reason', async () => {
    const permissionError = new DOMException('Permission denied', 'NotAllowedError')
    const getUserMedia = vi.fn().mockRejectedValue(permissionError)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    localStorage.setItem(VOICE_INPUT_DEVICE_KEY, 'custom-mic')

    await expect(getPreferredMicrophoneStream()).rejects.toBe(permissionError)
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(localStorage.getItem(VOICE_INPUT_DEVICE_KEY)).toBe('custom-mic')
  })

  it('preserves a custom microphone when another capture constraint is unsupported', async () => {
    const constraintError = Object.assign(
      new DOMException('Unsupported channel count', 'OverconstrainedError'),
      { constraint: 'channelCount' },
    )
    const getUserMedia = vi.fn().mockRejectedValue(constraintError)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    localStorage.setItem(VOICE_INPUT_DEVICE_KEY, 'custom-mic')

    await expect(getPreferredMicrophoneStream({ channelCount: 1 })).rejects.toBe(constraintError)
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(localStorage.getItem(VOICE_INPUT_DEVICE_KEY)).toBe('custom-mic')
  })

  it('silently falls back to the system speaker when a saved output disappears', async () => {
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      configurable: true,
      value: vi.fn(),
    })
    const element = document.createElement('audio') as HTMLAudioElement & {
      sinkId?: string
      setSinkId: (sinkId: string) => Promise<void>
    }
    const setSinkId = vi.fn()
      .mockRejectedValueOnce(unavailableDeviceError())
      .mockResolvedValueOnce(undefined)
    Object.defineProperty(element, 'setSinkId', {
      configurable: true,
      value: setSinkId,
    })
    localStorage.setItem(VOICE_OUTPUT_DEVICE_KEY, 'removed-speaker')

    await expect(applyPreferredAudioOutputDevice(element)).resolves.toBe(true)
    expect(setSinkId).toHaveBeenNthCalledWith(1, 'removed-speaker')
    expect(setSinkId).toHaveBeenNthCalledWith(2, 'default')
    expect(localStorage.getItem(VOICE_OUTPUT_DEVICE_KEY)).toBeNull()
  })

  it('preserves a custom speaker when output switching is blocked rather than unavailable', async () => {
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      configurable: true,
      value: vi.fn(),
    })
    const element = document.createElement('audio') as HTMLAudioElement & {
      sinkId?: string
      setSinkId: (sinkId: string) => Promise<void>
    }
    const permissionError = new DOMException('Output selection is blocked', 'NotAllowedError')
    const setSinkId = vi.fn().mockRejectedValue(permissionError)
    Object.defineProperty(element, 'setSinkId', {
      configurable: true,
      value: setSinkId,
    })
    localStorage.setItem(VOICE_OUTPUT_DEVICE_KEY, 'custom-speaker')

    await expect(applyPreferredAudioOutputDevice(element)).resolves.toBe(false)
    expect(setSinkId).toHaveBeenCalledOnce()
    expect(localStorage.getItem(VOICE_OUTPUT_DEVICE_KEY)).toBe('custom-speaker')
  })
})
