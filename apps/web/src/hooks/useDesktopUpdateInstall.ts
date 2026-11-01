import { useCallback, useState } from 'react'
import { useToastStore } from '../stores/toast'
import { downloadAndInstallUpdate, updateProgressLabel, type UpdateProgress } from '../updater'

/** Installs the desktop update and reports how far it got. */
export function useDesktopUpdateInstall() {
  const pushToast = useToastStore((s) => s.pushToast)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)

  const install = useCallback(async () => {
    setInstalling(true)
    setProgress(null)
    try {
      const ok = await downloadAndInstallUpdate(setProgress)
      if (!ok) {
        pushToast({
          level: 'error',
          title: 'Update failed',
          message: 'Could not download or install the desktop update. Try again later.',
        })
        return
      }
      pushToast({
        level: 'info',
        title: 'Installing update',
        message: 'Voxpery will restart after the update is applied.',
      })
    } finally {
      setInstalling(false)
    }
  }, [pushToast])

  return { installing, statusLabel: updateProgressLabel(progress), install }
}
