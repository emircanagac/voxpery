import { describe, expect, it } from 'vitest'
import {
  extractPeerConnectionRttMs,
  extractScreenShareAudioOutboundSample,
  extractScreenShareOutboundSample,
  stableRtcPingTarget,
} from './useWebrtcDiagnostics'

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
