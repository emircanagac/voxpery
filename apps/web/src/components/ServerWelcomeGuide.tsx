import { Circle, Hash, Mic, X } from 'lucide-react'
import type { Channel, ServerOnboardingGuide } from '../api'

const PROJECT_TASK = 'explore the open-source project on github'
const PERM_CONNECT_VOICE = 1 << 10

function channelTask(channel: Channel, tasks: string[]): string | undefined {
    const matchingLabels = channel.channel_type === 'voice'
        ? [`join the ${channel.name} voice channel`]
        : [`send your first message in #${channel.name}`, 'introduce yourself']
    return tasks.find((task) => matchingLabels.some((label) => label.toLowerCase() === task.trim().toLowerCase()))
}

interface ServerWelcomeGuideProps {
    guide: ServerOnboardingGuide
    channels: Channel[]
    serverName: string
    onSelectChannel: (channelId: string) => void
    onJoinVoice: (channelId: string) => void
    onDismiss: () => void
}

export default function ServerWelcomeGuide({
    guide,
    channels,
    serverName,
    onSelectChannel,
    onJoinVoice,
    onDismiss,
}: ServerWelcomeGuideProps) {
    const recommendedChannels = guide.recommended_channel_ids
        .map((channelId) => channels.find((channel) => channel.id === channelId))
        .filter((channel): channel is Channel => !!channel)
    const title = guide.title.trim() || `Welcome to ${serverName}`
    const body = guide.body.trim()
    const channelTasks = new Map(recommendedChannels.map((channel) => [channel.id, channelTask(channel, guide.starter_tasks)]))
    const actionTasks = new Set([...channelTasks.values()].filter((task): task is string => !!task))
    const starterTasks = guide.starter_tasks.filter((task) => !actionTasks.has(task) && task.trim().toLowerCase() !== PROJECT_TASK)

    return (
        <section className="server-welcome-guide">
            <button
                type="button"
                className="server-welcome-guide__dismiss"
                aria-label="Dismiss welcome guide"
                onClick={onDismiss}
            >
                <X size={16} />
            </button>
            <div className="server-welcome-guide__copy">
                <h2>{title}</h2>
                {body && <p>{body}</p>}
            </div>
            <div className="server-welcome-guide__actions">
            {recommendedChannels.length > 0 && (
                <div className="server-welcome-guide__channels">
                    {recommendedChannels.map((channel) => {
                        const canJoinVoice = channel.channel_type !== 'voice'
                            || ((channel.my_permissions ?? 0) & PERM_CONNECT_VOICE) === PERM_CONNECT_VOICE
                        return (
                        <button
                            key={channel.id}
                            type="button"
                            className="server-welcome-guide__channel"
                            aria-label={`${channel.channel_type === 'voice' ? 'Join voice channel' : 'Open channel'} ${channel.name}`}
                            disabled={!canJoinVoice}
                            title={!canJoinVoice ? "You don't have permission to connect to this voice channel." : undefined}
                            onClick={() => channel.channel_type === 'voice' ? onJoinVoice(channel.id) : onSelectChannel(channel.id)}
                        >
                            {channel.channel_type === 'voice' ? <Mic size={14} /> : <Hash size={14} />}
                            <span>{channelTasks.get(channel.id)?.trim().toLowerCase() === 'introduce yourself'
                                ? `Introduce yourself in ${channel.name}`
                                : channel.channel_type === 'voice'
                                    ? `Join ${channel.name}`
                                    : channelTasks.get(channel.id) ? `Message ${channel.name}` : `Open ${channel.name}`}</span>
                        </button>
                        )
                    })}
                </div>
            )}
            {starterTasks.length > 0 && (
                <div className="server-welcome-guide__tasks">
                    {starterTasks.map((task) => (
                        <div key={task} className="server-welcome-guide__task">
                            <Circle size={15} />
                            <span>{task}</span>
                        </div>
                    ))}
                </div>
            )}
            </div>
        </section>
    )
}
