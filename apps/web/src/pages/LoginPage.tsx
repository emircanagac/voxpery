import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi, getAuthErrorMessage } from '../api'
import { useAuthStore } from '../stores/auth'
import { isTauri, setSecureToken } from '../secureStorage'

function safeRedirectPath(redirect: string | null): string {
    if (!redirect || typeof redirect !== 'string') return '/app/friends'
    const path = redirect.trim()
    if (path.startsWith('/') && !path.startsWith('//')) return path
    return '/app/friends'
}

export default function LoginPage() {
    const [searchParams] = useSearchParams()
    const redirectTo = safeRedirectPath(searchParams.get('redirect'))
    const [identifier, setIdentifier] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const setAuth = useAuthStore((s) => s.setAuth)
    const navigate = useNavigate()

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const res = await authApi.login(identifier, password)
            setAuth(res.token, res.user)
            // Desktop: also save to secure storage
            if (isTauri()) await setSecureToken(res.token)
            navigate(redirectTo)
        } catch (err: unknown) {
            const { message, code } = getAuthErrorMessage(err)
            setError(code ? `${message} (Error code: ${code})` : message || 'Login failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-page">
            <form className="auth-card" onSubmit={handleSubmit}>
                <img src="/1024.png" alt="Voxpery" className="auth-logo" width={80} height={80} />
                <h1>Voxpery</h1>
                <p>Sign in to your account</p>

                {error && (
                    <div className="auth-error" role="alert">
                        {error}
                    </div>
                )}

                <div className="form-group">
                    <label>Email or Username</label>
                    <input
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="you@example.com or admin"
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                    />
                </div>

                <button className="auth-btn" type="submit" disabled={loading}>
                    {loading ? 'Signing in...' : 'Sign In'}
                </button>

                <div className="auth-footer">
                    Don't have an account?{' '}
                    <a onClick={() => navigate(redirectTo ? `/register?redirect=${encodeURIComponent(redirectTo)}` : '/register')}>Sign Up</a>
                </div>
            </form>
        </div>
    )
}
