import { useEffect, useState } from 'react'
import {
  PUSH_NOTIFICATION_STATE_CHANGED_EVENT,
  requestPushNotificationPermission,
  setPushNotificationsEnabled,
  shouldOfferPushNotificationPrompt,
  snoozePushNotificationPrompt,
} from '../pushNotifications'

const DEFAULT_PROMPT_DELAY_MS = 120_000

interface NotificationPermissionPromptProps {
  ready: boolean
  delayMs?: number
}

export default function NotificationPermissionPrompt({
  ready,
  delayMs = DEFAULT_PROMPT_DELAY_MS,
}: NotificationPermissionPromptProps) {
  const [visible, setVisible] = useState(false)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    setVisible(false)
    if (!ready) return

    let delayElapsed = false
    const syncVisibility = () => {
      if (!delayElapsed) return
      setVisible(document.visibilityState === 'visible'
        && document.hasFocus()
        && shouldOfferPushNotificationPrompt())
    }
    const timeoutId = window.setTimeout(() => {
      delayElapsed = true
      syncVisibility()
    }, delayMs)

    window.addEventListener(PUSH_NOTIFICATION_STATE_CHANGED_EVENT, syncVisibility)
    window.addEventListener('focus', syncVisibility)
    window.addEventListener('blur', syncVisibility)
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener(PUSH_NOTIFICATION_STATE_CHANGED_EVENT, syncVisibility)
      window.removeEventListener('focus', syncVisibility)
      window.removeEventListener('blur', syncVisibility)
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [delayMs, ready])

  if (!visible) return null

  const dismiss = () => {
    snoozePushNotificationPrompt()
    setVisible(false)
  }

  const enable = async () => {
    if (requesting) return
    setRequesting(true)
    try {
      const permission = await requestPushNotificationPermission()
      if (permission === 'granted') {
        setPushNotificationsEnabled(true, true)
      } else if (permission === 'denied') {
        setPushNotificationsEnabled(false, true)
      } else {
        snoozePushNotificationPrompt()
      }
      setVisible(false)
    } catch {
      snoozePushNotificationPrompt()
      setVisible(false)
    } finally {
      setRequesting(false)
    }
  }

  return (
    <section className="shell-notification-cta" aria-label="Enable notifications" aria-live="polite">
      <div className="shell-notification-cta-copy">
        <strong>Stay in the loop</strong>
        <span>Get alerts for direct messages and friend requests when Voxpery is in the background.</span>
      </div>
      <div className="shell-notification-cta-actions">
        <button type="button" className="shell-notification-cta-dismiss" onClick={dismiss}>
          Not now
        </button>
        <button
          type="button"
          className="shell-notification-cta-enable"
          onClick={() => void enable()}
          disabled={requesting}
        >
          {requesting ? 'Enabling...' : 'Enable'}
        </button>
      </div>
    </section>
  )
}
