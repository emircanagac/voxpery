export type RnnoiseRuntimeStatus = 'disabled' | 'loading' | 'ready' | 'failed'

export interface VoiceRuntimeDiagnostics {
  rnnoiseStatus?: RnnoiseRuntimeStatus
  rnnoiseError?: string
  rnnoiseWorkletUrl?: string
  noiseSuppressionEnabled?: boolean
  voiceInputProfile?: string
  speakingPreset?: string
  speakingThreshold?: number
  speakingThresholdDb?: number
  suppressionTuning?: string
  aggressiveIsolation?: boolean
  updatedAt?: string
}

export const VOICE_DIAGNOSTICS_STORAGE_KEY = 'voxperyVoiceDiagnostics'

declare global {
  interface Window {
    __VOXPERY_VOICE_DIAGNOSTICS__?: VoiceRuntimeDiagnostics
  }
}

export function isVoiceDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false

  try {
    return window.localStorage.getItem(VOICE_DIAGNOSTICS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function updateVoiceDiagnostics(patch: VoiceRuntimeDiagnostics): void {
  if (typeof window === 'undefined') return
  if (!isVoiceDiagnosticsEnabled()) {
    delete window.__VOXPERY_VOICE_DIAGNOSTICS__
    return
  }

  window.__VOXPERY_VOICE_DIAGNOSTICS__ = {
    ...(window.__VOXPERY_VOICE_DIAGNOSTICS__ ?? {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  }
}

export type VoiceQualityLevel = 'unknown' | 'good' | 'fair' | 'poor'

export interface VoiceNetworkMetrics {
  hasActiveVoiceSession: boolean
  pingMs: number | null
  packetLossPct: number | null
  jitterMs: number | null
  pingJitterMs: number | null
}

export interface VoiceQualitySummary {
  level: VoiceQualityLevel
  reason: string
}

export interface VoiceErrorInfo {
  level: 'error' | 'info'
  title: string
  message: string
}

export function getVoiceNetworkQuality(metrics: VoiceNetworkMetrics): VoiceQualitySummary {
  const { hasActiveVoiceSession, pingMs, packetLossPct, jitterMs, pingJitterMs } = metrics
  if (!hasActiveVoiceSession || pingMs == null) {
    return { level: 'unknown', reason: 'Voice quality is being measured.' }
  }

  if (pingMs >= 220 || (packetLossPct ?? 0) >= 5 || (jitterMs ?? 0) >= 45) {
    return { level: 'poor', reason: 'High latency, packet loss, or jitter may affect voice.' }
  }

  if (pingMs >= 120 || (packetLossPct ?? 0) >= 2 || (jitterMs ?? 0) >= 25 || (pingJitterMs ?? 0) >= 35) {
    return { level: 'fair', reason: 'Voice is usable, but the connection is not ideal.' }
  }

  return { level: 'good', reason: 'Voice connection looks healthy.' }
}

export function getVoicePingLevel(hasActiveVoiceSession: boolean, pingMs: number | null): VoiceQualityLevel {
  if (!hasActiveVoiceSession || pingMs == null) return 'unknown'
  if (pingMs >= 220) return 'poor'
  if (pingMs >= 120) return 'fair'
  return 'good'
}

export function voiceQualityLabel(level: VoiceQualityLevel): string {
  if (level === 'good') return 'Good voice quality'
  if (level === 'fair') return 'Fair voice quality'
  if (level === 'poor') return 'Poor voice quality'
  return 'Measuring voice quality'
}

export function formatMetric(value: number | null, suffix: string, fallback = 'Measuring'): string {
  return value == null ? fallback : `${value}${suffix}`
}

export function getVoiceQualityAdvice(
  summary: VoiceQualitySummary,
  roomState: string,
): string {
  if (roomState === 'reconnecting') {
    return 'Voice is reconnecting. Stay in the channel; Voxpery will resync when the network returns.'
  }
  if (summary.level === 'poor') {
    return 'Try a steadier connection, close heavy downloads, or move closer to your router.'
  }
  if (summary.level === 'fair') {
    return 'If audio breaks up, reduce network load or switch to a more stable connection.'
  }
  if (summary.level === 'good') {
    return 'No action needed.'
  }
  return 'Stats appear after the media room connects and the first samples arrive.'
}

export function buildVoiceDiagnosticRows(metrics: VoiceNetworkMetrics, voiceMode: string) {
  return [
    { label: 'Ping', value: formatMetric(metrics.pingMs, ' ms') },
    { label: 'Loss', value: formatMetric(metrics.packetLossPct, '%') },
    { label: 'Jitter', value: formatMetric(metrics.jitterMs, ' ms') },
    { label: 'Mode', value: voiceMode === 'push_to_talk' ? 'Push to talk' : 'Voice activity' },
  ]
}

export function classifyVoiceError(err: unknown): VoiceErrorInfo {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const lower = raw.toLowerCase()

  if (
    lower.includes('voice access denied') ||
    lower.includes('missing required permission') ||
    lower.includes('forbidden')
  ) {
    return {
      level: 'info',
      title: 'Voice access denied',
      message: "You don't have permission to connect to this voice channel.",
    }
  }

  if (
    lower.includes('feature_disabled') ||
    lower.includes('voice service is not configured') ||
    (lower.includes('livekit') && lower.includes('not configured')) ||
    lower.includes('internal server error')
  ) {
    return {
      level: 'error',
      title: 'Voice service unavailable',
      message: 'Voice media service is unavailable right now. Try again after the server voice configuration is fixed.',
    }
  }

  if (lower.includes('connection_error') || lower.includes('websocket is not connected')) {
    return {
      level: 'error',
      title: 'Voice service reconnecting',
      message: 'The app is reconnecting to the server. Wait a few seconds and try joining voice again.',
    }
  }

  if (lower.includes('timeout')) {
    return {
      level: 'error',
      title: 'Voice connection timed out',
      message: 'Voxpery could not reach the voice media service in time. Check your network and retry.',
    }
  }

  if (lower.includes('permission denied') || lower.includes('notallowederror') || lower.includes('microphone permission')) {
    return {
      level: 'error',
      title: 'Microphone access required',
      message: 'Allow microphone access in your browser or system settings, then retry voice.',
    }
  }

  if (lower.includes('notfounderror') || lower.includes('device not found') || lower.includes('no microphone')) {
    return {
      level: 'error',
      title: 'No microphone detected',
      message: 'Connect a microphone or choose another input device, then retry voice.',
    }
  }

  if (lower.includes('notreadableerror') || lower.includes('in use by another app') || lower.includes('microphone is in use')) {
    return {
      level: 'error',
      title: 'Microphone is busy',
      message: 'Close other apps using the microphone, then retry voice.',
    }
  }

  if (
    lower.includes('ice') ||
    lower.includes('failed to connect') ||
    lower.includes('network') ||
    lower.includes('disconnected')
  ) {
    return {
      level: 'error',
      title: 'Voice connection failed',
      message: 'The voice media connection failed. Check your network, VPN, firewall, or LiveKit reachability and retry.',
    }
  }

  return {
    level: 'error',
    title: 'Voice action failed',
    message: raw || 'Voice action failed. Try again in a few seconds.',
  }
}
