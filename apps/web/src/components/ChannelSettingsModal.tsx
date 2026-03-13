import { useEffect, useState, useMemo } from 'react'
import { X, Trash2, Shield, Settings, AlertTriangle } from 'lucide-react'
import type { Channel, ServerRole } from '../api'
import { channelApi, serverApi } from '../api'
import type { ChannelOverride } from '../api'
import { useAuthStore } from '../stores/auth'

interface ChannelSettingsModalProps {
    channel: Channel
    serverRoles: ServerRole[]
    onClose: () => void
    onUpdated?: (channel: Channel) => void
    onDeleted?: (channelId: string) => void
}

export default function ChannelSettingsModal({
    channel,
    serverRoles,
    onClose,
    onUpdated,
    onDeleted,
}: ChannelSettingsModalProps) {
    const { token } = useAuthStore()
    const [tab, setTab] = useState<'general' | 'permissions' | 'danger'>('general')

    // General state
    const [name, setName] = useState(channel.name)
    const [category, setCategory] = useState(channel.category ?? '')
    const [savingGeneral, setSavingGeneral] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Permissions state
    const [overrides, setOverrides] = useState<ChannelOverride[]>([])
    const [categoryOverrides, setCategoryOverrides] = useState<ChannelOverride[]>([])
    const [permissionScope, setPermissionScope] = useState<'channel' | 'category'>('channel')
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
    const [loadingPerms, setLoadingPerms] = useState(false)
    const [loadingCategoryPerms, setLoadingCategoryPerms] = useState(false)
    const [fallbackRoles, setFallbackRoles] = useState<ServerRole[]>([])
    const [loadingRoles, setLoadingRoles] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [deletingChannel, setDeletingChannel] = useState(false)
    const effectiveRoles = serverRoles.length > 0 ? serverRoles : fallbackRoles

    const openPermissionsTab = async () => {
        setTab('permissions')
        if (effectiveRoles.length === 0 && !loadingRoles && channel.server_id) {
            setLoadingRoles(true)
            try {
                const roles = await serverApi.listRoles(channel.server_id, token)
                setFallbackRoles(roles)
            } catch (e) {
                console.error(e)
            } finally {
                setLoadingRoles(false)
            }
        }
        if (overrides.length === 0 && !loadingPerms) {
            setLoadingPerms(true)
            try {
                const ov = await channelApi.getOverrides(channel.id, token)
                setOverrides(ov)
            } catch (e) {
                console.error(e)
            } finally {
                setLoadingPerms(false)
            }
        }
        if (channel.category?.trim() && channel.server_id && !loadingCategoryPerms && categoryOverrides.length === 0) {
            setLoadingCategoryPerms(true)
            try {
                const cov = await channelApi.getCategoryOverrides(channel.server_id, channel.category.trim(), token)
                setCategoryOverrides(cov)
            } catch (e) {
                console.error(e)
            } finally {
                setLoadingCategoryPerms(false)
            }
        }
    }

    const handleSaveGeneral = async () => {
        setSavingGeneral(true)
        setError(null)
        try {
            const updated = await channelApi.rename(
                channel.id,
                name,
                token,
                category.trim() || undefined,
            )
            onUpdated?.(updated)
            onClose()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
            setSavingGeneral(false)
        }
    }

    useEffect(() => {
        setName(channel.name)
        setCategory(channel.category ?? '')
        setPermissionScope('channel')
        setOverrides([])
        setCategoryOverrides([])
        setSelectedRoleId(null)
    }, [channel.id, channel.name, channel.category])

    const handleDelete = async () => {
        setDeletingChannel(true)
        setError(null)
        try {
            await channelApi.delete(channel.id, token)
            onDeleted?.(channel.id)
            onClose()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setDeletingChannel(false)
            setShowDeleteConfirm(false)
        }
    }

    useEffect(() => {
        if (selectedRoleId && !effectiveRoles.some((role) => role.id === selectedRoleId)) {
            setSelectedRoleId(null)
        }
    }, [effectiveRoles, selectedRoleId])

    const currentOverride = useMemo(() => {
        if (!selectedRoleId) return null
        const source = permissionScope === 'category' ? categoryOverrides : overrides
        return source.find(o => o.role_id === selectedRoleId) || { role_id: selectedRoleId, allow: 0, deny: 0 }
    }, [selectedRoleId, overrides, categoryOverrides, permissionScope])

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
            if (permissionScope === 'category' && channel.server_id && channel.category?.trim()) {
                const updated = await channelApi.updateCategoryOverride(
                    channel.server_id,
                    channel.category.trim(),
                    selectedRoleId,
                    newAllow,
                    newDeny,
                    token,
                )
                setCategoryOverrides(prev => {
                    const filtered = prev.filter(o => o.role_id !== selectedRoleId)
                    return [...filtered, updated]
                })
            } else {
                const updated = await channelApi.updateOverride(channel.id, selectedRoleId, newAllow, newDeny, token)
                setOverrides(prev => {
                    const filtered = prev.filter(o => o.role_id !== selectedRoleId)
                    return [...filtered, updated]
                })
            }
        } catch (e) {
            console.error(e)
        }
    }

    const permOptions = [
        { label: 'View Channel', bit: 1 << 0 }, // PERM_VIEW_SERVER conceptually reused for view channel
        { label: 'Manage Channel', bit: 1 << 3 }, // PERM_MANAGE_CHANNELS
        { label: 'Send Messages', bit: 1 << 7 }, // PERM_SEND_MESSAGES
        { label: 'Manage Messages', bit: 1 << 8 }, // PERM_MANAGE_MESSAGES
        { label: 'Connect to Voice', bit: 1 << 10 }, // PERM_CONNECT_VOICE
        { label: 'Mute Members', bit: 1 << 11 }, // PERM_MUTE_MEMBERS
        { label: 'Deafen Members', bit: 1 << 12 }, // PERM_DEAFEN_MEMBERS
    ]

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-server-settings channel-settings-modal" onClick={e => e.stopPropagation()}>
                <div className="server-settings-layout">
                    <div className="server-settings-nav channel-settings-nav">
                        <div className="channel-settings-nav-title">
                            {channel.name}
                        </div>
                        <div className="channel-settings-nav-subtitle">
                            Channel settings
                        </div>
                        <button
                            className={`server-settings-nav__item ${tab === 'general' ? 'server-settings-nav__item--active' : ''}`}
                            onClick={() => setTab('general')}
                        >
                            <Settings size={16} />
                            Overview
                        </button>
                        <button
                            className={`server-settings-nav__item ${tab === 'permissions' ? 'server-settings-nav__item--active' : ''}`}
                            onClick={() => { void openPermissionsTab() }}
                        >
                            <Shield size={16} />
                            Permissions
                        </button>
                        <button
                            className={`server-settings-nav__item ${tab === 'danger' ? 'server-settings-nav__item--active' : ''}`}
                            onClick={() => setTab('danger')}
                        >
                            <AlertTriangle size={16} />
                            Danger Zone
                        </button>
                    </div>

                    <div className="server-settings-content">
                        <div className="server-settings-card channel-settings-card">
                            <div className="server-settings-header channel-settings-header">
                                <div className="server-settings-header__text">
                                    <h2>{tab === 'general' ? 'Overview' : tab === 'permissions' ? 'Permissions' : 'Danger Zone'}</h2>
                                    <p className="server-settings-header__hint">
                                        Configure this channel without leaving server settings.
                                    </p>
                                </div>
                                <button className="server-settings-close-btn" onClick={onClose} aria-label="Close">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="server-settings-body server-settings-body--with-tabs">
                                {error && <div className="modal-error server-settings-error">{error}</div>}

                                {tab === 'general' && (
                                    <div className="server-settings-section channel-settings-general">
                                        <div className="form-group">
                                            <label>Channel Name</label>
                                            <input
                                                type="text"
                                                value={name}
                                                onChange={e => setName(e.target.value)}
                                                placeholder="new-channel-name"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Category</label>
                                            <input
                                                type="text"
                                                value={category}
                                                onChange={e => setCategory(e.target.value)}
                                                placeholder="e.g. Squad 1"
                                                maxLength={64}
                                            />
                                        </div>
                                        <button
                                            className="btn btn-primary"
                                            onClick={handleSaveGeneral}
                                            disabled={
                                                name.trim().length === 0
                                                || (name.trim() === channel.name && category.trim() === (channel.category ?? '').trim())
                                                || savingGeneral
                                            }
                                        >
                                            {savingGeneral ? 'Saving...' : 'Save Changes'}
                                        </button>
                                    </div>
                                )}

                                {tab === 'permissions' && (
                                    <div className="server-settings-section channel-settings-permissions">
                                        <div className="channel-settings-roles-col">
                                            <label className="channel-settings-label">Roles</label>
                                            <div className="channel-settings-roles-list">
                                                {effectiveRoles.map(role => (
                                                    <button
                                                        type="button"
                                                        key={role.id}
                                                        className={`server-role-list-item ${selectedRoleId === role.id ? 'server-role-list-item--active' : ''}`}
                                                        onClick={() => setSelectedRoleId(role.id)}
                                                    >
                                                        <span className="channel-settings-role-dot" style={{ backgroundColor: role.color || 'var(--text-normal)' }} />
                                                        {role.name}
                                                    </button>
                                                ))}
                                                {loadingRoles && (
                                                    <div className="channel-settings-roles-empty">Loading roles...</div>
                                                )}
                                                {!loadingRoles && effectiveRoles.length === 0 && (
                                                    <div className="channel-settings-roles-empty">No roles found in this server.</div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="channel-settings-perm-col">
                                            {channel.category?.trim() && (
                                                <div className="channel-permission-scope">
                                                    <button
                                                        type="button"
                                                        className={`channel-permission-scope-btn ${permissionScope === 'channel' ? 'is-active' : ''}`}
                                                        onClick={() => setPermissionScope('channel')}
                                                    >
                                                        This channel
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`channel-permission-scope-btn ${permissionScope === 'category' ? 'is-active' : ''}`}
                                                        onClick={() => setPermissionScope('category')}
                                                    >
                                                        Category ({channel.category})
                                                    </button>
                                                </div>
                                            )}
                                            {!selectedRoleId ? (
                                                <div className="role-edit-empty channel-settings-empty">
                                                    Select a role to configure channel permissions
                                                </div>
                                            ) : (permissionScope === 'category' ? loadingCategoryPerms : loadingPerms) ? (
                                                <div className="role-edit-empty channel-settings-empty">Loading...</div>
                                            ) : (
                                                <>
                                                    <label className="channel-settings-label channel-settings-label--spaced">
                                                        Advanced Permissions
                                                    </label>
                                                    {permOptions.map(opt => {
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
                                )}

                                {tab === 'danger' && (
                                    <div className="server-settings-section channel-settings-danger">
                                        <div className="server-settings-card server-settings-card--danger channel-settings-danger-card">
                                            <h3 className="server-settings-card__title server-settings-card__title--danger">Delete Channel</h3>
                                            <p className="server-settings-danger-text">
                                                Deleting this channel permanently removes its message history and cannot be undone.
                                            </p>
                                            <button
                                                type="button"
                                                className="btn btn-danger"
                                                onClick={() => setShowDeleteConfirm(true)}
                                            >
                                                Delete Channel
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {showDeleteConfirm && (
                <div
                    className="modal-overlay"
                    onClick={(e) => {
                        e.stopPropagation()
                        if (!deletingChannel) setShowDeleteConfirm(false)
                    }}
                >
                    <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Delete channel</h2>
                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                            Are you sure you want to delete <strong>{channel.name}</strong>? This action cannot be undone.
                        </p>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setShowDeleteConfirm(false)}
                                disabled={deletingChannel}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => void handleDelete()}
                                disabled={deletingChannel}
                            >
                                {deletingChannel ? 'Deleting...' : 'Delete Channel'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
