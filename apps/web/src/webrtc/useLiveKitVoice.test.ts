import { describe, expect, it, vi } from 'vitest'
import { resyncVoiceStateAfterReconnect } from './useLiveKitVoice'

describe('resyncVoiceStateAfterReconnect', () => {
  it('re-sends voice join and control state after WebSocket reconnect', () => {
    const send = vi.fn()

    resyncVoiceStateAfterReconnect({
      channelId: 'voice-channel-1',
      roomState: 'connected',
      control: {
        muted: true,
        deafened: false,
        screenSharing: true,
        cameraOn: true,
      },
      send,
    })

    expect(send).toHaveBeenNthCalledWith(1, 'JoinVoice', {
      channel_id: 'voice-channel-1',
    })
    expect(send).toHaveBeenNthCalledWith(2, 'SetVoiceControl', {
      muted: true,
      deafened: false,
      screen_sharing: true,
      camera_on: true,
    })
  })

  it('defaults missing voice controls to false', () => {
    const send = vi.fn()

    resyncVoiceStateAfterReconnect({
      channelId: 'voice-channel-1',
      roomState: 'connected',
      control: null,
      send,
    })

    expect(send).toHaveBeenNthCalledWith(2, 'SetVoiceControl', {
      muted: false,
      deafened: false,
      screen_sharing: false,
      camera_on: false,
    })
  })

  it('does not resync when no voice channel is joined', () => {
    const send = vi.fn()

    resyncVoiceStateAfterReconnect({
      channelId: null,
      roomState: 'connected',
      control: null,
      send,
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('does not resync when the media room is gone', () => {
    const send = vi.fn()

    resyncVoiceStateAfterReconnect({
      channelId: 'voice-channel-1',
      roomState: null,
      control: null,
      send,
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('does not resync when the media room is disconnected', () => {
    const send = vi.fn()

    resyncVoiceStateAfterReconnect({
      channelId: 'voice-channel-1',
      roomState: 'disconnected',
      control: null,
      send,
    })

    expect(send).not.toHaveBeenCalled()
  })
})
