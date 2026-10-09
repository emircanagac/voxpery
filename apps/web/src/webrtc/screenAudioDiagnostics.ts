export interface ScreenAudioRtpSample {
  audioLevel?: number
  totalAudioEnergy?: number
  totalSamplesDuration?: number
  packetsLost?: number
  packetsReceived?: number
  jitterMs?: number
  concealedSamples?: number
  silentConcealedSamples?: number
}

export function finiteStat(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function extractScreenAudioInboundSample(reports: RTCStats[], trackIdentifier: string): ScreenAudioRtpSample | null {
  const byId = new Map(reports.map(report => [report.id, report]))
  for (const raw of reports) {
    const report = raw as RTCStats & Record<string, unknown>
    if (report.type !== 'inbound-rtp' || (report.kind ?? report.mediaType) !== 'audio' || report.isRemote) continue
    const legacy = typeof report.trackId === 'string' ? byId.get(report.trackId) as (RTCStats & { trackIdentifier?: string }) | undefined : undefined
    if ((report.trackIdentifier ?? legacy?.trackIdentifier) !== trackIdentifier) continue
    const jitter = finiteStat(report.jitter)
    return {
      audioLevel: finiteStat(report.audioLevel),
      totalAudioEnergy: finiteStat(report.totalAudioEnergy),
      totalSamplesDuration: finiteStat(report.totalSamplesDuration),
      packetsLost: finiteStat(report.packetsLost), packetsReceived: finiteStat(report.packetsReceived),
      jitterMs: jitter == null ? undefined : jitter * 1000,
      concealedSamples: finiteStat(report.concealedSamples), silentConcealedSamples: finiteStat(report.silentConcealedSamples),
    }
  }
  return null
}

export function screenAudioIntervalRmsDb(previous: ScreenAudioRtpSample | undefined, current: ScreenAudioRtpSample): number | undefined {
  if (previous?.totalAudioEnergy == null || previous.totalSamplesDuration == null
    || current.totalAudioEnergy == null || current.totalSamplesDuration == null) return undefined
  const energy = current.totalAudioEnergy - previous.totalAudioEnergy
  const duration = current.totalSamplesDuration - previous.totalSamplesDuration
  if (!Number.isFinite(energy) || !Number.isFinite(duration) || energy < 0 || duration <= 0) return undefined
  return energy === 0 ? -100 : Math.max(-100, Math.round(10 * Math.log10(energy / duration) * 10) / 10)
}
