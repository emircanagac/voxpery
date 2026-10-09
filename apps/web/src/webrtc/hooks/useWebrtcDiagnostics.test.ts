import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { Room, Track } from 'livekit-client'
import { VOICE_DIAGNOSTICS_STORAGE_KEY, getVoiceDiagnosticsSnapshot } from '../voiceDiagnostics'
import {
  extractPeerConnectionRttMs,
  extractScreenShareAudioOutboundSample,
  extractScreenShareOutboundSample,
  stableRtcPingTarget,
  useWebrtcDiagnostics,
} from './useWebrtcDiagnostics'

describe('opt-in screen audio sampling', () => {
  it('samples screen-only interval energy at 500 ms and stops polling on unmount', async () => {
    vi.useFakeTimers()
    window.localStorage.setItem(VOICE_DIAGNOSTICS_STORAGE_KEY, '1')
    delete window.__VOXPERY_VOICE_DIAGNOSTICS__
    let energy = 10
    let duration = 100
    const publisherStats = vi.fn(async () => new Map([
      ['source', { id: 'source', type: 'media-source', trackIdentifier: 'private-capture', totalAudioEnergy: energy, totalSamplesDuration: duration }],
      ['outbound', { id: 'outbound', type: 'outbound-rtp', kind: 'audio', mediaSourceId: 'source' }],
    ]))
    const subscriberStats = vi.fn(async () => new Map([
      ['screen', { id: 'screen', type: 'inbound-rtp', kind: 'audio', trackIdentifier: 'private-remote', totalAudioEnergy: energy, totalSamplesDuration: duration, concealedSamples: 48 }],
      ['mic', { id: 'mic', type: 'inbound-rtp', kind: 'audio', trackIdentifier: 'private-mic', totalAudioEnergy: 999 }],
    ]))
    const room = {
      localParticipant: { getTrackPublication: (source: Track.Source) => source === Track.Source.ScreenShareAudio ? { track: { mediaStreamTrack: { id: 'private-capture' } } } : undefined },
      remoteParticipants: new Map([['private-peer', { getTrackPublication: () => ({ track: { mediaStreamTrack: { id: 'private-remote' } } }) }]]),
      engine: { pcManager: { publisher: { pc: { getStats: publisherStats } }, subscriber: { pc: { getStats: subscriberStats } } } },
    } as unknown as Room
    const options = { joinedChannelId: 'channel', isConnected: true, roomRef: { current: room }, roomState: 'connected', remoteStreamsVersion: 1, send: vi.fn(), subscribe: () => () => {} }
    const hook = renderHook(() => useWebrtcDiagnostics(options))
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      energy += 0.005
      duration += 0.5
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      const history = getVoiceDiagnosticsSnapshot()?.screenAudioHistory
      expect(history).toHaveLength(4)
      expect(history?.slice(-2)).toEqual([
        expect.objectContaining({ direction: 'capture', rmsDb: -20 }),
        expect.objectContaining({ direction: 'receive', rmsDb: -20, concealedSamples: 48 }),
      ])
      expect(JSON.stringify(history)).not.toContain('private-')
      hook.unmount()
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(subscriberStats).toHaveBeenCalledTimes(2)
    } finally {
      hook.unmount()
      window.localStorage.removeItem(VOICE_DIAGNOSTICS_STORAGE_KEY)
      delete window.__VOXPERY_VOICE_DIAGNOSTICS__
      vi.useRealTimers()
    }
  })
})

describe('voice RTT diagnostics', () => {
  it('uses the transport-selected candidate pair without mixing fallback RTT samples', () => {
    const reports = [
      {
        id: 'transport-1',
        type: 'transport',
        timestamp: 1_000,
        selectedCandidatePairId: 'selected-pair',
      },
      {
        id: 'selected-pair',
        type: 'candidate-pair',
        timestamp: 1_000,
        state: 'succeeded',
        nominated: true,
        currentRoundTripTime: 0.052,
      },
      {
        id: 'stale-rtcp',
        type: 'remote-inbound-rtp',
        timestamp: 1_000,
        roundTripTime: 0.001,
      },
    ] as unknown as RTCStats[]

    expect(extractPeerConnectionRttMs(reports)).toBe(52)
  })

  it('falls back to a nominated candidate pair and then remote inbound RTP', () => {
    expect(extractPeerConnectionRttMs([{
      id: 'nominated-pair',
      type: 'candidate-pair',
      timestamp: 1_000,
      state: 'succeeded',
      nominated: true,
      currentRoundTripTime: 0.047,
    } as unknown as RTCStats])).toBe(47)

    expect(extractPeerConnectionRttMs([{
      id: 'remote-inbound',
      type: 'remote-inbound-rtp',
      timestamp: 1_000,
      roundTripTime: 0.061,
    } as unknown as RTCStats])).toBe(61)
  })

  it('waits for a stable RTC window before exposing voice ping', () => {
    expect(stableRtcPingTarget([1])).toBeNull()
    expect(stableRtcPingTarget([1, 52])).toBeNull()
    expect(stableRtcPingTarget([1, 52, 54])).toBe(52)
  })
})

describe('screen share outbound diagnostics', () => {
  it('aggregates simulcast layers for the active screen track only', () => {
    const reports = [
      {
        id: 'source-screen',
        type: 'media-source',
        timestamp: 2_000,
        trackIdentifier: 'screen-track',
      },
      {
        id: 'screen-low',
        type: 'outbound-rtp',
        timestamp: 2_000,
        kind: 'video',
        mediaSourceId: 'source-screen',
        frameWidth: 640,
        frameHeight: 360,
        framesPerSecond: 15,
        bytesSent: 10_000,
        packetsSent: 100,
        qualityLimitationReason: 'bandwidth',
      },
      {
        id: 'screen-high',
        type: 'outbound-rtp',
        timestamp: 2_000,
        kind: 'video',
        mediaSourceId: 'source-screen',
        frameWidth: 1280,
        frameHeight: 720,
        framesPerSecond: 30,
        bytesSent: 30_000,
        packetsSent: 200,
        qualityLimitationReason: 'none',
      },
      {
        id: 'camera',
        type: 'outbound-rtp',
        timestamp: 2_000,
        kind: 'video',
        trackIdentifier: 'camera-track',
        bytesSent: 99_000,
      },
    ] as unknown as RTCStats[]

    expect(extractScreenShareOutboundSample(reports, 'screen-track')).toEqual({
      width: 1280,
      height: 720,
      framesPerSecond: 30,
      packetsSent: 300,
      packetsLost: undefined,
      qualityLimitationReason: 'bandwidth',
      bytesSent: 40_000,
      timestamp: 2_000,
    })
  })

  it('returns null when stats do not belong to the screen track', () => {
    expect(extractScreenShareOutboundSample([
      {
        id: 'camera',
        type: 'outbound-rtp',
        timestamp: 1_000,
        kind: 'video',
        trackIdentifier: 'camera-track',
      } as RTCStats,
    ], 'screen-track')).toBeNull()
  })
})

describe('screen share audio outbound diagnostics', () => {
  it('reports the active screen audio codec and transport counters', () => {
    const reports = [
      {
        id: 'source-screen-audio',
        type: 'media-source',
        timestamp: 2_000,
        trackIdentifier: 'screen-audio-track',
      },
      {
        id: 'codec-opus',
        type: 'codec',
        timestamp: 2_000,
        mimeType: 'audio/opus',
        channels: 2,
      },
      {
        id: 'screen-audio-outbound',
        type: 'outbound-rtp',
        timestamp: 2_000,
        kind: 'audio',
        mediaSourceId: 'source-screen-audio',
        codecId: 'codec-opus',
        bytesSent: 24_000,
        packetsSent: 120,
      },
      {
        id: 'screen-audio-remote-inbound',
        type: 'remote-inbound-rtp',
        timestamp: 2_000,
        localId: 'screen-audio-outbound',
        packetsLost: 2,
      },
    ] as unknown as RTCStats[]

    expect(extractScreenShareAudioOutboundSample(reports, 'screen-audio-track')).toEqual({
      packetsSent: 120,
      packetsLost: 2,
      codec: 'audio/opus',
      channels: 2,
      bytesSent: 24_000,
      timestamp: 2_000,
    })
  })

  it('does not confuse microphone output with screen-share audio', () => {
    expect(extractScreenShareAudioOutboundSample([{
      id: 'microphone',
      type: 'outbound-rtp',
      timestamp: 1_000,
      kind: 'audio',
      trackIdentifier: 'microphone-track',
    } as RTCStats], 'screen-audio-track')).toBeNull()
  })
})
