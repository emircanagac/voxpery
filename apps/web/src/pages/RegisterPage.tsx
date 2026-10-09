import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { TurnstileInstance } from '@marsidev/react-turnstile'
import { authApi, getAuthErrorMessage, getDesktopGoogleAuthUrl, getDesktopRegistrationUrl, getGoogleAuthUrl, type LegalConsentStatus } from '../api'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { useFeatureStore } from '../stores/features'
import { isTauri } from '../secureStorage'
import { openExternalUrl } from '../openExternalUrl'
import { ROUTES } from '../routes'
import { setPersistedSocialView } from '../socialView'
import { resolvePostAuthRoute } from '../authRedirect'
import AuthIntegrationStatus from '../components/AuthIntegrationStatus'
import { currentLegalAcceptance } from '../legal'
import LegalAcknowledgements from '../components/LegalAcknowledgements'
import RegistrationCaptcha from '../components/RegistrationCaptcha'

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
    const [captchaToken, setCaptchaToken] = useState<string>('')
    const captchaRef = useRef<TurnstileInstance | undefined>(undefined)
    const [termsAccepted, setTermsAccepted] = useState(false)
    const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [documents, setDocuments] = useState<LegalConsentStatus | null>(null)
    const [documentError, setDocumentError] = useState('')
    const [documentAttempt, setDocumentAttempt] = useState(0)
    const [openingGoogle, setOpeningGoogle] = useState(false)
    useEffect(() => {
        let cancelled = false
        authApi.getLegalDocuments().then((status) => {
            if (!cancelled) { setDocuments(status); setDocumentError('') }
        }).catch(() => {
            if (!cancelled) setDocumentError('Legal documents could not be loaded. Please try again.')
        })
        return () => { cancelled = true }
    }, [documentAttempt])
    const setAuth = useAuthStore((s) => s.setAuth)
    const setActiveDmChannelId = useAppStore((s) => s.setActiveDmChannelId)
    const features = useFeatureStore((s) => s.features)
    const navigate = useNavigate()
    const googleOAuthEnabled = features?.google_oauth_enabled === true
    const legalReady = !!documents && termsAccepted && privacyAcknowledged

    const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
    const browserRegistrationRequired = isTauri() && !!turnstileSiteKey

    const handleGoogleLogin = async () => {
        if (!googleOAuthEnabled || !legalReady || !documents || loading || openingGoogle) return
        setOpeningGoogle(true)
        setError('')
        try {
            if (isTauri()) {
                const url = await getDesktopGoogleAuthUrl(redirectTo, {
                    intent: 'register',
                    legal: currentLegalAcceptance(documents),
                })
                await openExternalUrl(url)
            } else {
                window.location.assign(getGoogleAuthUrl(redirectTo, { intent: 'register', legal: currentLegalAcceptance(documents) }))
            }
        } catch {
            setError('Could not open Google sign-in in your browser. Try again or use email/password.')
        } finally {
            setOpeningGoogle(false)
        }
    }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setError('')

        if (!legalReady || !documents || loading || openingGoogle) {
            setError('Accept the Terms of Service and acknowledge the Privacy Notice before continuing.')
            return
        }
        if (browserRegistrationRequired) {
            setLoading(true)
            try {
                const url = await getDesktopRegistrationUrl(redirectTo)
                await openExternalUrl(url)
            } catch {
                setError('Could not open registration in your browser. Try again.')
            } finally {
                setLoading(false)
            }
            return
        }

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
        if (!browserRegistrationRequired && turnstileSiteKey && !captchaToken) {
            setError('Please complete the CAPTCHA verification')
            return
        }
        setLoading(true)
        try {
            const res = await authApi.register(
                username,
                email,
                password,
                currentLegalAcceptance(documents),
                captchaToken || undefined,
            )
            await setAuth(res.token, res.user)
            setActiveDmChannelId(null)
            setPersistedSocialView('friends')
            // Desktop: also save to secure storage
            navigate(resolvePostAuthRoute(redirectTo))
        } catch (err: unknown) {
            setCaptchaToken('')
            captchaRef.current?.reset()
            const { message, code } = getAuthErrorMessage(err)
            setError(code ? `${message} (Error code: ${code})` : message || 'Registration failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-page">
            <form className="auth-card auth-card-register" onSubmit={handleSubmit}>
                <Link
                    to={ROUTES.landing}
                    className="auth-landing-link"
                    aria-label="Back to Voxpery"
                    title="Back to Voxpery"
                >
                    <img src="/fox-animated.svg" alt="" className="auth-logo" width={80} height={80} />
                </Link>
                <h1>Voxpery</h1>
                <p>Create an account and jump into the community</p>

                {error && (
                    <div className="auth-error" role="alert">
                        {error}
                    </div>
                )}

                {!browserRegistrationRequired && <div className="auth-register-fields">
                <div className="form-group">
                    <label htmlFor="register-username">Username</label>
                    <input
                        id="register-username"
                        name="username"
                        autoComplete="username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="your_username"
                        required
                        minLength={3}
                        maxLength={32}
                    />
                    {username.length > 0 && username.length < 3 && (
                        <div className="form-hint" style={{ color: '#f38ba8', fontSize: '12px', marginTop: '4px' }}>At least 3 characters</div>
                    )}
                    {username.length >= 3 && !/^[a-z0-9_.]+$/i.test(username) && (
                        <div className="form-hint" style={{ color: '#f38ba8', fontSize: '12px', marginTop: '4px' }}>Only letters, numbers, underscores, and periods</div>
                    )}
                    {username.length >= 3 && /^[a-z0-9_.]+$/i.test(username) && (username.startsWith('_') || username.startsWith('.') || username.endsWith('_') || username.endsWith('.')) && (
                        <div className="form-hint" style={{ color: '#f38ba8', fontSize: '12px', marginTop: '4px' }}>Cannot start or end with '_' or '.'</div>
                    )}
                    {username.length >= 3 && /^[a-z0-9_.]+$/i.test(username) && (username.includes('..') || username.includes('__') || username.includes('._') || username.includes('_.')) && (
                        <div className="form-hint" style={{ color: '#f38ba8', fontSize: '12px', marginTop: '4px' }}>Cannot contain consecutive '_' or '.'</div>
                    )}
                </div>

                <div className="form-group">
                    <label htmlFor="register-email">Email</label>
                    <input
                        id="register-email"
                        name="email"
                        autoComplete="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="register-password">Password</label>
                    <input
                        id="register-password"
                        name="password"
                        autoComplete="new-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={8}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="register-confirm-password">Confirm password</label>
                    <input
                        id="register-confirm-password"
                        name="confirmPassword"
                        autoComplete="new-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={8}
                    />
                </div>

                </div>}
                {turnstileSiteKey && !isTauri() && (
                    <RegistrationCaptcha widgetRef={captchaRef} siteKey={turnstileSiteKey} onToken={setCaptchaToken} />
                )}

                {documentError && <div className="auth-error" role="alert">{documentError}
                    <button type="button" className="btn btn-secondary" onClick={() => setDocumentAttempt((attempt) => attempt + 1)}>Try again</button>
                </div>}
                <LegalAcknowledgements terms={termsAccepted} privacy={privacyAcknowledged} onTerms={setTermsAccepted} onPrivacy={setPrivacyAcknowledged} disabled={!documents || loading || openingGoogle} />

                <button className="auth-btn" type="submit" disabled={loading || openingGoogle || !legalReady || (!browserRegistrationRequired && !!turnstileSiteKey && !captchaToken)}>
                    {loading ? (browserRegistrationRequired ? 'Opening browser...' : 'Creating account...') : (browserRegistrationRequired ? 'Continue in browser' : 'Sign Up')}
                </button>

                <AuthIntegrationStatus />

                {googleOAuthEnabled && (
                    <>
                        <div className="auth-divider">
                            <span>or</span>
                        </div>

                        <button
                            type="button"
                            className="auth-btn-google"
                            disabled={!legalReady || loading || openingGoogle}
                            onClick={() => void handleGoogleLogin()}
                        >
                            <GoogleLogoIcon />
                            <span>Continue with Google</span>
                        </button>
                    </>
                )}

                <div className="auth-footer">
                    Already have an account?{' '}
                    <Link
                        to={redirectTo ? `${ROUTES.login}?redirect=${encodeURIComponent(redirectTo)}` : ROUTES.login}
                    >
                        Sign In
                    </Link>
                </div>
            </form>
        </div>
    )
}
