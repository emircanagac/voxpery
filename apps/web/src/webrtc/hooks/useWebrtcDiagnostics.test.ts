import { describe, expect, it } from 'vitest'
import { extractScreenShareOutboundSample } from './useWebrtcDiagnostics'

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
