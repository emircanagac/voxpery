import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Channel, ServerOnboardingGuide } from '../api'
import ServerSettingsOnboarding from './ServerSettingsOnboarding'

const channels: Channel[] = ['text', 'voice'].map((type, position) => ({
  id: type, server_id: 'server', name: 'general', channel_type: type as 'text' | 'voice', position,
}))

describe('ServerSettingsOnboarding', () => {
  it('saves text and voice recommendations and restores their selected state', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const props = { channels, loading: false, saving: false, error: null, onSave }
    const { rerender } = render(<ServerSettingsOnboarding {...props} guide={null} />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Text channel general' }))
    fireEvent.click(screen.getByRole('button', { name: 'Voice channel general' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save guide' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true, recommended_channel_ids: ['text', 'voice'],
    }))
    const guide: ServerOnboardingGuide = {
      server_id: 'server', updated_at: '', ...onSave.mock.calls[0][0],
    }
    rerender(<ServerSettingsOnboarding {...props} guide={guide} />)
    expect(screen.getByRole('button', { name: 'Voice channel general' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Text channel general' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save guide' }))
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ recommended_channel_ids: ['voice'] }))
  })
})
