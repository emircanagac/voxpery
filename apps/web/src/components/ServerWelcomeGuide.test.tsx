import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ServerWelcomeGuide from './ServerWelcomeGuide'
import { shouldShowServerWelcomeGuide } from '../serverWelcomeGuideVisibility'
import type { Channel, ServerOnboardingGuide } from '../api'

const channels: Channel[] = [
  {
    id: 'text-1',
    server_id: 'server-1',
    name: 'general',
    channel_type: 'text',
    category: 'General',
    position: 0,
  },
  {
    id: 'voice-1',
    server_id: 'server-1',
    name: 'General',
    channel_type: 'voice',
    category: 'General',
    position: 1,
  },
]

const guide: ServerOnboardingGuide = {
  server_id: 'server-1',
  enabled: true,
  title: 'Welcome to the Voxpery Community',
  body: 'Start here, say hello, and jump into voice when you are ready.',
  recommended_channel_ids: ['text-1', 'voice-1'],
  starter_tasks: [
    'Send your first message in #general',
    'Join the General voice channel',
    'Explore the open-source project on GitHub',
  ],
  updated_at: '2026-06-29T00:00:00.000Z',
}

describe('ServerWelcomeGuide', () => {
  it('only allows the guide that belongs to the active text-channel server', () => {
    expect(shouldShowServerWelcomeGuide({
      activeServerId: 'server-1',
      activeChannelType: 'text',
      guide,
      dismissed: false,
    })).toBe(true)
    expect(shouldShowServerWelcomeGuide({
      activeServerId: 'server-2',
      activeChannelType: 'text',
      guide,
      dismissed: false,
    })).toBe(false)
    expect(shouldShowServerWelcomeGuide({
      activeServerId: 'server-1',
      activeChannelType: 'voice',
      guide,
      dismissed: false,
    })).toBe(false)
    expect(shouldShowServerWelcomeGuide({
      activeServerId: 'server-1',
      activeChannelType: 'text',
      guide,
      dismissed: true,
    })).toBe(false)
  })

  it('renders official community starter tasks and text/voice channel CTAs', () => {
    const onSelectChannel = vi.fn()

    render(
      <ServerWelcomeGuide
        guide={guide}
        channels={channels}
        serverName="Voxpery"
        onSelectChannel={onSelectChannel}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Welcome to the Voxpery Community' })).toBeInTheDocument()
    expect(screen.getByText('Send your first message in #general')).toBeInTheDocument()
    expect(screen.getByText('Join the General voice channel')).toBeInTheDocument()
    expect(screen.getByText('Explore the open-source project on GitHub')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open channel general' }))
    fireEvent.click(screen.getByRole('button', { name: 'Join voice channel General' }))

    expect(onSelectChannel).toHaveBeenNthCalledWith(1, 'text-1')
    expect(onSelectChannel).toHaveBeenNthCalledWith(2, 'voice-1')
  })
})
