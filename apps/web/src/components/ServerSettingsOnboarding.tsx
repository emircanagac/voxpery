import { useEffect, useMemo, useState } from 'react'
import { Check, Hash } from 'lucide-react'
import type { Channel, ServerOnboardingGuide, UpdateServerOnboardingGuideRequest } from '../api'

const MAX_RECOMMENDED_CHANNELS = 6
const MAX_STARTER_TASKS = 6

interface ServerSettingsOnboardingProps {
    guide: ServerOnboardingGuide | null
    channels: Channel[]
    loading: boolean
    saving: boolean
    error: string | null
    onSave: (payload: UpdateServerOnboardingGuideRequest) => Promise<void>
}

export default function ServerSettingsOnboarding({
    guide,
    channels,
    loading,
    saving,
    error,
    onSave,
}: ServerSettingsOnboardingProps) {
    const [enabled, setEnabled] = useState(false)
    const [title, setTitle] = useState('')
    const [body, setBody] = useState('')
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
    const [starterTasks, setStarterTasks] = useState<string[]>([''])

    useEffect(() => {
        setEnabled(guide?.enabled ?? false)
        setTitle(guide?.title ?? '')
        setBody(guide?.body ?? '')
        setSelectedChannelIds(guide?.recommended_channel_ids ?? [])
        setStarterTasks(guide?.starter_tasks.length ? guide.starter_tasks : [''])
    }, [guide])

    const selectableChannels = useMemo(
        () => channels.filter((channel) => channel.channel_type === 'text'),
        [channels],
    )
    const trimmedTasks = starterTasks.map((task) => task.trim()).filter(Boolean)
    const hasRequiredContent = title.trim().length > 0 || body.trim().length > 0 || trimmedTasks.length > 0 || selectedChannelIds.length > 0

    const toggleChannel = (channelId: string) => {
        setSelectedChannelIds((current) => {
            if (current.includes(channelId)) return current.filter((id) => id !== channelId)
            if (current.length >= MAX_RECOMMENDED_CHANNELS) return current
            return [...current, channelId]
        })
    }

    const updateTask = (index: number, value: string) => {
        setStarterTasks((current) => current.map((task, taskIndex) => (taskIndex === index ? value : task)))
    }

    const removeTask = (index: number) => {
        setStarterTasks((current) => {
            const next = current.filter((_, taskIndex) => taskIndex !== index)
            return next.length > 0 ? next : ['']
        })
    }

    return (
        <section className="server-settings-card server-settings-card--stack">
            <h3 className="server-settings-card__title">Welcome guide</h3>
            <div className="server-settings-panel-copy">
                <p className="server-settings-note">
                    Show new members a short guide with starter tasks and useful channels when they enter this server.
                </p>
            </div>

            {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
            {loading && <div className="server-settings-empty-state">Loading welcome guide...</div>}

            {!loading && (
                <div className="onboarding-settings-layout">
                    <label className="onboarding-enable-row">
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) => setEnabled(event.target.checked)}
                        />
                        <span>
                            <strong>Enable welcome guide</strong>
                            <small>Members can dismiss it after reading.</small>
                        </span>
                    </label>

                    <div className="form-group">
                        <label>Welcome title</label>
                        <input
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            maxLength={80}
                            placeholder="Welcome to the community"
                        />
                    </div>

                    <div className="form-group">
                        <label>Intro text</label>
                        <textarea
                            value={body}
                            onChange={(event) => setBody(event.target.value)}
                            maxLength={1000}
                            rows={4}
                            placeholder="Tell new members where to start and what this server is for."
                        />
                    </div>

                    <div className="onboarding-settings-section">
                        <div className="onboarding-settings-section__head">
                            <strong>Recommended channels</strong>
                            <span>{selectedChannelIds.length}/{MAX_RECOMMENDED_CHANNELS}</span>
                        </div>
                        <div className="onboarding-channel-picker">
                            {selectableChannels.length === 0 && (
                                <div className="server-settings-empty-state">Create a text channel before recommending one.</div>
                            )}
                            {selectableChannels.map((channel) => {
                                const selected = selectedChannelIds.includes(channel.id)
                                return (
                                    <button
                                        key={channel.id}
                                        type="button"
                                        className={`onboarding-channel-option ${selected ? 'onboarding-channel-option--selected' : ''}`}
                                        onClick={() => toggleChannel(channel.id)}
                                    >
                                        {selected ? <Check size={14} /> : <Hash size={14} />}
                                        <span>{channel.name}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="onboarding-settings-section">
                        <div className="onboarding-settings-section__head">
                            <strong>Starter tasks</strong>
                            <span>{trimmedTasks.length}/{MAX_STARTER_TASKS}</span>
                        </div>
                        <div className="onboarding-task-editor">
                            {starterTasks.map((task, index) => (
                                <div key={index} className="onboarding-task-row">
                                    <input
                                        value={task}
                                        onChange={(event) => updateTask(index, event.target.value)}
                                        maxLength={120}
                                        placeholder="Introduce yourself"
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => removeTask(index)}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={starterTasks.length >= MAX_STARTER_TASKS}
                                onClick={() => setStarterTasks((current) => [...current, ''])}
                            >
                                Add task
                            </button>
                        </div>
                    </div>

                    <div className="server-settings-server-actions">
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={saving || (enabled && !hasRequiredContent)}
                            onClick={() => onSave({
                                enabled,
                                title: title.trim(),
                                body: body.trim(),
                                recommended_channel_ids: selectedChannelIds,
                                starter_tasks: trimmedTasks,
                            })}
                        >
                            {saving ? 'Saving...' : 'Save guide'}
                        </button>
                    </div>
                </div>
            )}
        </section>
    )
}
