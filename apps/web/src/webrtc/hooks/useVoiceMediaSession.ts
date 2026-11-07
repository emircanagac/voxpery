import { useEffect, useRef } from 'react'

// Near-silent loop (about -90 dBFS, 10 s). Chrome shows a media notification and treats the page
// as playing media only for a media element with a file source; voice audio itself comes from
// WebRTC streams, which get neither. Unverified on real devices: see docs/VOICE_SYSTEM.md.
export const VOICE_SESSION_ANCHOR_URL = '/voice-session-anchor.wav'

/**
 * Only Android browsers can keep a backgrounded page alive through media playback. iOS Safari
 * suspends capture in the background regardless, so an extra audio element there would only
 * add a lock-screen player without helping the call.
 */
export function supportsVoiceMediaSessionAnchor(
  navigatorTarget: Pick<Navigator, 'userAgent'> | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  return Boolean(navigatorTarget && /android/i.test(navigatorTarget.userAgent))
}

type Options = {
  /** True while connected to a voice channel in an Android browser. */
  active: boolean
  title: string
  muted: boolean
  onToggleMute: () => void
  onLeave: () => void
}

type ConferenceMediaSession = MediaSession & {
  setMicrophoneActive?: (active: boolean) => void
}

function setHandler(session: MediaSession, action: string, handler: (() => void) | null) {
  try {
    session.setActionHandler(action as MediaSessionAction, handler)
  } catch {
    // Browsers throw for actions they do not know (for example `hangup` or `togglemicrophone`).
  }
}

/**
 * Keeps a mobile voice call visible as an ongoing media session (system media notification with
 * mute and leave controls) so the browser is less likely to suspend the page in the background.
 */
export function useVoiceMediaSession({ active, title, muted, onToggleMute, onLeave }: Options) {
  const callbacksRef = useRef({ onToggleMute, onLeave })
  useEffect(() => {
    callbacksRef.current = { onToggleMute, onLeave }
  }, [onLeave, onToggleMute])

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const anchor = new Audio(VOICE_SESSION_ANCHOR_URL)
    anchor.loop = true
    // Joining is a user gesture, so playback is allowed; if the browser still refuses, the call
    // works as before without the notification.
    void anchor.play().catch(() => {})

    const leave = () => callbacksRef.current.onLeave()
    setHandler(session, 'hangup', leave)
    setHandler(session, 'stop', leave)
    setHandler(session, 'togglemicrophone', () => callbacksRef.current.onToggleMute())
    // Pausing the anchor would end the session while the call continues; keep it playing.
    setHandler(session, 'pause', () => { void anchor.play().catch(() => {}) })
    session.playbackState = 'playing'

    return () => {
      anchor.pause()
      anchor.removeAttribute('src')
      anchor.load()
      for (const action of ['hangup', 'stop', 'togglemicrophone', 'pause']) setHandler(session, action, null)
      session.metadata = null
      session.playbackState = 'none'
    }
  }, [active])

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (typeof MediaMetadata === 'undefined') return
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: 'Voxpery voice',
      artwork: [{ src: '/1024.png', sizes: '1024x1024', type: 'image/png' }],
    })
  }, [active, title])

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try {
      (navigator.mediaSession as ConferenceMediaSession).setMicrophoneActive?.(!muted)
    } catch {
      // Optional API.
    }
  }, [active, muted])
}
