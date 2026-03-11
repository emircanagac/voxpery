import { useState, type FormEvent, type MouseEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi, getAuthErrorMessage, getGoogleAuthUrl } from '../api'
import { useAuthStore } from '../stores/auth'
import { isTauri, setSecureToken } from '../secureStorage'
import { openExternalUrl } from '../openExternalUrl'
import { ROUTES } from '../routes'

function GoogleLogoIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.2 7.2 0 0 0 2.63-6.05z" />
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.4 4.4 0 0 1-2.7.94 4.5 4.5 0 0 1-4.27-3.1H1.83v2.07A7.5 7.5 0 0 0 8.98 17z" />
            <path fill="#FBBC05" d="M4.31 10.9a4.4 4.4 0 0 1 0-2.8V6.03H1.83a7.5 7.5 0 0 0 0 6.74l2.48-1.87z" />
            <path fill="#EA4335" d="M8.98 4.18c1.2 0 2.27.41 3.1 1.2l2.3-2.3A7.5 7.5 0 0 0 1.83 6.03l2.48 1.87a4.5 4.5 0 0 1 4.67-3.72z" />
        </svg>
    )
}

function safeRedirectPath(redirect: string | null): string | undefined {
    if (!redirect || typeof redirect !== 'string') return undefined
    const path = redirect.trim()
    if (path.startsWith('/') && !path.startsWith('//')) return path
    return undefined
}

export default function RegisterPage() {
    const [searchParams] = useSearchParams()
    const redirectTo = safeRedirectPath(searchParams.get('redirect'))
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const setAuth = useAuthStore((s) => s.setAuth)
    const navigate = useNavigate()

    const handleGoogleLogin = async (e: MouseEvent<HTMLAnchorElement>) => {
        if (isTauri()) {
            e.preventDefault()
            const url = getGoogleAuthUrl(redirectTo)
            await openExternalUrl(url)
        }
    }

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
        if (password !== confirmPassword) {
            setError('Passwords do not match')
            return
        }

        setLoading(true)
        try {
            const res = await authApi.register(username, email, password)
            setAuth(res.token, res.user)
            // Desktop: also save to secure storage
            if (isTauri()) await setSecureToken(res.token)
            navigate(redirectTo || ROUTES.home)
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
                <img src="/1024.png" alt="Voxpery" className="auth-logo" width={80} height={80} />
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
                        onChange={(e) => setUsername(e.target.value.toLowerCase())}
                        placeholder="cooluser"
                        required
                        minLength={3}
                        maxLength={32}
                    />
                    {username.length > 0 && username.length < 3 && (
                        <div className="form-hint" style={{ color: '#f38ba8', fontSize: '12px', marginTop: '4px' }}>At least 3 characters</div>
                    )}
                    {username.length >= 3 && !/^[a-z0-9_.]+$/.test(username) && (
                        <div className="form-hint" style={{ color: '#f38ba8', fontSize: '12px', marginTop: '4px' }}>Only letters, numbers, underscores, and periods</div>
                    )}
                    {username.length >= 3 && /^[a-z0-9_.]+$/.test(username) && (username.startsWith('_') || username.startsWith('.') || username.endsWith('_') || username.endsWith('.')) && (
                        <div className="form-hint" style={{ color: '#f38ba8', fontSize: '12px', marginTop: '4px' }}>Cannot start or end with '_' or '.'</div>
                    )}
                    {username.length >= 3 && /^[a-z0-9_.]+$/.test(username) && (username.includes('..') || username.includes('__') || username.includes('._') || username.includes('_.')) && (
                        <div className="form-hint" style={{ color: '#f38ba8', fontSize: '12px', marginTop: '4px' }}>Cannot contain consecutive '_' or '.'</div>
                    )}
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

                <div className="form-group">
                    <label>Confirm password</label>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={8}
                    />
                </div>

                <button className="auth-btn" type="submit" disabled={loading}>
                    {loading ? 'Creating account...' : 'Sign Up'}
                </button>

                <div className="auth-divider">
                    <span>or</span>
                </div>

                <a
                    href={getGoogleAuthUrl(redirectTo)}
                    className="auth-btn-google"
                    onClick={handleGoogleLogin}
                >
                    <GoogleLogoIcon />
                    <span>Continue with Google</span>
                </a>

                <div className="auth-footer">
                    Already have an account?{' '}
                    <a
                        onClick={() =>
                            navigate(
                                redirectTo ? `${ROUTES.login}?redirect=${encodeURIComponent(redirectTo)}` : ROUTES.login,
                            )
                        }
                    >
                        Sign In
                    </a>
                </div>
            </form>
        </div>
    )
}
