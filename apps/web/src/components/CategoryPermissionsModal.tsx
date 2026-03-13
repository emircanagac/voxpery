import { useEffect, useMemo, useState } from 'react'
import { Shield, X } from 'lucide-react'
import { channelApi, serverApi, type ChannelOverride, type ServerRole } from '../api'
import { useAuthStore } from '../stores/auth'

interface CategoryPermissionsModalProps {
    serverId: string
    category: string
    serverRoles: ServerRole[]
    onClose: () => void
}

const PERM_OPTIONS = [
    { label: 'View Channel', bit: 1 << 0 },
    { label: 'Manage Channel', bit: 1 << 3 },
    { label: 'Send Messages', bit: 1 << 7 },
    { label: 'Manage Messages', bit: 1 << 8 },
    { label: 'Connect to Voice', bit: 1 << 10 },
    { label: 'Mute Members', bit: 1 << 11 },
    { label: 'Deafen Members', bit: 1 << 12 },
]

export default function CategoryPermissionsModal({
    serverId,
    category,
    serverRoles,
    onClose,
}: CategoryPermissionsModalProps) {
    const { token } = useAuthStore()
    const [fallbackRoles, setFallbackRoles] = useState<ServerRole[]>([])
    const [overrides, setOverrides] = useState<ChannelOverride[]>([])
    const [draftOverrides, setDraftOverrides] = useState<Record<string, { allow: number; deny: number }>>({})
    const [changedRoleIds, setChangedRoleIds] = useState<Set<string>>(new Set())
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const effectiveRoles = fallbackRoles.length > 0 ? fallbackRoles : serverRoles
    const activeSelectedRoleId =
        selectedRoleId && effectiveRoles.some((r) => r.id === selectedRoleId) ? selectedRoleId : null
    const isDirty = changedRoleIds.size > 0

    useEffect(() => {
        let active = true
        queueMicrotask(() => {
            if (!active) return
            setLoading(true)
            setError(null)
        })
        Promise.all([
            channelApi.getCategoryOverrides(serverId, category, token),
            serverApi.listRoles(serverId, token, { includeSystem: true }),
        ])
            .then(([ovs, roles]) => {
                if (!active) return
                setOverrides(ovs)
                setFallbackRoles(roles)
                setDraftOverrides(
                    Object.fromEntries(ovs.map((o) => [o.role_id, { allow: o.allow, deny: o.deny }])),
                )
                setChangedRoleIds(new Set())
            })
            .catch((err) => {
                if (!active) return
                setError(err instanceof Error ? err.message : 'Failed to load category permissions.')
            })
            .finally(() => {
                if (!active) return
                setLoading(false)
            })
        return () => {
            active = false
        }
    }, [serverId, category, token, serverRoles])

    const currentOverride = useMemo(() => {
        if (!activeSelectedRoleId) return null
        const draft = draftOverrides[activeSelectedRoleId]
        if (draft) return { role_id: activeSelectedRoleId, allow: draft.allow, deny: draft.deny }
        return overrides.find((o) => o.role_id === activeSelectedRoleId) ?? { role_id: activeSelectedRoleId, allow: 0, deny: 0 }
    }, [activeSelectedRoleId, draftOverrides, overrides])

    const getBaselineOverride = (roleId: string) => {
        const existing = overrides.find((o) => o.role_id === roleId)
        return existing ? { allow: existing.allow, deny: existing.deny } : { allow: 0, deny: 0 }
    }

    const updateOverrideBit = (bit: number, type: 'allow' | 'deny' | 'inherit') => {
        if (!activeSelectedRoleId || !currentOverride) return
        let newAllow = currentOverride.allow
        let newDeny = currentOverride.deny
        if (type === 'allow') {
            newAllow |= bit
            newDeny &= ~bit
        } else if (type === 'deny') {
            newDeny |= bit
            newAllow &= ~bit
        } else {
            newAllow &= ~bit
            newDeny &= ~bit
        }
        setDraftOverrides((prev) => ({
            ...prev,
            [activeSelectedRoleId]: { allow: newAllow, deny: newDeny },
        }))
        setChangedRoleIds((prev) => {
            const baseline = getBaselineOverride(activeSelectedRoleId)
            const changed = baseline.allow !== newAllow || baseline.deny !== newDeny
            const next = new Set(prev)
            if (changed) next.add(activeSelectedRoleId)
            else next.delete(activeSelectedRoleId)
            return next
        })
    }

    const handleCancel = () => {
        setDraftOverrides(
            Object.fromEntries(overrides.map((o) => [o.role_id, { allow: o.allow, deny: o.deny }])),
        )
        setChangedRoleIds(new Set())
        setError(null)
    }

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [onClose])

    const handleSave = async () => {
        if (!isDirty || saving) return
        setSaving(true)
        setError(null)
        try {
            const updates = Array.from(changedRoleIds)
            for (const roleId of updates) {
                const draft = draftOverrides[roleId] ?? { allow: 0, deny: 0 }
                await channelApi.updateCategoryOverride(
                    serverId,
                    category,
                    roleId,
                    draft.allow,
                    draft.deny,
                    token,
                )
            }
            const refreshed = await channelApi.getCategoryOverrides(serverId, category, token)
            setOverrides(refreshed)
            setDraftOverrides(
                Object.fromEntries(refreshed.map((o) => [o.role_id, { allow: o.allow, deny: o.deny }])),
            )
            setChangedRoleIds(new Set())
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save category permissions.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-server-settings channel-settings-modal" onClick={(e) => e.stopPropagation()}>
                <div className="server-settings-layout">
                    <div className="server-settings-nav channel-settings-nav">
                        <div className="channel-settings-nav-title">{category}</div>
                        <div className="channel-settings-nav-subtitle">Category settings</div>
                        <button className="server-settings-nav__item server-settings-nav__item--active">
                            <Shield size={16} />
                            Permissions
                        </button>
                    </div>
                    <div className="server-settings-content">
                        <div className="server-settings-card channel-settings-card">
                            <div className="server-settings-header channel-settings-header">
                                <div className="server-settings-header__text">
                                    <h2>Category Permissions</h2>
                                    <p className="server-settings-header__hint">
                                        Applies to all channels under this category.
                                    </p>
                                </div>
                                <button className="server-settings-close-btn" onClick={onClose} aria-label="Close">
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="server-settings-body server-settings-body--with-tabs">
                                {error && <div className="modal-error server-settings-error">{error}</div>}
                                <div className="server-settings-section channel-settings-permissions">
                                    <div className="channel-settings-roles-col">
                                        <label className="channel-settings-label">Roles</label>
                                        <div className="channel-settings-roles-list">
                                            {effectiveRoles.map((role) => (
                                                <button
                                                    key={role.id}
                                                    type="button"
                                                    className={`server-role-list-item ${activeSelectedRoleId === role.id ? 'server-role-list-item--active' : ''}`}
                                                    onClick={() => setSelectedRoleId(role.id)}
                                                >
                                                    <span className="channel-settings-role-dot" style={{ backgroundColor: role.color || 'var(--text-normal)' }} />
                                                    {role.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="channel-settings-perm-col">
                                        {!activeSelectedRoleId ? (
                                            <div className="role-edit-empty channel-settings-empty">
                                                Select a role to configure category permissions
                                            </div>
                                        ) : loading ? (
                                            <div className="role-edit-empty channel-settings-empty">Loading...</div>
                                        ) : (
                                            <>
                                                <label className="channel-settings-label channel-settings-label--spaced">
                                                    Advanced Permissions
                                                </label>
                                                {PERM_OPTIONS.map((opt) => {
                                                    const isAllowed = (currentOverride!.allow & opt.bit) === opt.bit
                                                    const isDenied = (currentOverride!.deny & opt.bit) === opt.bit
                                                    return (
                                                        <div key={opt.bit} className="channel-perm-row">
                                                            <span>{opt.label}</span>
                                                            <div className="channel-perm-switches">
                                                                <button
                                                                    type="button"
                                                                    className={`channel-perm-btn ${isDenied ? 'is-denied' : ''}`}
                                                                    onClick={() => updateOverrideBit(opt.bit, 'deny')}
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className={`channel-perm-btn ${!isAllowed && !isDenied ? 'is-inherit' : ''}`}
                                                                    onClick={() => updateOverrideBit(opt.bit, 'inherit')}
                                                                >
                                                                    /
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className={`channel-perm-btn ${isAllowed ? 'is-allowed' : ''}`}
                                                                    onClick={() => updateOverrideBit(opt.bit, 'allow')}
                                                                >
                                                                    ✓
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                                <div className="channel-settings-actions">
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm server-role-btn-cancel"
                                                        onClick={handleCancel}
                                                        disabled={saving}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary btn-sm server-role-btn-save"
                                                        onClick={() => void handleSave()}
                                                        disabled={!isDirty || saving}
                                                    >
                                                        {saving ? 'Saving...' : 'Save'}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
