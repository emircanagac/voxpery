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
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const effectiveRoles = serverRoles.length > 0 ? serverRoles : fallbackRoles

    useEffect(() => {
        let active = true
        setLoading(true)
        setError(null)
        Promise.all([
            channelApi.getCategoryOverrides(serverId, category, token),
            serverRoles.length > 0 ? Promise.resolve(serverRoles) : serverApi.listRoles(serverId, token),
        ])
            .then(([ovs, roles]) => {
                if (!active) return
                setOverrides(ovs)
                if (serverRoles.length === 0) setFallbackRoles(roles)
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

    useEffect(() => {
        if (selectedRoleId && !effectiveRoles.some((r) => r.id === selectedRoleId)) {
            setSelectedRoleId(null)
        }
    }, [selectedRoleId, effectiveRoles])

    const currentOverride = useMemo(() => {
        if (!selectedRoleId) return null
        return overrides.find((o) => o.role_id === selectedRoleId) ?? { role_id: selectedRoleId, allow: 0, deny: 0 }
    }, [selectedRoleId, overrides])

    const updateOverrideBit = async (bit: number, type: 'allow' | 'deny' | 'inherit') => {
        if (!selectedRoleId || !currentOverride) return
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
        try {
            const updated = await channelApi.updateCategoryOverride(serverId, category, selectedRoleId, newAllow, newDeny, token)
            setOverrides((prev) => {
                const filtered = prev.filter((o) => o.role_id !== selectedRoleId)
                return [...filtered, updated]
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update permission override.')
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
                                                    className={`server-role-list-item ${selectedRoleId === role.id ? 'server-role-list-item--active' : ''}`}
                                                    onClick={() => setSelectedRoleId(role.id)}
                                                >
                                                    <span className="channel-settings-role-dot" style={{ backgroundColor: role.color || 'var(--text-normal)' }} />
                                                    {role.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="channel-settings-perm-col">
                                        {!selectedRoleId ? (
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
