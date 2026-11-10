import { updateVoiceDiagnostics } from './voiceDiagnostics'

type CaptureTiming = { startedAt: number; completedAt: number }
const captureTimings = new WeakMap<MediaStream, CaptureTiming>()

const JOIN_STAGES = ['microphoneMs', 'processingMs', 'tokenMs', 'turnMs', 'connectionMs', 'publicationMs'] as const
export type VoiceJoinStage = typeof JOIN_STAGES[number]
type JoinStage = VoiceJoinStage

export function rememberMicrophoneCaptureTiming(stream: MediaStream, startedAt: number): void {
  captureTimings.set(stream, { startedAt, completedAt: performance.now() })
}

/**
 * Measures the stages of one voice join. While the join runs, the diagnostics name the stage it
 * is waiting for, so a join that never finishes still shows where it stopped; `onStage` reports
 * the same stage to the joining view (and `null` once the join is over).
 */
export function createVoiceJoinTiming(
  stream?: MediaStream | null,
  onStage?: (stage: VoiceJoinStage | null) => void,
) {
  const capture = stream ? captureTimings.get(stream) : undefined
  if (stream) captureTimings.delete(stream)
  const startedAt = capture?.startedAt ?? performance.now()
  let last = performance.now()
  const stages: Partial<Record<JoinStage, number>> = {}
  if (capture) stages.microphoneMs = Math.round(capture.completedAt - capture.startedAt)
  let pendingStage: JoinStage | undefined = JOIN_STAGES[0]
  const elapsed = () => Math.round(performance.now() - startedAt)
  onStage?.(pendingStage ?? null)
  return {
    mark(stage: JoinStage) {
      const now = performance.now()
      if (!(stage === 'microphoneMs' && capture)) stages[stage] = Math.round(now - last)
      last = now
      pendingStage = JOIN_STAGES[JOIN_STAGES.indexOf(stage) + 1]
      updateVoiceDiagnostics({
        joinTiming: { ...stages, totalMs: elapsed(), outcome: 'joining', ...(pendingStage ? { pendingStage } : {}) },
      })
      onStage?.(pendingStage ?? null)
    },
    /** Records the outcome and returns the total join time in milliseconds. */
    finish(outcome: 'connected' | 'failed'): number {
      const totalMs = elapsed()
      onStage?.(null)
      updateVoiceDiagnostics({
        joinTiming: {
          ...stages,
          totalMs,
          outcome,
          ...(outcome === 'failed' && pendingStage ? { failedStage: pendingStage } : {}),
        },
      })
      return totalMs
    },
  }
}
