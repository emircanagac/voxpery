import { describe, expect, it, vi } from 'vitest'
import { handleVoiceMemberMoveRequested } from './voiceMemberMove'

const request = {
  requestId: 'request-1',
  sourceChannelId: 'voice-1',
  destinationChannelId: 'voice-2',
}

describe('handleVoiceMemberMoveRequested', () => {
  it('acknowledges only after the destination connection is established', async () => {
    let joinedChannelId: string | null = 'voice-1'
    const send = vi.fn()
    const joinVoice = vi.fn(async (channelId: string) => {
      joinedChannelId = channelId
    })

    await handleVoiceMemberMoveRequested(request, {
      getJoinedVoiceChannelId: () => joinedChannelId,
      joinVoice,
      send,
    })

    expect(joinVoice).toHaveBeenCalledWith('voice-2')
    expect(send).toHaveBeenCalledWith('AcknowledgeVoiceMemberMove', {
      request_id: 'request-1',
      success: true,
    })
  })

  it('reports a failed destination connection', async () => {
    const send = vi.fn()
    const onError = vi.fn()

    await handleVoiceMemberMoveRequested(request, {
      getJoinedVoiceChannelId: () => 'voice-1',
      joinVoice: vi.fn().mockRejectedValue(new Error('LiveKit join failed')),
      send,
      onError,
    })

    expect(send).toHaveBeenCalledWith('AcknowledgeVoiceMemberMove', {
      request_id: 'request-1',
      success: false,
      error: 'LiveKit join failed',
    })
    expect(onError).toHaveBeenCalledWith('LiveKit join failed')
  })

  it('rejects a stale request after the user changed channels', async () => {
    const send = vi.fn()

    await handleVoiceMemberMoveRequested(request, {
      getJoinedVoiceChannelId: () => 'voice-3',
      joinVoice: vi.fn(),
      send,
    })

    expect(send).toHaveBeenCalledWith('AcknowledgeVoiceMemberMove', expect.objectContaining({
      request_id: 'request-1',
      success: false,
    }))
  })

  it('acknowledges a replay when already connected to the destination', async () => {
    const send = vi.fn()
    const joinVoice = vi.fn()

    await handleVoiceMemberMoveRequested(request, {
      getJoinedVoiceChannelId: () => 'voice-2',
      joinVoice,
      send,
    })

    expect(joinVoice).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('AcknowledgeVoiceMemberMove', {
      request_id: 'request-1',
      success: true,
    })
  })
})
