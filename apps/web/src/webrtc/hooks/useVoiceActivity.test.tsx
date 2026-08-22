import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../stores/app'
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
})
