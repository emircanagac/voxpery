import { useState, type FormEvent, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../api'
import { ROUTES } from '../routes'

export default function ResetPasswordPage() {
    const [searchParams] = useSearchParams()
    const token = searchParams.get('token')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const navigate = useNavigate()

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
            const detail = err instanceof Error ? err.message : String(err)
            setError(detail || 'Failed to reset password')
        } finally {
            setLoading(false)
        }
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
                    <div style={{ padding: '0.75rem', backgroundColor: 'rgba(166, 227, 161, 0.1)', color: '#a6e3a1', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9em' }}>
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
                    <a onClick={() => navigate(ROUTES.login)} style={{ cursor: 'pointer', color: '#89b4fa' }}>
                        Back to Login
                    </a>
                </div>
            </form>
        </div>
    )
}
