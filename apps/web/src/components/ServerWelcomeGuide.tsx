import { CheckCircle2, Hash, X } from 'lucide-react'
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
                <span className="server-welcome-guide__eyebrow">Start here</span>
                <h2>{title}</h2>
                {body && <p>{body}</p>}
            </div>
            {guide.starter_tasks.length > 0 && (
                <div className="server-welcome-guide__tasks">
                    {guide.starter_tasks.map((task) => (
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
                            onClick={() => onSelectChannel(channel.id)}
                        >
                            <Hash size={14} />
                            <span>{channel.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    )
}
