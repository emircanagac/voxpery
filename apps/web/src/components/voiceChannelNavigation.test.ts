import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../stores/app'
import { joinVoiceChannelFromNavigation } from './voiceChannelNavigation'

type VoiceWindow = Window & { __voxperyJoinVoice?: (channelId: string) => Promise<void> }

afterEach(() => {
  delete (window as VoiceWindow).__voxperyJoinVoice
  useAppStore.setState({ joinedVoiceChannelId: null, joiningVoiceChannelId: null })
})

describe('joinVoiceChannelFromNavigation', () => {
  it('marks the channel as joining until the join settles and ignores a second click meanwhile', async () => {
    let finish: () => void = () => {}
    const join = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    ;(window as VoiceWindow).__voxperyJoinVoice = join

    const first = joinVoiceChannelFromNavigation('voice-1')
    expect(useAppStore.getState().joiningVoiceChannelId).toBe('voice-1')
    await joinVoiceChannelFromNavigation('voice-1')
    await joinVoiceChannelFromNavigation('voice-2')
    expect(join).toHaveBeenCalledTimes(1)

    finish()
    await first
    expect(useAppStore.getState().joiningVoiceChannelId).toBeNull()
  })

  it('clears the joining state when the join fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(window as VoiceWindow).__voxperyJoinVoice = vi.fn(() => Promise.reject(new Error('denied')))
    await joinVoiceChannelFromNavigation('voice-1')
    expect(useAppStore.getState().joiningVoiceChannelId).toBeNull()
  })
})
