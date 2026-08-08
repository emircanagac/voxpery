import { useState, type FormEvent, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { authApi, getAuthErrorMessage } from '../api'
import { ROUTES } from '../routes'
import { useFeatureStore } from '../stores/features'

export default function ResetPasswordPage() {
    const [searchParams] = useSearchParams()
    const token = searchParams.get('token')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const navigate = useNavigate()
    const features = useFeatureStore((s) => s.features)
    const passwordResetEnabled = features?.password_reset_enabled === true

    useEffect(() => {
        if (!token) {
            setError('Invalid or missing password reset token. Please request a new link.')
        }
    }, [token])

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setError('')
        setMessage('')
        
        if (!token) {
            setError('Invalid token')
            return
        }
        
        if (password !== confirmPassword) {
            setError('Passwords do not match')
            return
        }
        
        if (password.length < 8) {
            setError('Password must be at least 8 characters')
            return
        }

        setLoading(true)

        try {
            const res = await authApi.resetPassword(token, password)
            setMessage(res.message)
            setTimeout(() => navigate(ROUTES.login), 3000)
        } catch (err: unknown) {
            const { message, code } = getAuthErrorMessage(err)
            setError(code ? `${message} (Error code: ${code})` : message || 'Failed to reset password')
        } finally {
            setLoading(false)
        }
    }

    if (!passwordResetEnabled) {
        return (
            <div className="auth-page">
                <div className="auth-card">
                    <img src="/1024.png" alt="Voxpery" className="auth-logo" width={80} height={80} />
                    <h1>Set New Password</h1>
                    <p>Password reset is not available because this server has not configured email delivery.</p>

                    <div className="auth-footer" style={{ marginTop: '1.5rem' }}>
                        <a onClick={() => navigate(ROUTES.login)} style={{ cursor: 'pointer', color: 'var(--text-link)' }}>
                            Back to Login
                        </a>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="auth-page">
            <form className="auth-card" onSubmit={handleSubmit}>
                <img src="/1024.png" alt="Voxpery" className="auth-logo" width={80} height={80} />
                <h1>Set New Password</h1>
                <p>Choose a new password for your account</p>

                {error && (
                    <div className="auth-error" role="alert">
                        {error}
                    </div>
                )}
                {message && (
                    <div style={{ padding: '0.75rem', backgroundColor: 'color-mix(in srgb, var(--text-positive) 10%, transparent)', color: 'var(--text-positive)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9em' }}>
                        {message}
                    </div>
                )}

                <div className="form-group">
                    <label>New Password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        disabled={!token || !!message}
                    />
                </div>

                <div className="form-group">
                    <label>Confirm Password</label>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        disabled={!token || !!message}
                    />
                </div>

                <button className="auth-btn" type="submit" disabled={loading || !token || !!message}>
                    {loading ? 'Resetting...' : 'Reset Password'}
                </button>

                <div className="auth-footer" style={{ marginTop: '1.5rem' }}>
                    <a onClick={() => navigate(ROUTES.login)} style={{ cursor: 'pointer', color: 'var(--text-link)' }}>
                        Back to Login
                    </a>
                </div>
            </form>
        </div>
    )
}
