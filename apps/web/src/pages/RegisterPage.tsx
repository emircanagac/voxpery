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

export default function RegisterPage() {
    const [searchParams] = useSearchParams()
    const redirectTo = safeRedirectPath(searchParams.get('redirect'))
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const setAuth = useAuthStore((s) => s.setAuth)
    const navigate = useNavigate()

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setError('')

        if (username.length < 3) {
            setError('Username must be at least 3 characters')
            return
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters')
            return
        }

        setLoading(true)
        try {
            const res = await authApi.register(username, email, password)
            setAuth(res.token, res.user)
            // Desktop: also save to secure storage
            if (isTauri()) await setSecureToken(res.token)
            navigate(redirectTo)
        } catch (err: unknown) {
            const { message, code } = getAuthErrorMessage(err)
            setError(code ? `${message} (Error code: ${code})` : message || 'Registration failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-page">
            <form className="auth-card" onSubmit={handleSubmit}>
                <h1>Voxpery</h1>
                <p>Create a new account</p>

                {error && (
                    <div className="auth-error" role="alert">
                        {error}
                    </div>
                )}

                <div className="form-group">
                    <label>Username</label>
                    <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="cooluser"
                        required
                        minLength={3}
                        maxLength={32}
                    />
                </div>

                <div className="form-group">
                    <label>Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
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
                        minLength={8}
                    />
                </div>

                <button className="auth-btn" type="submit" disabled={loading}>
                    {loading ? 'Creating account...' : 'Sign Up'}
                </button>

                <div className="auth-footer">
                    Already have an account?{' '}
                    <a onClick={() => navigate(redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login')}>Sign In</a>
                </div>
            </form>
        </div>
    )
}
