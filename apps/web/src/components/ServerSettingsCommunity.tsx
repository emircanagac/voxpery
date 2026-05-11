import ServerSettingsOnboarding from './ServerSettingsOnboarding'
import { serverApi, type AuthToken, type Channel, type ServerOnboardingGuide, type ServerRule, type UpdateServerOnboardingGuideRequest } from '../api'

type ServerSettingsCommunityProps = {
    serverId: string | null
    token: AuthToken
    channels: Channel[]
    guide: ServerOnboardingGuide | null
    onboardingLoading: boolean
    onboardingSaving: boolean
    onboardingError: string | null
    rules: ServerRule[]
    rulesLoading: boolean
    rulesError: string | null
    newRuleText: string
    editingRuleId: string | null
    editingRuleText: string
    onSaveGuide: (payload: UpdateServerOnboardingGuideRequest) => Promise<void>
    onRulesChange: (rules: ServerRule[]) => void
    onRulesError: (message: string) => void
    onNewRuleTextChange: (value: string) => void
    onEditingRuleIdChange: (value: string | null) => void
    onEditingRuleTextChange: (value: string) => void
}

export default function ServerSettingsCommunity({
    serverId,
    token,
    channels,
    guide,
    onboardingLoading,
    onboardingSaving,
    onboardingError,
    rules,
    rulesLoading,
    rulesError,
    newRuleText,
    editingRuleId,
    editingRuleText,
    onSaveGuide,
    onRulesChange,
    onRulesError,
    onNewRuleTextChange,
    onEditingRuleIdChange,
    onEditingRuleTextChange,
}: ServerSettingsCommunityProps) {
    const refreshRules = async () => {
        if (!serverId) return
        const nextRules = await serverApi.listRules(serverId, token)
        onRulesChange(nextRules)
    }

    const updateRule = async (ruleId: string) => {
        if (!serverId || !editingRuleText.trim()) return
        try {
            await serverApi.updateRule(serverId, ruleId, { rule_text: editingRuleText.trim() }, token)
            onEditingRuleIdChange(null)
            onEditingRuleTextChange('')
            await refreshRules()
        } catch (err: unknown) {
            onRulesError(err instanceof Error ? err.message : 'Failed to update rule')
        }
    }

    const deleteRule = async (ruleId: string) => {
        if (!serverId) return
        try {
            await serverApi.deleteRule(serverId, ruleId, token)
            await refreshRules()
        } catch (err: unknown) {
            onRulesError(err instanceof Error ? err.message : 'Failed to delete rule')
        }
    }

    const createRule = async () => {
        if (!serverId || !newRuleText.trim()) return
        try {
            await serverApi.createRule(serverId, newRuleText.trim(), token)
            onNewRuleTextChange('')
            await refreshRules()
        } catch (err: unknown) {
            onRulesError(err instanceof Error ? err.message : 'Failed to create rule')
        }
    }

    return (
        <>
            <ServerSettingsOnboarding
                guide={guide}
                channels={channels}
                loading={onboardingLoading}
                saving={onboardingSaving}
                error={onboardingError}
                onSave={onSaveGuide}
            />
            <section className="server-settings-card server-settings-card--rules">
                {rulesError && (
                    <div className="auth-error" style={{ marginBottom: 12 }}>
                        {rulesError}
                    </div>
                )}
                <div className="server-rules-layout">
                    <div className="server-rules-toolbar">
                        <div className="server-rules-toolbar__copy">
                            <span className="server-rules-toolbar__eyebrow">Rules</span>
                            <strong className="server-rules-toolbar__title">{rules.length} rules</strong>
                            <span className="server-rules-toolbar__hint">
                                Set clear expectations for your community. Rules are shown to users before they join.
                            </span>
                        </div>
                    </div>
                    <div className="server-rules-list">
                        {rulesLoading && (
                            <div className="server-rules-loading">Loading rules...</div>
                        )}
                        {!rulesLoading && rules.length === 0 && (
                            <div className="server-rules-empty">
                                No rules yet. Add your first rule below.
                            </div>
                        )}
                        {rules.map((rule, index) => (
                            <div key={rule.id} className="server-rule-item">
                                <div className="server-rule-item__number">{index + 1}</div>
                                {editingRuleId === rule.id ? (
                                    <div className="server-rule-item__edit">
                                        <textarea
                                            value={editingRuleText}
                                            onChange={(event) => onEditingRuleTextChange(event.target.value)}
                                            className="server-rule-textarea"
                                            rows={2}
                                            maxLength={1000}
                                        />
                                        <div className="server-rule-item__actions">
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => {
                                                    onEditingRuleIdChange(null)
                                                    onEditingRuleTextChange('')
                                                }}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-primary btn-sm"
                                                disabled={!editingRuleText.trim() || !serverId}
                                                onClick={() => void updateRule(rule.id)}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="server-rule-item__content">
                                        <p className="server-rule-text">{rule.rule_text}</p>
                                        <div className="server-rule-item__actions">
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => {
                                                    onEditingRuleIdChange(rule.id)
                                                    onEditingRuleTextChange(rule.rule_text)
                                                }}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-danger-outline btn-sm"
                                                disabled={!serverId}
                                                onClick={() => void deleteRule(rule.id)}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="server-rules-add">
                        <textarea
                            value={newRuleText}
                            onChange={(event) => onNewRuleTextChange(event.target.value)}
                            className="server-rule-textarea"
                            placeholder="Add a new rule..."
                            rows={2}
                            maxLength={1000}
                        />
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={!newRuleText.trim() || !serverId}
                            onClick={() => void createRule()}
                        >
                            Add rule
                        </button>
                    </div>
                </div>
            </section>
        </>
    )
}
