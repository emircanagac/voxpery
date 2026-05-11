import { useEffect, useMemo, useState } from 'react'
import { serverApi, type AuthToken, type AutoModRule, type AutoModTriggerType, type Channel, type ServerRole } from '../api'

type ServerSettingsAutoModProps = {
    serverId: string
    token: AuthToken
}

type DraftState = {
    name: string
    triggerType: AutoModTriggerType
    pattern: string
    mentionLimit: number
    enabled: boolean
    exemptRoleIds: string[]
    exemptChannelIds: string[]
}

const TRIGGER_OPTIONS: Array<{ value: AutoModTriggerType; label: string }> = [
    { value: 'blocked_keyword', label: 'Blocked keyword' },
    { value: 'invite_filter', label: 'Invite links' },
    { value: 'link_filter', label: 'Links' },
    { value: 'mention_spam', label: 'Mention spam' },
]

const DEFAULT_DRAFT: DraftState = {
    name: '',
    triggerType: 'blocked_keyword',
    pattern: '',
    mentionLimit: 5,
    enabled: true,
    exemptRoleIds: [],
    exemptChannelIds: [],
}

function draftFromRule(rule: AutoModRule): DraftState {
    return {
        name: rule.name,
        triggerType: rule.trigger_type,
        pattern: rule.pattern ?? '',
        mentionLimit: rule.mention_limit ?? 5,
        enabled: rule.enabled,
        exemptRoleIds: rule.exempt_role_ids,
        exemptChannelIds: rule.exempt_channel_ids,
    }
}

function triggerLabel(value: AutoModTriggerType) {
    return TRIGGER_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function testRule(rule: Pick<AutoModRule, 'trigger_type' | 'pattern' | 'mention_limit'>, text: string) {
    const lower = text.toLowerCase()
    if (rule.trigger_type === 'blocked_keyword') {
        const pattern = rule.pattern?.trim().toLowerCase()
        return !!pattern && lower.includes(pattern)
    }
    if (rule.trigger_type === 'invite_filter') {
        return lower.includes('discord.gg/')
            || lower.includes('discord.com/invite/')
            || lower.includes('discordapp.com/invite/')
            || lower.includes('/invite/')
    }
    if (rule.trigger_type === 'link_filter') {
        return lower.includes('http://')
            || lower.includes('https://')
            || lower.includes('www.')
            || lower.includes('.com')
            || lower.includes('.net')
            || lower.includes('.org')
    }
    const mentionCount = text.match(/(^|[^A-Za-z0-9_.])@[A-Za-z0-9_]+/g)?.length ?? 0
    return mentionCount >= (rule.mention_limit ?? 5)
}

export default function ServerSettingsAutoMod({ serverId, token }: ServerSettingsAutoModProps) {
    const [rules, setRules] = useState<AutoModRule[]>([])
    const [roles, setRoles] = useState<ServerRole[]>([])
    const [channels, setChannels] = useState<Channel[]>([])
    const [draft, setDraft] = useState<DraftState>(DEFAULT_DRAFT)
    const [testText, setTestText] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [busyRuleId, setBusyRuleId] = useState<string | null>(null)
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
    const [editingDraft, setEditingDraft] = useState<DraftState>(DEFAULT_DRAFT)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        Promise.all([
            serverApi.listAutoModRules(serverId, token),
            serverApi.channels(serverId, token).catch(() => []),
            serverApi.listRoles(serverId, token, { includeSystem: true }).catch(() => []),
        ]).then(([nextRules, nextChannels, nextRoles]) => {
            if (cancelled) return
            setRules(nextRules)
            setChannels(nextChannels.filter((channel) => channel.channel_type === 'text'))
            setRoles(nextRoles)
        }).catch((err) => {
            if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load AutoMod rules.')
        }).finally(() => {
            if (!cancelled) setLoading(false)
        })
        return () => {
            cancelled = true
        }
    }, [serverId, token])

    const draftTestResult = useMemo(() => {
        if (!testText.trim()) return null
        return testRule({
            trigger_type: draft.triggerType,
            pattern: draft.pattern || null,
            mention_limit: draft.mentionLimit,
        }, testText)
    }, [draft.mentionLimit, draft.pattern, draft.triggerType, testText])

    const canCreate = draft.name.trim().length > 0
        && (draft.triggerType !== 'blocked_keyword' || draft.pattern.trim().length >= 2)

    const canUpdate = editingDraft.name.trim().length > 0
        && (editingDraft.triggerType !== 'blocked_keyword' || editingDraft.pattern.trim().length >= 2)

    const toggleDraftRole = (roleId: string) => {
        setDraft((prev) => ({
            ...prev,
            exemptRoleIds: prev.exemptRoleIds.includes(roleId)
                ? prev.exemptRoleIds.filter((id) => id !== roleId)
                : [...prev.exemptRoleIds, roleId],
        }))
    }

    const toggleDraftChannel = (channelId: string) => {
        setDraft((prev) => ({
            ...prev,
            exemptChannelIds: prev.exemptChannelIds.includes(channelId)
                ? prev.exemptChannelIds.filter((id) => id !== channelId)
                : [...prev.exemptChannelIds, channelId],
        }))
    }

    const toggleEditingRole = (roleId: string) => {
        setEditingDraft((prev) => ({
            ...prev,
            exemptRoleIds: prev.exemptRoleIds.includes(roleId)
                ? prev.exemptRoleIds.filter((id) => id !== roleId)
                : [...prev.exemptRoleIds, roleId],
        }))
    }

    const toggleEditingChannel = (channelId: string) => {
        setEditingDraft((prev) => ({
            ...prev,
            exemptChannelIds: prev.exemptChannelIds.includes(channelId)
                ? prev.exemptChannelIds.filter((id) => id !== channelId)
                : [...prev.exemptChannelIds, channelId],
        }))
    }

    const createRule = async () => {
        if (!canCreate) return
        setSaving(true)
        setError(null)
        try {
            const rule = await serverApi.createAutoModRule(serverId, {
                name: draft.name.trim(),
                trigger_type: draft.triggerType,
                pattern: draft.triggerType === 'blocked_keyword' ? draft.pattern.trim() : null,
                mention_limit: draft.triggerType === 'mention_spam' ? draft.mentionLimit : null,
                enabled: draft.enabled,
                exempt_role_ids: draft.exemptRoleIds,
                exempt_channel_ids: draft.exemptChannelIds,
            }, token)
            setRules((prev) => [...prev, rule])
            setDraft(DEFAULT_DRAFT)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create AutoMod rule.')
        } finally {
            setSaving(false)
        }
    }

    const startEditingRule = (rule: AutoModRule) => {
        setError(null)
        setEditingRuleId(rule.id)
        setEditingDraft(draftFromRule(rule))
    }

    const cancelEditingRule = () => {
        setEditingRuleId(null)
        setEditingDraft(DEFAULT_DRAFT)
    }

    const saveEditingRule = async (ruleId: string) => {
        if (!canUpdate) return
        setBusyRuleId(ruleId)
        setError(null)
        try {
            const updated = await serverApi.updateAutoModRule(serverId, ruleId, {
                name: editingDraft.name.trim(),
                trigger_type: editingDraft.triggerType,
                pattern: editingDraft.triggerType === 'blocked_keyword' ? editingDraft.pattern.trim() : null,
                mention_limit: editingDraft.triggerType === 'mention_spam' ? editingDraft.mentionLimit : null,
                enabled: editingDraft.enabled,
                exempt_role_ids: editingDraft.exemptRoleIds,
                exempt_channel_ids: editingDraft.exemptChannelIds,
            }, token)
            setRules((prev) => prev.map((item) => item.id === updated.id ? updated : item))
            cancelEditingRule()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update AutoMod rule.')
        } finally {
            setBusyRuleId(null)
        }
    }

    const toggleRule = async (rule: AutoModRule) => {
        setBusyRuleId(rule.id)
        setError(null)
        try {
            const updated = await serverApi.updateAutoModRule(serverId, rule.id, { enabled: !rule.enabled }, token)
            setRules((prev) => prev.map((item) => item.id === updated.id ? updated : item))
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update AutoMod rule.')
        } finally {
            setBusyRuleId(null)
        }
    }

    const deleteRule = async (rule: AutoModRule) => {
        setBusyRuleId(rule.id)
        setError(null)
        try {
            await serverApi.deleteAutoModRule(serverId, rule.id, token)
            setRules((prev) => prev.filter((item) => item.id !== rule.id))
            if (editingRuleId === rule.id) cancelEditingRule()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete AutoMod rule.')
        } finally {
            setBusyRuleId(null)
        }
    }

    return (
        <section className="server-settings-card server-settings-card--stack server-settings-safety-section">
            <h3 className="server-settings-card__title">AutoMod</h3>
            {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
            {loading ? (
                <div className="server-settings-empty-state">Loading AutoMod rules...</div>
            ) : (
                <div className="server-report-list">
                    {rules.length === 0 && (
                        <div className="server-settings-empty-state">No AutoMod rules yet.</div>
                    )}
                    {rules.map((rule) => {
                        const isEditing = editingRuleId === rule.id
                        return (
                            <div key={rule.id} className="server-report-row">
                                <div className="server-report-meta">
                                    <div className="server-report-head">
                                        <strong>{rule.name}</strong>
                                        <span className={`server-report-status ${rule.enabled ? 'is-open' : 'is-resolved'}`}>
                                            {rule.enabled ? 'Enabled' : 'Disabled'}
                                        </span>
                                    </div>
                                    <div className="server-report-tags">
                                        <span className="server-report-tag server-report-tag--reason">
                                            {triggerLabel(rule.trigger_type)}
                                        </span>
                                        {rule.pattern && <span className="server-report-tag">{rule.pattern}</span>}
                                        {rule.mention_limit && <span className="server-report-tag">{rule.mention_limit} mentions</span>}
                                        {(rule.exempt_role_ids.length > 0 || rule.exempt_channel_ids.length > 0) && (
                                            <span className="server-report-tag">
                                                {rule.exempt_role_ids.length + rule.exempt_channel_ids.length} exemptions
                                            </span>
                                        )}
                                    </div>
                                    {isEditing && (
                                        <div className="server-settings-subcard server-settings-automod-edit">
                                            <h3 className="server-settings-card__title">Edit rule</h3>
                                            <div className="server-settings-form-stack">
                                                <div className="form-group">
                                                    <label>Rule name</label>
                                                    <input
                                                        value={editingDraft.name}
                                                        maxLength={80}
                                                        onChange={(event) => setEditingDraft((prev) => ({ ...prev, name: event.target.value }))}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label>Trigger</label>
                                                    <select
                                                        value={editingDraft.triggerType}
                                                        onChange={(event) => setEditingDraft((prev) => ({ ...prev, triggerType: event.target.value as AutoModTriggerType }))}
                                                    >
                                                        {TRIGGER_OPTIONS.map((option) => (
                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                {editingDraft.triggerType === 'blocked_keyword' && (
                                                    <div className="form-group">
                                                        <label>Keyword</label>
                                                        <input
                                                            value={editingDraft.pattern}
                                                            maxLength={128}
                                                            onChange={(event) => setEditingDraft((prev) => ({ ...prev, pattern: event.target.value }))}
                                                        />
                                                    </div>
                                                )}
                                                {editingDraft.triggerType === 'mention_spam' && (
                                                    <div className="form-group">
                                                        <label>Mention limit</label>
                                                        <input
                                                            type="number"
                                                            min={2}
                                                            max={50}
                                                            value={editingDraft.mentionLimit}
                                                            onChange={(event) => setEditingDraft((prev) => ({ ...prev, mentionLimit: Number(event.target.value) || 5 }))}
                                                        />
                                                    </div>
                                                )}
                                                <label className="server-settings-check-row">
                                                    <input
                                                        type="checkbox"
                                                        checked={editingDraft.enabled}
                                                        onChange={(event) => setEditingDraft((prev) => ({ ...prev, enabled: event.target.checked }))}
                                                    />
                                                    <span>Enabled</span>
                                                </label>
                                                {roles.length > 0 && (
                                                    <div className="server-settings-option-group">
                                                        <div className="server-settings-option-group__title">Exempt roles</div>
                                                        <div className="server-settings-option-group__items">
                                                            {roles.map((role) => (
                                                                <label key={role.id} className="server-settings-check-item">
                                                                    <input type="checkbox" checked={editingDraft.exemptRoleIds.includes(role.id)} onChange={() => toggleEditingRole(role.id)} />
                                                                    <span>{role.name}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {channels.length > 0 && (
                                                    <div className="server-settings-option-group">
                                                        <div className="server-settings-option-group__title">Exempt channels</div>
                                                        <div className="server-settings-option-group__items">
                                                            {channels.map((channel) => (
                                                                <label key={channel.id} className="server-settings-check-item">
                                                                    <input type="checkbox" checked={editingDraft.exemptChannelIds.includes(channel.id)} onChange={() => toggleEditingChannel(channel.id)} />
                                                                    <span>#{channel.name}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="server-report-actions">
                                    {isEditing ? (
                                        <>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                disabled={busyRuleId === rule.id}
                                                onClick={cancelEditingRule}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-primary btn-sm"
                                                disabled={!canUpdate || busyRuleId === rule.id}
                                                onClick={() => void saveEditingRule(rule.id)}
                                            >
                                                {busyRuleId === rule.id ? 'Saving...' : 'Save'}
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                disabled={busyRuleId === rule.id}
                                                onClick={() => startEditingRule(rule)}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                disabled={busyRuleId === rule.id}
                                                onClick={() => void toggleRule(rule)}
                                            >
                                                {rule.enabled ? 'Disable' : 'Enable'}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-danger-outline btn-sm"
                                                disabled={busyRuleId === rule.id}
                                                onClick={() => void deleteRule(rule)}
                                            >
                                                Delete
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            <div className="server-settings-automod-create server-settings-subcard">
                <h3 className="server-settings-card__title">Create rule</h3>
                <div className="server-settings-form-stack">
                    <div className="form-group">
                        <label>Rule name</label>
                        <input value={draft.name} maxLength={80} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} />
                    </div>
                    <div className="form-group">
                        <label>Trigger</label>
                        <select value={draft.triggerType} onChange={(e) => setDraft((prev) => ({ ...prev, triggerType: e.target.value as AutoModTriggerType }))}>
                            {TRIGGER_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    {draft.triggerType === 'blocked_keyword' && (
                        <div className="form-group">
                            <label>Keyword</label>
                            <input value={draft.pattern} maxLength={128} onChange={(e) => setDraft((prev) => ({ ...prev, pattern: e.target.value }))} />
                        </div>
                    )}
                    {draft.triggerType === 'mention_spam' && (
                        <div className="form-group">
                            <label>Mention limit</label>
                            <input type="number" min={2} max={50} value={draft.mentionLimit} onChange={(e) => setDraft((prev) => ({ ...prev, mentionLimit: Number(e.target.value) || 5 }))} />
                        </div>
                    )}
                    <label className="server-settings-check-row">
                        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))} />
                        <span>Enabled</span>
                    </label>
                    {roles.length > 0 && (
                        <div className="server-settings-option-group">
                            <div className="server-settings-option-group__title">Exempt roles</div>
                            <div className="server-settings-option-group__items">
                                {roles.map((role) => (
                                    <label key={role.id} className="server-settings-check-item">
                                        <input type="checkbox" checked={draft.exemptRoleIds.includes(role.id)} onChange={() => toggleDraftRole(role.id)} />
                                        <span>{role.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                    {channels.length > 0 && (
                        <div className="server-settings-option-group">
                            <div className="server-settings-option-group__title">Exempt channels</div>
                            <div className="server-settings-option-group__items">
                                {channels.map((channel) => (
                                    <label key={channel.id} className="server-settings-check-item">
                                        <input type="checkbox" checked={draft.exemptChannelIds.includes(channel.id)} onChange={() => toggleDraftChannel(channel.id)} />
                                        <span>#{channel.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="form-group">
                        <label>Test text</label>
                        <input value={testText} onChange={(e) => setTestText(e.target.value)} />
                        {draftTestResult != null && (
                            <div className="server-report-subline">
                                {draftTestResult ? 'This rule would block the test text.' : 'This rule would allow the test text.'}
                            </div>
                        )}
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" disabled={!canCreate || saving} onClick={() => void createRule()}>
                        {saving ? 'Creating...' : 'Create rule'}
                    </button>
                </div>
            </div>
        </section>
    )
}
