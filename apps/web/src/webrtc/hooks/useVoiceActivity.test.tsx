import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../stores/app'
import { GLOBAL_PUSH_TO_TALK_EVENT } from '../../globalPushToTalk'
import { useVoiceActivity } from './useVoiceActivity'

describe('useVoiceActivity', () => {
  let animationFrames: FrameRequestCallback[]
  let amplitude: number

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('voxpery-settings-voice-mode', 'voice_activity')
    localStorage.setItem('voxpery-settings-noise-suppression', '0')
    useAppStore.setState({ voiceControls: {}, voiceSpeakingUserIds: [], voiceLocalSpeaking: false })
    animationFrames = []
    amplitude = 0.4
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the published microphone state stable across VAD speaking edges', () => {
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    const analyser = {
      fftSize: 256,
      frequencyBinCount: 128,
      smoothingTimeConstant: 0,
      getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.fill(amplitude)),
      getFloatFrequencyData: vi.fn((buffer: Float32Array) => buffer.fill(-40)),
      disconnect: vi.fn(),
    }
    const audioContext = {
      state: 'running',
      sampleRate: 48_000,
      createMediaStreamSource: vi.fn(() => source),
      createAnalyser: vi.fn(() => analyser),
    } as unknown as AudioContext
    const setLocalMicMuted = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useVoiceActivity({
      userId: 'local-user',
      joinedChannelId: 'voice-1',
      localStream: {} as MediaStream,
      getAudioContext: () => audioContext,
      setLocalMicMuted,
    }))

    act(() => result.current.startLocalSpeakingMonitor())
    act(() => {
      for (let index = 0; index < 8; index += 1) {
        animationFrames.shift()?.(index * 16)
      }
    })
    expect(useAppStore.getState().voiceLocalSpeaking).toBe(true)

    amplitude = 0
    act(() => {
      for (let index = 0; index < 240; index += 1) {
        animationFrames.shift()?.((index + 8) * 16)
      }
    })

    expect(useAppStore.getState().voiceLocalSpeaking).toBe(false)
    expect(setLocalMicMuted).not.toHaveBeenCalled()
  })

  it('opens and closes push-to-talk from desktop global press and release events', () => {
    localStorage.setItem('voxpery-settings-voice-mode', 'push_to_talk')
    localStorage.setItem('voxpery-settings-ptt-key', 'V')
    const setLocalMicMuted = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useVoiceActivity({
      userId: 'local-user',
      joinedChannelId: 'voice-1',
      localStream: null,
      getAudioContext: () => null,
      setLocalMicMuted,
    }))

    act(() => {
      window.dispatchEvent(new CustomEvent(GLOBAL_PUSH_TO_TALK_EVENT, { detail: 'Pressed' }))
    })
    expect(setLocalMicMuted).toHaveBeenLastCalledWith(false)

    act(() => {
      window.dispatchEvent(new CustomEvent(GLOBAL_PUSH_TO_TALK_EVENT, { detail: 'Released' }))
    })
    expect(setLocalMicMuted).toHaveBeenLastCalledWith(true)
  })

  it('closes push-to-talk when the window loses focus', () => {
    localStorage.setItem('voxpery-settings-voice-mode', 'push_to_talk')
    const setLocalMicMuted = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useVoiceActivity({
      userId: 'local-user',
      joinedChannelId: 'voice-1',
      localStream: null,
      getAudioContext: () => null,
      setLocalMicMuted,
    }))

    act(() => {
      window.dispatchEvent(new CustomEvent(GLOBAL_PUSH_TO_TALK_EVENT, { detail: 'Pressed' }))
      window.dispatchEvent(new Event('blur'))
    })

    expect(setLocalMicMuted).toHaveBeenLastCalledWith(true)
  })
})
