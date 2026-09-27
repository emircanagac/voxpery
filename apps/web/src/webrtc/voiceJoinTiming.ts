import { updateVoiceDiagnostics } from './voiceDiagnostics'

type CaptureTiming = { startedAt: number; completedAt: number }
const captureTimings = new WeakMap<MediaStream, CaptureTiming>()

export function rememberMicrophoneCaptureTiming(stream: MediaStream, startedAt: number): void {
  captureTimings.set(stream, { startedAt, completedAt: performance.now() })
}

export function createVoiceJoinTiming(stream?: MediaStream | null) {
  const capture = stream ? captureTimings.get(stream) : undefined
  if (stream) captureTimings.delete(stream)
  const startedAt = capture?.startedAt ?? performance.now()
  let last = performance.now()
  const stages: Record<string, number> = {}
  if (capture) stages.microphoneMs = Math.round(capture.completedAt - capture.startedAt)
  return {
    mark(stage: 'microphoneMs' | 'processingMs' | 'tokenMs' | 'turnMs' | 'connectionMs' | 'publicationMs') {
      const now = performance.now()
      if (!(stage === 'microphoneMs' && capture)) stages[stage] = Math.round(now - last)
      last = now
    },
    finish(outcome: 'connected' | 'failed') {
      updateVoiceDiagnostics({ joinTiming: { ...stages, totalMs: Math.round(performance.now() - startedAt), outcome } })
    },
  }
}
