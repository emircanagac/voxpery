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
            <path
                fill="#4285F4"
                d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.2 7.2 0 0 0 2.63-6.05z"
            />
            <path
                fill="#34A853"
                d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.4 4.4 0 0 1-2.7.94 4.5 4.5 0 0 1-4.27-3.1H1.83v2.07A7.5 7.5 0 0 0 8.98 17z"
            />
            <path
                fill="#FBBC05"
                d="M4.31 10.9a4.4 4.4 0 0 1 0-2.8V6.03H1.83a7.5 7.5 0 0 0 0 6.74l2.48-1.87z"
            />
            <path
                fill="#EA4335"
                d="M8.98 4.18c1.2 0 2.27.41 3.1 1.2l2.3-2.3A7.5 7.5 0 0 0 1.83 6.03l2.48 1.87a4.5 4.5 0 0 1 4.67-3.72z"
            />
        </svg>
    )
}

function safeRedirectPath(redirect: string | null): string | undefined {
    if (!redirect || typeof redirect !== 'string') return undefined
    const path = redirect.trim()
    if (path.startsWith('/') && !path.startsWith('//')) return path
    return undefined
}

export default function LoginPage() {
    const [searchParams] = useSearchParams()
    const redirectTo = safeRedirectPath(searchParams.get('redirect'))
    const oauthError = searchParams.get('error') === 'oauth_failed'
    const [identifier, setIdentifier] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState(oauthError ? 'Sign in with Google failed. Try again or use email/password.' : '')
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
        setLoading(true)

        try {
            const res = await authApi.login(identifier, password)
            setAuth(res.token, res.user)
            // Desktop: also save to secure storage
            if (isTauri()) await setSecureToken(res.token)
            navigate(redirectTo || ROUTES.home)
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
                        placeholder="you@example.com or your_username"
                        required
                    />
                </div>

                <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label>Password</label>
                        <a 
                            onClick={() => navigate(ROUTES.forgotPassword)} 
                            style={{ fontSize: '0.8em', cursor: 'pointer', color: '#89b4fa' }}
                        >
                            Forgot password?
                        </a>
                    </div>
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
                    Don't have an account?{' '}
                    <a
                        onClick={() =>
                            navigate(
                                redirectTo
                                    ? `${ROUTES.register}?redirect=${encodeURIComponent(redirectTo)}`
                                    : ROUTES.register,
                            )
                        }
                    >
                        Sign Up
                    </a>
                </div>
            </form>
        </div>
    )
}
