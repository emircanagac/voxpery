import { afterEach, expect, it, vi } from 'vitest'
import { createVoiceJoinTiming, rememberMicrophoneCaptureTiming } from './voiceJoinTiming'
import { getVoiceDiagnosticsSnapshot, VOICE_DIAGNOSTICS_STORAGE_KEY } from './voiceDiagnostics'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); delete window.__VOXPERY_VOICE_DIAGNOSTICS__ })

it('measures preflight and connection stages without identifiers or credentials', () => {
  localStorage.setItem(VOICE_DIAGNOSTICS_STORAGE_KEY, '1')
  const now = vi.spyOn(performance, 'now').mockReturnValue(100)
  const stream = {} as MediaStream
  rememberMicrophoneCaptureTiming(stream, 20)
  const timing = createVoiceJoinTiming(stream)
  timing.mark('microphoneMs')
  now.mockReturnValue(150)
  timing.mark('processingMs')
  now.mockReturnValue(200)
  timing.mark('connectionMs')
  timing.finish('connected')
  expect(getVoiceDiagnosticsSnapshot()?.joinTiming).toEqual({ microphoneMs: 80, processingMs: 50, connectionMs: 50, totalMs: 180, outcome: 'connected' })
})

it('does not expose diagnostics without opt-in', () => {
  createVoiceJoinTiming().finish('failed')
  expect(getVoiceDiagnosticsSnapshot()).toBeNull()
})

it('names the stage a running or failed join is waiting for', () => {
  localStorage.setItem(VOICE_DIAGNOSTICS_STORAGE_KEY, '1')
  const now = vi.spyOn(performance, 'now').mockReturnValue(0)
  const timing = createVoiceJoinTiming()
  now.mockReturnValue(40)
  timing.mark('microphoneMs')
  now.mockReturnValue(90)
  timing.mark('processingMs')
  expect(getVoiceDiagnosticsSnapshot()?.joinTiming).toEqual({
    microphoneMs: 40, processingMs: 50, totalMs: 90, outcome: 'joining', pendingStage: 'tokenMs',
  })
  now.mockReturnValue(120)
  timing.mark('tokenMs')
  now.mockReturnValue(5000)
  timing.finish('failed')
  expect(getVoiceDiagnosticsSnapshot()?.joinTiming).toMatchObject({ outcome: 'failed', failedStage: 'turnMs', totalMs: 5000 })
})
