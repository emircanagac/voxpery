import { useEffect, useState, type KeyboardEvent } from 'react'
import {
  checkDesktopServer,
  getDesktopServer,
  serverLabel,
  switchDesktopServer,
  type DesktopServer,
} from '../desktopServer'

type Props = {
  /** `login`: a collapsed "Advanced" link under the sign-in form; `settings`: a settings row. */
  variant: 'login' | 'settings'
}

/** Desktop only: connect to a self-hosted Voxpery server instead of voxpery.com. */
export default function CustomServerPanel({ variant }: Props) {
  const [active, setActive] = useState<DesktopServer | null>(null)
  const [open, setOpen] = useState(variant === 'settings')
  const [address, setAddress] = useState('')
  const [checked, setChecked] = useState<DesktopServer | null>(null)
  const [trusted, setTrusted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void getDesktopServer()
      .then((server) => {
        if (!cancelled) setActive(server)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const run = async (task: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const check = () => run(async () => {
    setChecked(null)
    setTrusted(false)
    setChecked(await checkDesktopServer(address))
  })
  const connect = () => run(() => switchDesktopServer(checked?.apiOrigin ?? null, trusted))
  const backToOfficial = () => run(() => switchDesktopServer(null, false))

  // The field may sit inside the sign-in form: Enter checks the server, not the password form.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void check()
  }

  if (!open) {
    return (
      <button type="button" className="auth-sign-in-code-toggle" onClick={() => setOpen(true)}>
        {active ? `Server: ${serverLabel(active)}` : 'Advanced: custom server'}
      </button>
    )
  }

  return (
    <div className={variant === 'login' ? 'auth-sign-in-code custom-server-panel' : 'custom-server-panel'}>
      <p className="custom-server-current">
        Connected to <strong>{serverLabel(active)}</strong>
        {active?.insecure && ' (not encrypted)'}
      </p>
      {active && (
        <button type="button" className="auth-sign-in-code-toggle" onClick={() => void backToOfficial()} disabled={busy}>
          Use voxpery.com instead (restarts Voxpery)
        </button>
      )}
      <label htmlFor={`custom-server-address-${variant}`}>Self-hosted server address</label>
      <div className="auth-sign-in-code-row">
        <input
          id={`custom-server-address-${variant}`}
          type="url"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value)
            setChecked(null)
            setTrusted(false)
          }}
          onKeyDown={onKeyDown}
          placeholder="https://chat.example.org"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="auth-btn" onClick={() => void check()} disabled={busy || !address.trim()}>
          {busy && !checked ? 'Checking...' : 'Check'}
        </button>
      </div>
      {checked && (
        <div className="custom-server-confirm">
          <p>
            Found a Voxpery server at <strong>{checked.apiOrigin}</strong>. Your account, messages, files and voice
            go to this server and its owner, not to voxpery.com. Only connect to servers you trust.
          </p>
          {checked.insecure && (
            <p className="custom-server-warning" role="alert">
              This address is not encrypted (http). Anyone on the same network can read the traffic. Use it only
              for a server on this computer or your own network.
            </p>
          )}
          <label className="custom-server-trust">
            <input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />
            I trust this server
          </label>
          <button type="button" className="auth-btn" onClick={() => void connect()} disabled={busy || !trusted}>
            {busy ? 'Connecting...' : 'Connect and restart'}
          </button>
        </div>
      )}
      {error && <div className="auth-error" role="alert">{error}</div>}
    </div>
  )
}
