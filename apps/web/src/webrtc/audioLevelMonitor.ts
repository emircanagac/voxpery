/**
 * Monitors a MediaStream's audio level and reports when the user is "speaking"
 * (above threshold). Uses hysteresis and a hold period so the indicator stays on
 * while you're talking (including short pauses between words), like Discord.
 */

import { getThresholdsFromStorage } from './sensitivityThreshold'

const SAMPLE_INTERVAL_MS = 50
/** How long level must stay below off-threshold before we set speaking=false (ms). */
const SPEAKING_HOLD_MS = 220

// ── Shared AudioContext pool for remote monitors ──
// Browsers limit concurrent AudioContexts (~6). With 5+ remote peers each creating
// their own context, new ones silently fail. We pool remote monitors onto a single
// shared context and keep a separate one for local monitoring.
let _sharedRemoteCtx: AudioContext | null = null
let _sharedRemoteCtxRefCount = 0

function acquireRemoteAudioContext(): AudioContext | null {
  if (_sharedRemoteCtx && _sharedRemoteCtx.state !== 'closed') {
    _sharedRemoteCtxRefCount++
    if (_sharedRemoteCtx.state === 'suspended') void _sharedRemoteCtx.resume().catch(() => {})
    return _sharedRemoteCtx
  }
  try {
    const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return null
    _sharedRemoteCtx = new AudioCtor()
    _sharedRemoteCtxRefCount = 1
    if (_sharedRemoteCtx.state === 'suspended') void _sharedRemoteCtx.resume().catch(() => {})
    return _sharedRemoteCtx
  } catch {
    return null
  }
}

function releaseRemoteAudioContext(): void {
  _sharedRemoteCtxRefCount = Math.max(0, _sharedRemoteCtxRefCount - 1)
  if (_sharedRemoteCtxRefCount === 0 && _sharedRemoteCtx) {
    try { _sharedRemoteCtx.close() } catch { /* ignore */ }
    _sharedRemoteCtx = null
  }
}

function getRmsThresholdsFromSettings(forRemote: boolean): { on: number; off: number } {
  if (forRemote) {
    // Remote audio is already Krisp-filtered by the sender, so it has lower RMS.
    // Use a low fixed threshold so normal-volume speech reliably lights the ring.
    const on = 0.005
    const off = Math.max(0.001, on * 0.35)
    return { on, off }
  }
  // Local: use the unified Sensitivity Threshold from user settings.
  const { onThr, offThr } = getThresholdsFromStorage()
  return { on: onThr, off: offThr }
}

export function startAudioLevelMonitor(
  stream: MediaStream,
  onSpeakingChange: (speaking: boolean) => void,
  options?: { forRemote?: boolean }
): () => void {
  const forRemote = options?.forRemote ?? false
  const audioTracks = stream.getAudioTracks()
  if (audioTracks.length === 0) {
    return () => { }
  }

  let context: AudioContext | null
  let ownsContext: boolean

  if (forRemote) {
    // Remote monitors share a pooled AudioContext to stay within browser limits.
    context = acquireRemoteAudioContext()
    ownsContext = false
  } else {
    // Local monitor gets a dedicated context so it never interferes with the
    // voice-chain's context (avoids double createMediaStreamSource on same ctx).
    try {
      context = new AudioContext()
      if (context.state === 'suspended') void context.resume().catch(() => {})
    } catch {
      context = null
    }
    ownsContext = true
  }

  if (!context) {
    return forRemote ? releaseRemoteAudioContext : () => {}
  }

  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.3
  source.connect(analyser)

  // getFloatTimeDomainData buffer: some implementations need fftSize; use max(fftSize, frequencyBinCount, 128) to avoid "Index or size is negative or greater than the allowed amount"
  const bufferLength = Math.max(128, analyser.frequencyBinCount || 128, analyser.fftSize || 256)
  const data = new Float32Array(bufferLength)
  let lastSpeaking = false
  let belowCount = 0
  const holdTicks = Math.max(1, Math.ceil(SPEAKING_HOLD_MS / SAMPLE_INTERVAL_MS))

  const check = () => {
    try {
      if (context.state === 'closed') return
      // If suspended (autoplay policy), keep trying to resume; skip this sample.
      if (context.state === 'suspended') {
        void context.resume().catch(() => { })
        return
      }
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      const len = data.length
      if (len <= 0) return
      for (let i = 0; i < len; i++) {
        sum += data[i] * data[i]
      }
      const rms = Math.sqrt(sum / len)
      const thresholds = getRmsThresholdsFromSettings(forRemote)
      const aboveOn = rms >= thresholds.on
      const aboveOff = rms >= thresholds.off
      if (aboveOn) {
        belowCount = 0
        if (!lastSpeaking) {
          lastSpeaking = true
          onSpeakingChange(true)
        }
      } else if (lastSpeaking) {
        if (aboveOff) {
          belowCount = 0
        } else {
          belowCount += 1
          if (belowCount >= holdTicks) {
            lastSpeaking = false
            belowCount = 0
            onSpeakingChange(false)
          }
        }
      }
    } catch {
      // AnalyserNode/getFloatTimeDomainData can throw in edge cases; avoid crashing the app
    }
  }

  const interval = window.setInterval(check, SAMPLE_INTERVAL_MS)

  return () => {
    clearInterval(interval)
    try {
      source.disconnect()
    } catch {
      // ignore
    }
    if (ownsContext) {
      try { context!.close() } catch { /* ignore */ }
    } else {
      releaseRemoteAudioContext()
    }
  }
}
