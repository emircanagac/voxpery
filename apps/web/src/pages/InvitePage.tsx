import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { resolveServerIconUrl, serverApi } from '../api'
import { listInviteRules } from '../api/inviteRules'
import type { ServerRule } from '../api/contracts'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import type { Server, ServerInvitePreview } from '../types'

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
    const [rules, setRules] = useState<ServerRule[]>([])
    const [rulesLoading, setRulesLoading] = useState(true)
    const [acceptedRules, setAcceptedRules] = useState(false)
    const [joining, setJoining] = useState(false)
    const [joinError, setJoinError] = useState<string | null>(null)
    const [memberServers, setMemberServers] = useState<Server[] | null>(null)

    useEffect(() => {
        if (!user) return
        if (!trimmedCode) {
            setPreview(null)
            setPreviewError('Invalid invite code.')
            setPreviewLoading(false)
            setRules([])
            setRulesLoading(false)
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

    useEffect(() => {
        if (!user || !preview) return
        setRulesLoading(true)
        listInviteRules(trimmedCode, token)
            .then((data) => {
                setRules(data)
                setAcceptedRules(data.length === 0)
            })
            .catch(() => {
                setRules([])
                setAcceptedRules(true)
            })
            .finally(() => setRulesLoading(false))
    }, [preview, user, token, trimmedCode])

    useEffect(() => {
        if (!user || !preview) return
        let cancelled = false
        serverApi
            .list(token)
            .then((list) => { if (!cancelled) setMemberServers(list) })
            .catch(() => { if (!cancelled) setMemberServers(null) })
        return () => { cancelled = true }
    }, [preview, user, token])

    const alreadyMember = !!preview && !!memberServers?.some((server) => server.id === preview.id)

    const invitePath = useMemo(() => ROUTES.invite(trimmedCode || ''), [trimmedCode])
    const loginUrl = `${ROUTES.login}?redirect=${encodeURIComponent(invitePath)}`

    const canJoin = rules.length === 0 || acceptedRules

    const joinServer = async () => {
        if (!user || !trimmedCode || !canJoin) return
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

    const openServer = (serverId: string) => {
        if (memberServers) setServers(memberServers)
        setActiveServer(serverId)
        navigate(ROUTES.servers, { replace: true })
    }

    if (!user) {
        return <Navigate to={loginUrl} replace />
    }

    const heading = previewLoading
        ? 'Checking invite…'
        : previewError
            ? 'Invite unavailable'
            : alreadyMember
                ? 'You’re already a member'
                : 'Join server'
    const subheading = previewLoading
        ? 'Loading server details.'
        : previewError
            ? 'This invite may have expired or been removed. Ask for a new link.'
            : alreadyMember
                ? 'You are already in this server.'
                : 'Preview the server before you join.'

    return (
        <main className="auth-page">
            <div className="auth-card invite-preview-card">
                <img src="/voxpery-logo.svg" alt="Voxpery" className="auth-logo" width={80} height={80} />
                <h1>{heading}</h1>
                <p>{subheading}</p>

                {previewError ? (
                    <>
                        <div className="auth-error" role="alert">
                            {previewError}
                        </div>
                        <div className="invite-preview-actions">
                            <button
                                type="button"
                                className="auth-btn"
                                onClick={() => navigate(ROUTES.home, { replace: true })}
                            >
                                Back to Voxpery
                            </button>
                        </div>
                    </>
                ) : preview ? (
                    <div className="invite-preview-panel">
                        <div className="invite-preview-server">
                            <div className="invite-preview-icon">
                                {preview.icon_url ? (
                                    <img src={resolveServerIconUrl(preview.icon_url, preview.icon_grant) ?? ''} alt={preview.name} className="invite-preview-icon-image" />
                                ) : (
                                    getServerInitial(preview.name)
                                )}
                            </div>
                            <div className="invite-preview-copy">
                                <div className="invite-preview-title">{preview.name}</div>
                                {preview.description && (
                                    <div className="invite-preview-description">{preview.description}</div>
                                )}
                                <div className="invite-preview-meta">
                                    <span className="invite-preview-pill">{memberCountLabel(preview.member_count)}</span>
                                </div>
                            </div>
                        </div>

                        {alreadyMember ? null : rulesLoading ? (
                            <div className="invite-rules-loading">Loading rules...</div>
                        ) : rules.length > 0 ? (
                            <div className="invite-rules-section">
                                <div className="invite-rules-header">
                                    <span className="invite-rules-eyebrow">Server Rules</span>
                                    <span className="invite-rules-count">{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span>
                                </div>
                                <ol className="invite-rules-list">
                                    {rules.map((rule, index) => (
                                        <li key={rule.id} className="invite-rule-item">
                                            <span className="invite-rule-number">{index + 1}</span>
                                            <span className="invite-rule-text">{rule.rule_text}</span>
                                        </li>
                                    ))}
                                </ol>
                                <label className="invite-rules-accept">
                                    <input
                                        type="checkbox"
                                        checked={acceptedRules}
                                        onChange={(e) => setAcceptedRules(e.target.checked)}
                                    />
                                    <span>I have read and agree to the server rules</span>
                                </label>
                            </div>
                        ) : null}

                        {joinError && (
                            <div className="auth-error invite-preview-error" role="alert">
                                {joinError}
                            </div>
                        )}

                        <div className="invite-preview-actions">
                            {alreadyMember ? (
                                <button type="button" className="auth-btn" onClick={() => openServer(preview.id)}>
                                    Open server
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="auth-btn"
                                    onClick={() => void joinServer()}
                                    disabled={joining || !canJoin}
                                >
                                    {joining ? 'Joining…' : 'Join server'}
                                </button>
                            )}
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
        </main>
    )
}
