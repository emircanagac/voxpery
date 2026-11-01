import { useEffect, useState } from 'react'
import { useDesktopUpdateInstall } from '../hooks/useDesktopUpdateInstall'
import { checkForUpdates, type UpdateResult } from '../updater'

/** The sign-in pages have no app shell, so signed-out desktop users learn about updates here. */
export default function DesktopUpdateNotice() {
  const [update, setUpdate] = useState<UpdateResult | null>(null)
  const { installing, statusLabel, install } = useDesktopUpdateInstall()

  useEffect(() => {
    let cancelled = false
    void checkForUpdates().then((result) => {
      if (!cancelled) setUpdate(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!update?.available) return null
  return (
    <div className="auth-notice auth-update-notice" role="status">
      <span>Voxpery {update.version} is available.</span>
      <button
        type="button"
        className="auth-update-btn"
        onClick={() => void install()}
        disabled={installing}
      >
        {installing ? statusLabel : 'Install'}
      </button>
    </div>
  )
}
