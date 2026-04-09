import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { serverApi } from '../api'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import type { ServerInvitePreview } from '../types'

function getServerInitial(name: string) {
    return name.charAt(0).toUpperCase()
}

function memberCountLabel(count: number) {
    return `${count} ${count === 1 ? 'member' : 'members'}`
}

export default function InvitePage() {
    const { code } = useParams<{ code: string }>()
    const navigate = useNavigate()
    const user = useAuthStore((s) => s.user)
    const token = useAuthStore((s) => s.token)
    const { setServers, setActiveServer } = useAppStore(
        useShallow((s) => ({
            setServers: s.setServers,
            setActiveServer: s.setActiveServer,
        })),
    )
    const trimmedCode = code?.trim() ?? ''
    const [preview, setPreview] = useState<ServerInvitePreview | null>(null)
    const [previewLoading, setPreviewLoading] = useState(true)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [joining, setJoining] = useState(false)
    const [joinError, setJoinError] = useState<string | null>(null)

    useEffect(() => {
        if (!user) return
        if (!trimmedCode) {
            setPreview(null)
            setPreviewError('Invalid invite code.')
            setPreviewLoading(false)
            return
        }
        setPreviewLoading(true)
        setPreviewError(null)
        serverApi
            .getInvitePreview(trimmedCode)
            .then((data) => {
                setPreview(data)
            })
            .catch((err: unknown) => {
                setPreview(null)
                setPreviewError(err instanceof Error ? err.message : 'Could not load invite preview.')
            })
            .finally(() => setPreviewLoading(false))
    }, [trimmedCode, user])

    const invitePath = useMemo(() => ROUTES.invite(trimmedCode || ''), [trimmedCode])
    const loginUrl = `${ROUTES.login}?redirect=${encodeURIComponent(invitePath)}`

    const joinServer = async () => {
        if (!user || !trimmedCode) return
        setJoinError(null)
        setJoining(true)
        try {
            const server = await serverApi.join(trimmedCode, token)
            const list = await serverApi.list(token)
            setServers(list)
            setActiveServer(server.id)
            navigate(ROUTES.servers, { replace: true })
        } catch (err: unknown) {
            setJoinError(err instanceof Error ? err.message : 'Could not join server.')
        } finally {
            setJoining(false)
        }
    }

    if (!user) {
        return <Navigate to={loginUrl} replace />
    }

    return (
        <div className="auth-page">
            <div className="auth-card invite-preview-card">
                <img src="/1024.png" alt="Voxpery" className="auth-logo" width={80} height={80} />
                <h1>{previewLoading ? 'Checking invite…' : 'Join server'}</h1>
                <p>
                    {previewLoading
                        ? 'Loading server details.'
                        : 'Preview the server before you join.'}
                </p>

                {previewError ? (
                    <div className="auth-error" role="alert">
                        {previewError}
                    </div>
                ) : preview ? (
                    <div className="invite-preview-panel">
                        <div className="invite-preview-server">
                            <div className="invite-preview-icon">
                                {preview.icon_url ? (
                                    <img src={preview.icon_url} alt={preview.name} className="invite-preview-icon-image" />
                                ) : (
                                    getServerInitial(preview.name)
                                )}
                            </div>
                            <div className="invite-preview-copy">
                                <div className="invite-preview-title">{preview.name}</div>
                                <div className="invite-preview-meta">
                                    <span className="invite-preview-pill">{memberCountLabel(preview.member_count)}</span>
                                </div>
                            </div>
                        </div>

                        {joinError && (
                            <div className="auth-error invite-preview-error" role="alert">
                                {joinError}
                            </div>
                        )}

                        <div className="invite-preview-actions">
                            <button type="button" className="auth-btn" onClick={() => void joinServer()} disabled={joining}>
                                {joining ? 'Joining…' : 'Join server'}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => navigate(ROUTES.home, { replace: true })}
                            >
                                Not now
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    )
}
