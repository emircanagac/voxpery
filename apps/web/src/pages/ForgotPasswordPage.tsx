import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api'
import { ROUTES } from '../routes'

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('')
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const navigate = useNavigate()

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setError('')
        setMessage('')
        setLoading(true)

        try {
            const res = await authApi.forgotPassword(email)
            setMessage(res.message)
        } catch (err: unknown) {
            const detail = err instanceof Error ? err.message : String(err)
            setError(detail || 'Failed to request password reset')
        } finally {
            setLoading(false)
        }
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
                    <div style={{ padding: '0.75rem', backgroundColor: 'rgba(166, 227, 161, 0.1)', color: '#a6e3a1', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9em' }}>
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
                    <a onClick={() => navigate(ROUTES.login)} style={{ cursor: 'pointer', color: '#89b4fa' }}>
                        Back to Login
                    </a>
                </div>
            </form>
        </div>
    )
}
