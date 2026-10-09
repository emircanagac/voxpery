import { DEFAULT_SCRIPT_ID, SCRIPT_URL } from '@marsidev/react-turnstile'

const LOAD_TIMEOUT_MS = 15_000
let pending: Promise<void> | undefined

function available() {
  return typeof window.turnstile?.render === 'function'
}

export function loadTurnstileScript(): Promise<void> {
  if (available()) return Promise.resolve()
  if (pending) return pending

  pending = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(DEFAULT_SCRIPT_ID)
    if (existing && (!(existing instanceof HTMLScriptElement) || !existing.src.startsWith(`${SCRIPT_URL}?`))) {
      reject(new Error('CAPTCHA script configuration is invalid'))
      return
    }
    const script = existing as HTMLScriptElement | null ?? document.createElement('script')
    const owned = !existing
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      script.removeEventListener('load', loaded)
      script.removeEventListener('error', failed)
      if (error) {
        // Only the verified provider script is removed; retry must issue a new request.
        script.remove()
        reject(error)
      } else resolve()
    }
    const loaded = () => finish(available() ? undefined : new Error('CAPTCHA could not be initialized'))
    const failed = () => finish(new Error('CAPTCHA could not be loaded. Check your connection and try again.'))
    const timeout = window.setTimeout(() => finish(new Error('CAPTCHA loading timed out. Check your connection and try again.')), LOAD_TIMEOUT_MS)
    script.addEventListener('load', loaded, { once: true })
    script.addEventListener('error', failed, { once: true })
    if (owned) {
      script.id = DEFAULT_SCRIPT_ID
      script.src = `${SCRIPT_URL}?render=explicit`
      script.async = true
      document.head.appendChild(script)
    }
  }).finally(() => { pending = undefined })
  return pending
}
