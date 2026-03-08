import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { serverApi } from '../api'

export default function InvitePage() {
    const { code } = useParams<{ code: string }>()
    const navigate = useNavigate()
    const user = useAuthStore((s) => s.user)
    const token = useAuthStore((s) => s.token)
    const { setServers, setActiveServer } = useAppStore(useShallow((s) => ({ setServers: s.setServers, setActiveServer: s.setActiveServer })))
    const [error, setError] = useState<string | null>(null)
    const [joining, setJoining] = useState(false)

    useEffect(() => {
        if (!user || !code?.trim()) return
        
        const t = setTimeout(() => {
            setJoining(true)
            setError(null)
        }, 0)

        // Web: token is null, auth via cookie. Desktop: Bearer token.
        serverApi
            .join(code.trim(), token)
            .then(async (server) => {
                const list = await serverApi.list(token)
                setServers(list)
                setActiveServer(server.id)
                navigate('/app/servers', { replace: true })
            })
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Could not join server.')
                setJoining(false)
            })

        return () => clearTimeout(t)
    }, [user, token, code, setServers, setActiveServer, navigate])

    if (!user) {
        const invitePath = `/invite/${code ?? ''}`
        const loginUrl = `/login?redirect=${encodeURIComponent(invitePath)}`
        const registerUrl = `/register?redirect=${encodeURIComponent(invitePath)}`
        return (
            <div className="auth-page">
                <div className="auth-card" style={{ textAlign: 'center' }}>
                    <img src="/1024.png" alt="Voxpery" className="auth-logo" width={80} height={80} />
                    <h1>Join server</h1>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
                        Log in or create an account to join this server.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <a href={loginUrl} className="auth-btn" style={{ textDecoration: 'none', textAlign: 'center' }}>
                            Log in
                        </a>
                        <a href={registerUrl} className="btn btn-secondary" style={{ textDecoration: 'none', textAlign: 'center' }}>
                            Sign up
                        </a>
                    </div>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="auth-page">
                <div className="auth-card" style={{ textAlign: 'center' }}>
                    <h1>Could not join</h1>
                    <p className="auth-error" role="alert" style={{ marginBottom: 16 }}>
                        {error}
                    </p>
                    <button type="button" className="btn btn-secondary" onClick={() => navigate('/app/servers', { replace: true })}>
                        Back to app
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="auth-page">
            <div className="auth-card" style={{ textAlign: 'center' }}>
                <p style={{ color: 'var(--text-secondary)' }}>{joining ? 'Joining server…' : 'Redirecting…'}</p>
            </div>
        </div>
    )
}
