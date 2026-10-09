import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScreenAudioPcmMonitor } from './screenAudioPcmMonitor'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function fixture() {
  vi.useFakeTimers()
  let amplitude = 0.1
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const analyser = {
    fftSize: 2048, connect: vi.fn(), disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.fill(amplitude)),
  }
  const silentOutput = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  const track = { readyState: 'live', stop: vi.fn() } as unknown as MediaStreamTrack
  const context = {
    state: 'running', destination: {},
    createMediaStreamSource: () => source,
    createAnalyser: () => analyser, createGain: () => silentOutput,
  } as unknown as AudioContext
  return {
    track, context, source, analyser, silentOutput,
    createStream: (tracks: MediaStreamTrack[]) => ({ tracks }) as unknown as MediaStream,
    setAmplitude: (value: number) => { amplitude = value },
  }
}

describe('screen audio PCM measurement', () => {
  it('measures a drop without recording or playing a second output and cleans up', () => {
    const f = fixture()
    const monitor = createScreenAudioPcmMonitor(f.track, f.context, f.createStream)
    vi.advanceTimersByTime(100)
    expect(monitor.sample()).toMatchObject({ rmsDb: -20, samples: 2 })
    f.setAmplitude(0.01)
    vi.advanceTimersByTime(100)
    expect(monitor.sample()).toMatchObject({ rmsDb: -40, minimumRmsDb: -40, samples: 2 })
    expect(f.silentOutput.gain.value).toBe(0)
    monitor.dispose()
    vi.advanceTimersByTime(500)
    expect(f.analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(4)
    expect(f.source.disconnect).toHaveBeenCalledTimes(1)
    expect(f.analyser.disconnect).toHaveBeenCalledTimes(1)
    expect(f.silentOutput.disconnect).toHaveBeenCalledTimes(1)
    expect(f.track.stop).not.toHaveBeenCalled()
  })

  it('reports unknown instead of silence for a suspended context or ended track', () => {
    const f = fixture()
    const monitor = createScreenAudioPcmMonitor(f.track, f.context, f.createStream)
    Object.defineProperty(f.context, 'state', { value: 'suspended', configurable: true })
    vi.advanceTimersByTime(500)
    expect(monitor.sample()).toEqual({ contextState: 'suspended', samples: 0, rmsDb: undefined, minimumRmsDb: undefined })
    Object.defineProperty(f.context, 'state', { value: 'running' })
    Object.defineProperty(f.track, 'readyState', { value: 'ended' })
    vi.advanceTimersByTime(500)
    expect(monitor.sample().rmsDb).toBeUndefined()
    monitor.dispose()
  })
})
