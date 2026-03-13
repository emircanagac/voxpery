import { useState, useMemo } from 'react'
import { X, Trash2, Shield, Settings } from 'lucide-react'
import type { Channel, ServerRole } from '../api'
import { channelApi } from '../api'
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
    const [tab, setTab] = useState<'general' | 'permissions'>('general')

    // General state
    const [name, setName] = useState(channel.name)
    const [savingGeneral, setSavingGeneral] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Permissions state
    const [overrides, setOverrides] = useState<ChannelOverride[]>([])
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
    const [loadingPerms, setLoadingPerms] = useState(false)

    const openPermissionsTab = async () => {
        setTab('permissions')
        if (overrides.length > 0 || loadingPerms) return
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

    const handleSaveGeneral = async () => {
        setSavingGeneral(true)
        setError(null)
        try {
            const updated = await channelApi.rename(channel.id, name, token)
            onUpdated?.(updated)
            onClose()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
            setSavingGeneral(false)
        }
    }

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this channel?')) return
        try {
            await channelApi.delete(channel.id, token)
            onDeleted?.(channel.id)
            onClose()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        }
    }

    const currentOverride = useMemo(() => {
        if (!selectedRoleId) return null
        return overrides.find(o => o.role_id === selectedRoleId) || { role_id: selectedRoleId, allow: 0, deny: 0 }
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
            const updated = await channelApi.updateOverride(channel.id, selectedRoleId, newAllow, newDeny, token)
            setOverrides(prev => {
                const filtered = prev.filter(o => o.role_id !== selectedRoleId)
                return [...filtered, updated]
            })
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
            <div className="modal server-settings-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800 }}>
                <div className="server-settings-layout">
                    <div className="server-settings-sidebar">
                        <div className="server-settings-sidebar-header">
                            {channel.name} Settings
                        </div>
                        <button className={`server-settings-tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>
                            <Settings size={16} />
                            Overview
                        </button>
                        <button className={`server-settings-tab ${tab === 'permissions' ? 'active' : ''}`} onClick={() => { void openPermissionsTab() }}>
                            <Shield size={16} />
                            Permissions
                        </button>
                        <div className="server-settings-sidebar-divider" />
                        <button className="server-settings-tab danger" onClick={handleDelete}>
                            <Trash2 size={16} />
                            Delete Channel
                        </button>
                    </div>

                    <div className="server-settings-content">
                        <div className="server-settings-content-inner">
                            <div className="server-settings-header">
                                <h2>{tab === 'general' ? 'Overview' : 'Permissions'}</h2>
                                <button className="modal-close-btn" onClick={onClose}>
                                    <X size={20} />
                                </button>
                            </div>
                            
                            <div className="server-settings-body server-settings-body--with-tabs">
                                {error && <div className="modal-error">{error}</div>}

                                {tab === 'general' && (
                                    <div className="server-settings-section">
                                        <div className="form-group">
                                            <label>Channel Name</label>
                                            <input 
                                                type="text" 
                                                value={name} 
                                                onChange={e => setName(e.target.value)} 
                                                placeholder="new-channel-name"
                                            />
                                        </div>
                                        <button 
                                            className="btn btn-primary" 
                                            onClick={handleSaveGeneral}
                                            disabled={name.trim().length === 0 || name.trim() === channel.name || savingGeneral}
                                            style={{ marginTop: 16 }}
                                        >
                                            {savingGeneral ? 'Saving...' : 'Save Changes'}
                                        </button>
                                    </div>
                                )}

                                {tab === 'permissions' && (
                                    <div className="server-settings-section" style={{ display: 'flex', gap: 20 }}>
                                        <div className="roles-list-col" style={{ width: 200 }}>
                                            <label style={{ display: 'block', marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>ROLES</label>
                                            <div className="roles-list">
                                                {serverRoles.map(role => (
                                                    <div 
                                                        key={role.id} 
                                                        className={`role-list-item ${selectedRoleId === role.id ? 'active' : ''}`}
                                                        onClick={() => setSelectedRoleId(role.id)}
                                                    >
                                                        <span className="role-color-dot" style={{ backgroundColor: role.color || 'var(--text-normal)' }} />
                                                        {role.name}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="role-edit-col" style={{ flex: 1 }}>
                                            {!selectedRoleId ? (
                                                <div className="role-edit-empty">
                                                    Select a role to configure channel permissions
                                                </div>
                                            ) : loadingPerms ? (
                                                <div className="role-edit-empty">Loading...</div>
                                            ) : (
                                                <>
                                                    <label style={{ display: 'block', marginBottom: 16, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                                        ADVANCED PERMISSIONS
                                                    </label>
                                                    {permOptions.map(opt => {
                                                        const isAllowed = (currentOverride!.allow & opt.bit) === opt.bit
                                                        const isDenied = (currentOverride!.deny & opt.bit) === opt.bit
                                                        return (
                                                            <div key={opt.bit} className="channel-perm-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                                                                <span>{opt.label}</span>
                                                                <div className="channel-perm-switches" style={{ display: 'flex', background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
                                                                    <button 
                                                                        className={`perm-btn ${isDenied ? 'denied' : ''}`}
                                                                        onClick={() => updateOverrideBit(opt.bit, 'deny')}
                                                                        style={{ padding: '6px 12px', border: 'none', background: isDenied ? '#f38ba8' : 'transparent', color: isDenied ? '#1e1e2e' : 'inherit', cursor: 'pointer' }}
                                                                    >
                                                                        <X size={14} />
                                                                    </button>
                                                                    <button 
                                                                        className={`perm-btn ${!isAllowed && !isDenied ? 'inherit' : ''}`}
                                                                        onClick={() => updateOverrideBit(opt.bit, 'inherit')}
                                                                        style={{ padding: '6px 12px', border: 'none', background: !isAllowed && !isDenied ? 'var(--bg-modifier-selected)' : 'transparent', cursor: 'pointer' }}
                                                                    >
                                                                        /
                                                                    </button>
                                                                    <button 
                                                                        className={`perm-btn ${isAllowed ? 'allowed' : ''}`}
                                                                        onClick={() => updateOverrideBit(opt.bit, 'allow')}
                                                                        style={{ padding: '6px 12px', border: 'none', background: isAllowed ? '#a6e3a1' : 'transparent', color: isAllowed ? '#1e1e2e' : 'inherit', cursor: 'pointer' }}
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
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
