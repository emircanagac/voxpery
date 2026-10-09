import { describe, expect, it } from 'vitest'
import { extractScreenAudioInboundSample, finiteStat, screenAudioIntervalRmsDb } from './screenAudioDiagnostics'

describe('shared audio interval diagnostics', () => {
  it('keeps unsupported counters unknown instead of silently treating them as zero', () => {
    for (const value of [null, undefined, '0', NaN, Infinity]) expect(finiteStat(value)).toBeUndefined()
    expect(finiteStat(0)).toBe(0)
  })

  it('matches only shared audio and excludes microphone statistics and identifiers', () => {
    const reports = [
      { id: 'mic', type: 'inbound-rtp', kind: 'audio', trackIdentifier: 'microphone', totalAudioEnergy: 999 },
      { id: 'screen', type: 'inbound-rtp', kind: 'audio', trackIdentifier: 'shared', totalAudioEnergy: 0.1, totalSamplesDuration: 2, jitter: 0.015, concealedSamples: 48 },
    ] as unknown as RTCStats[]
    const sample = extractScreenAudioInboundSample(reports, 'shared')
    expect(sample).toMatchObject({ totalAudioEnergy: 0.1, totalSamplesDuration: 2, jitterMs: 15, concealedSamples: 48 })
    expect(sample).not.toHaveProperty('trackIdentifier')
    expect(sample?.packetsLost).toBeUndefined()
    expect(extractScreenAudioInboundSample(reports, 'missing')).toBeNull()
  })

  it('computes interval energy rather than hiding a brief drop in a lifetime average', () => {
    const previous = { totalAudioEnergy: 10, totalSamplesDuration: 100 }
    expect(screenAudioIntervalRmsDb(previous, { totalAudioEnergy: 10.005, totalSamplesDuration: 100.5 })).toBe(-20)
    expect(screenAudioIntervalRmsDb(previous, { totalAudioEnergy: 10, totalSamplesDuration: 100.5 })).toBe(-100)
    expect(screenAudioIntervalRmsDb(previous, { totalAudioEnergy: 0, totalSamplesDuration: 0 })).toBeUndefined()
    expect(screenAudioIntervalRmsDb(undefined, previous)).toBeUndefined()
  })
})
