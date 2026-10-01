import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getOrCreateAudioContext } from '../../audioCues'
import { createRnnoiseNode, type RnnoiseNode } from '../rnnoise'
import {
  connectSilentVoicePipelineKeepAlive,
  resumeVoiceAudioContext,
  shouldUseLightweightMobileVoicePipeline,
  useAudioEngine,
} from './useAudioEngine'

vi.mock('../../audioCues', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../audioCues')>(),
  getOrCreateAudioContext: vi.fn(),
}))
vi.mock('../rnnoise', async (importOriginal) => ({
  ...await importOriginal<typeof import('../rnnoise')>(),
  createRnnoiseNode: vi.fn(),
}))

describe('cancelled microphone processing', () => {
  it('does not build a graph when the room changed while audio was resuming', async () => {
    let resolve!: () => void
    const ctx = {
      state: 'suspended',
      resume: vi.fn(() => new Promise<void>((done) => { resolve = () => { ctx.state = 'running'; done() } })),
      createMediaStreamSource: vi.fn(),
    }
    vi.mocked(getOrCreateAudioContext).mockReturnValueOnce(ctx as unknown as AudioContext)
    const track = { enabled: true } as MediaStreamTrack
    const stream = { getAudioTracks: () => [track] } as unknown as MediaStream
    let current = true
    const { result } = renderHook(() => useAudioEngine())
    const pending = result.current.buildMicSendTrack(stream, 1, true, { current: null }, { current: null }, false, () => current)
    const rejected = expect(pending).rejects.toThrow('no longer active')
    current = false
    resolve()
    await rejected
    expect(ctx.createMediaStreamSource).not.toHaveBeenCalled()
    expect(track.enabled).toBe(false)
  })

  it('destroys a late RNNoise node instead of installing it into the new room', async () => {
    const audioNode = () => ({
      connect: vi.fn(), disconnect: vi.fn(),
      frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 },
    })
    const ctx = {
      state: 'running',
      createMediaStreamSource: audioNode,
      createBiquadFilter: audioNode,
      createGain: audioNode,
    }
    vi.mocked(getOrCreateAudioContext).mockReturnValueOnce(ctx as unknown as AudioContext)
    let resolve!: (node: RnnoiseNode) => void
    vi.mocked(createRnnoiseNode).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const stream = { getAudioTracks: () => [{ enabled: false, getSettings: () => ({}) }] } as unknown as MediaStream
    let current = true
    const { result } = renderHook(() => useAudioEngine())
    const pending = result.current.buildMicSendTrack(stream, 1, true, { current: null }, { current: null }, false, () => current)
    const rejected = expect(pending).rejects.toThrow('no longer active')
    await Promise.resolve()
    await Promise.resolve()
    current = false
    const node = { destroy: vi.fn() } as unknown as RnnoiseNode
    resolve(node)
    await rejected
    expect(node.destroy).toHaveBeenCalledOnce()
  })
})

describe('voice audio context resume', () => {
  it.each(['suspended', 'interrupted'])('resumes a %s context', async (initialState) => {
    const ctx = { state: initialState, resume: vi.fn(async () => { ctx.state = 'running' }) }
    await resumeVoiceAudioContext(ctx as unknown as AudioContext)
    expect(ctx.resume).toHaveBeenCalledOnce()
    expect(ctx.state).toBe('running')
  })

  it.each(['running', 'closed'])('does not resume a %s context', async (state) => {
    const ctx = { state, resume: vi.fn() }
    await resumeVoiceAudioContext(ctx as unknown as AudioContext)
    expect(ctx.resume).not.toHaveBeenCalled()
    await resumeVoiceAudioContext(null)
  })

  it('exposes interruption or permission failures rather than claiming audio recovered', async () => {
    const ctx = { state: 'interrupted', resume: vi.fn().mockResolvedValue(undefined) }
    await expect(resumeVoiceAudioContext(ctx as unknown as AudioContext)).rejects.toThrow('Voice audio is interrupted')
    ctx.resume.mockRejectedValue(new Error('Permission denied'))
    await expect(resumeVoiceAudioContext(ctx as unknown as AudioContext)).rejects.toThrow('Permission denied')
  })
})

describe('mobile voice pipeline selection', () => {
  it('uses the lightweight native-processing path on mobile runtimes', () => {
    expect(shouldUseLightweightMobileVoicePipeline({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile',
      maxTouchPoints: 5,
    })).toBe(true)
    expect(shouldUseLightweightMobileVoicePipeline({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      maxTouchPoints: 5,
    })).toBe(true)
  })

  it('keeps the full processing pipeline on desktop runtimes', () => {
    expect(shouldUseLightweightMobileVoicePipeline({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      maxTouchPoints: 0,
    })).toBe(false)
  })
})

describe('processed microphone pipeline keep-alive', () => {
  it('keeps the shared graph rendering without playing the microphone locally', () => {
    const destination = {} as AudioDestinationNode
    const gain = {
      gain: { value: 1 },
      connect: vi.fn(),
    } as unknown as GainNode
    const ctx = {
      destination,
      createGain: vi.fn(() => gain),
    } as unknown as AudioContext
    const source = { connect: vi.fn() } as unknown as AudioNode

    expect(connectSilentVoicePipelineKeepAlive(ctx, source)).toBe(gain)
    expect(gain.gain.value).toBe(0)
    expect(source.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(destination)
  })
})
