import { useCallback, useEffect, useRef } from 'react'

export type VoiceRecoverySession = {
  identity: object
  microphone: MediaStreamTrack | null
}

type Options = {
  getSession: () => VoiceRecoverySession | null
  resumeAudio: () => Promise<void>
  recoverMicrophone: () => Promise<void>
  onError: (error: unknown) => void
}

// Recovery is foreground-only and never joins a room or changes mute preferences.
export function useVoiceForegroundRecovery({ getSession, resumeAudio, recoverMicrophone, onError }: Options) {
  const pendingRef = useRef<object | null>(null)
  const mountedRef = useRef(false)

  const recover = useCallback(async (fromGesture = false) => {
    if (!mountedRef.current || document.visibilityState !== 'visible') return
    const session = getSession()
    if (!session) return
    const isCurrent = () => mountedRef.current
      && document.visibilityState === 'visible'
      && getSession()?.identity === session.identity

    if (pendingRef.current === session.identity) {
      // Some browsers leave resume() pending until a gesture; do not let that
      // pending attempt prevent the gesture from unlocking the context.
      if (fromGesture) {
        try { await resumeAudio() } catch (error) { if (isCurrent()) onError(error) }
      }
      return
    }
    pendingRef.current = session.identity

    try {
      await resumeAudio()
      if (isCurrent() && getSession()?.microphone?.readyState === 'ended') {
        await recoverMicrophone()
      }
    } catch (error) {
      if (isCurrent()) onError(error)
    } finally {
      if (pendingRef.current === session.identity) pendingRef.current = null
    }
  }, [getSession, onError, recoverMicrophone, resumeAudio])

  useEffect(() => {
    mountedRef.current = true
    const onResume = () => { void recover() }
    const onGesture = () => { void recover(true) }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('pageshow', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('online', onResume)
    // Retry on a real gesture if browser autoplay policy rejected the first resume.
    document.addEventListener('pointerdown', onGesture)
    document.addEventListener('keydown', onGesture)
    return () => {
      mountedRef.current = false
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('pageshow', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('online', onResume)
      document.removeEventListener('pointerdown', onGesture)
      document.removeEventListener('keydown', onGesture)
    }
  }, [recover])

  return recover
}
