import { useState } from 'react'
import { serverApi } from '../api'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'

/**
 * Replaces a server's invite link. The old link stops working at once, so the action asks for a
 * second click before it runs.
 */
export default function InviteRotateControl({ serverId }: { serverId: string }) {
  const token = useAuthStore((s) => s.token)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const rotate = async () => {
    setBusy(true)
    try {
      const updated = await serverApi.rotateInvite(serverId, token)
      const store = useAppStore.getState()
      store.setServers(store.servers.map((server) => (server.id === updated.id
        ? { ...server, invite_code: updated.invite_code }
        : server)))
      useToastStore.getState().pushToast({
        level: 'info',
        title: 'Invite link reset',
        message: 'The old invite link no longer works. Share the new one.',
      })
    } catch (error) {
      useToastStore.getState().pushToast({
        level: 'error',
        title: 'Could not reset the invite link',
        message: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <div className="invite-rotate">
        <button type="button" className="copy-btn" onClick={() => setConfirming(true)}>
          Reset invite link
        </button>
      </div>
    )
  }

  return (
    <div className="invite-rotate" role="group" aria-label="Reset invite link">
      <p className="invite-rotate__warning">
        The current link and code stop working right away. People who already joined stay.
      </p>
      <div className="invite-unified-actions">
        <button type="button" className="copy-btn invite-rotate__confirm" disabled={busy} onClick={() => { void rotate() }}>
          {busy ? 'Resetting…' : 'Reset link'}
        </button>
        <button type="button" className="copy-btn" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
