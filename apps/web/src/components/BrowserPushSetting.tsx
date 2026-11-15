import { useEffect, useState } from 'react'
import type { ToastItem } from '../stores/toast'
import { useFeatureStore } from '../stores/features'
import { browserPushEnabled, disableBrowserPush, enableBrowserPush, webPushSupported } from '../webPush'

/**
 * Settings row for notifications while no Voxpery tab is open. Shown only when the server has
 * push keys and this browser can receive pushes.
 */
export default function BrowserPushSetting({
  token,
  pushToast,
}: {
  token: string | null
  pushToast: (toast: Omit<ToastItem, 'id'>, ttlMs?: number) => void
}) {
  const publicKey = useFeatureStore((s) => s.features?.web_push_public_key ?? null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!publicKey) return
    let cancelled = false
    void browserPushEnabled(publicKey).then((value) => {
      if (!cancelled) setEnabled(value)
    })
    return () => {
      cancelled = true
    }
  }, [publicKey])

  if (!publicKey || !webPushSupported()) return null

  const toggle = async () => {
    setBusy(true)
    try {
      if (enabled) {
        await disableBrowserPush(token)
        setEnabled(false)
      } else {
        await enableBrowserPush(publicKey, token)
        setEnabled(true)
      }
    } catch (error) {
      pushToast({
        level: 'error',
        title: 'Could not turn on notifications',
        message: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="user-setting-row user-setting-row--span-two">
      <div>
        <div className="user-setting-title">Notifications when Voxpery is closed</div>
        <div className="user-setting-desc">
          Get direct messages and mentions on this device even when no Voxpery tab is open. Only the sender&apos;s name is sent, never the message.
        </div>
      </div>
      <button
        type="button"
        className={`user-toggle ${enabled ? 'active' : ''}`}
        aria-label="Notifications when Voxpery is closed"
        aria-pressed={enabled}
        disabled={busy}
        onClick={() => { void toggle() }}
      >
        {enabled ? 'On' : 'Off'}
      </button>
    </div>
  )
}
