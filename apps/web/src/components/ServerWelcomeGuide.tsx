import { CheckCircle2, Hash, Mic, X } from 'lucide-react'
import type { Channel, ServerOnboardingGuide } from '../api'

interface ServerWelcomeGuideProps {
    guide: ServerOnboardingGuide
    channels: Channel[]
    serverName: string
    onSelectChannel: (channelId: string) => void
    onDismiss: () => void
}

export default function ServerWelcomeGuide({
    guide,
    channels,
    serverName,
    onSelectChannel,
    onDismiss,
}: ServerWelcomeGuideProps) {
    const recommendedChannels = guide.recommended_channel_ids
        .map((channelId) => channels.find((channel) => channel.id === channelId))
        .filter((channel): channel is Channel => !!channel)
    const title = guide.title.trim() || `Welcome to ${serverName}`
    const body = guide.body.trim()
    const introductionTask = guide.starter_tasks.find((task) => task.trim().toLowerCase() === 'introduce yourself')
    const introductionChannel = introductionTask ? recommendedChannels.find((channel) => channel.channel_type === 'text') : undefined
    const starterTasks = guide.starter_tasks.filter((task) => !(introductionChannel && task === introductionTask))

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
            {starterTasks.length > 0 && (
                <div className="server-welcome-guide__tasks">
                    {starterTasks.map((task) => (
                        <div key={task} className="server-welcome-guide__task">
                            <CheckCircle2 size={15} />
                            <span>{task}</span>
                        </div>
                    ))}
                </div>
            )}
            {recommendedChannels.length > 0 && (
                <div className="server-welcome-guide__channels">
                    {recommendedChannels.map((channel) => (
                        <button
                            key={channel.id}
                            type="button"
                            className="server-welcome-guide__channel"
                            aria-label={`${channel.channel_type === 'voice' ? 'Join voice channel' : 'Open channel'} ${channel.name}`}
                            onClick={() => onSelectChannel(channel.id)}
                        >
                            {channel.channel_type === 'voice' ? <Mic size={14} /> : <Hash size={14} />}
                            <span>{channel.id === introductionChannel?.id ? `Introduce yourself in #${channel.name}` : channel.name}</span>
                        </button>
                    ))}
                </div>
            )}
            </div>
        </section>
    )
}
