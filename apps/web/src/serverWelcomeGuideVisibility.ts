import type { Channel, ServerOnboardingGuide } from './api'

interface ServerWelcomeGuideVisibilityOptions {
  activeServerId: string | null
  activeChannelType: Channel['channel_type'] | null | undefined
  guide: ServerOnboardingGuide | null
  dismissed: boolean
}

export function shouldShowServerWelcomeGuide({
  activeServerId,
  activeChannelType,
  guide,
  dismissed,
}: ServerWelcomeGuideVisibilityOptions): boolean {
  return !!activeServerId
    && activeChannelType === 'text'
    && guide?.server_id === activeServerId
    && guide.enabled
    && !dismissed
}
