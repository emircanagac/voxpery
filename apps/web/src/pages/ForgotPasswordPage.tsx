import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { authApi, getAuthErrorMessage } from '../api'
import { ROUTES } from '../routes'
import { useFeatureStore } from '../stores/features'
import AuthIntegrationStatus from '../components/AuthIntegrationStatus'

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('')
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const navigate = useNavigate()
    const features = useFeatureStore((s) => s.features)
    const passwordResetEnabled = features?.password_reset_enabled === true

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setError('')
        setMessage('')
        setLoading(true)

        try {
            const res = await authApi.forgotPassword(email)
            setMessage(res.message)
        } catch (err: unknown) {
            const { message, code } = getAuthErrorMessage(err)
            setError(code ? `${message} (Error code: ${code})` : message || 'Failed to request password reset')
        } finally {
            setLoading(false)
        }
    }

    if (!features) {
        return (
            <div className="auth-page">
                <div className="auth-card">
                    <img src="/1024.png" alt="Voxpery" className="auth-logo" width={80} height={80} />
                    <h1>Reset Password</h1>
                    <AuthIntegrationStatus
                        loadingMessage="Checking password recovery availability..."
                        errorMessage="Password recovery availability could not be loaded."
                    />

                    <div className="auth-footer" style={{ marginTop: '1.5rem' }}>
                        <a onClick={() => navigate(ROUTES.login)} style={{ cursor: 'pointer', color: 'var(--text-link)' }}>
                            Back to Login
                        </a>
                    </div>
                </div>
            </div>
        )
    }

    if (!passwordResetEnabled) {
        return (
            <div className="auth-page">
                <div className="auth-card">
                    <img src="/1024.png" alt="Voxpery" className="auth-logo" width={80} height={80} />
                    <h1>Reset Password</h1>
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
                <h1>Reset Password</h1>
                <p>Enter your email to receive a reset link</p>

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
                    <label>Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="user@example.com"
                        required
                    />
                </div>

                <button className="auth-btn" type="submit" disabled={loading}>
                    {loading ? 'Sending...' : 'Send Reset Link'}
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
