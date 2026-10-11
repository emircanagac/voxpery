import { useState, type KeyboardEvent } from 'react'
import { submitDesktopSignInCode } from '../desktopOAuth'

/** Desktop fallback when the browser could not open the app after Google sign-in or registration. */
export default function DesktopSignInCode() {
    const [open, setOpen] = useState(false)
    const [code, setCode] = useState('')
    const [error, setError] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const submit = async () => {
        if (submitting || !code.trim()) return
        setError('')
        setSubmitting(true)
        try {
            const result = await submitDesktopSignInCode(code)
            if (result === 'invalid') {
                setError('This is not a valid sign-in code. Copy the code shown on the browser page.')
            } else if (result === 'unavailable') {
                setError('Sign-in codes are not available right now. Restart Voxpery and try again.')
            }
        } finally {
            setSubmitting(false)
        }
    }

    // The field sits inside the sign-in form: Enter submits the code, not the password form.
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        void submit()
    }

    if (!open) {
        return (
            <button type="button" className="auth-sign-in-code-toggle" onClick={() => setOpen(true)}>
                Use a sign-in code
            </button>
        )
    }

    return (
        <div className="auth-sign-in-code">
            <label htmlFor="desktop-sign-in-code">Sign-in code from the browser</label>
            <div className="auth-sign-in-code-row">
                <input
                    id="desktop-sign-in-code"
                    type="text"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Paste the code"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                />
                <button type="button" className="auth-btn" onClick={() => void submit()} disabled={submitting || !code.trim()}>
                    {submitting ? 'Signing in...' : 'Continue'}
                </button>
            </div>
            <p className="auth-sign-in-code-hint">
                If Voxpery did not open after you signed in or registered in the browser, copy the code from that page.
            </p>
            {error && <div className="auth-error" role="alert">{error}</div>}
        </div>
    )
}
