export interface VoiceMemberMoveRequest {
  requestId: string
  sourceChannelId: string
  destinationChannelId: string
}

interface VoiceMemberMoveDependencies {
  getJoinedVoiceChannelId: () => string | null
  joinVoice?: (channelId: string) => Promise<void>
  send: (type: string, data: unknown) => void
  onError?: (message: string) => void
}

function acknowledge(
  send: VoiceMemberMoveDependencies['send'],
  requestId: string,
  success: boolean,
  error?: string,
) {
  send('AcknowledgeVoiceMemberMove', {
    request_id: requestId,
    success,
    ...(error ? { error } : {}),
  })
}

export async function handleVoiceMemberMoveRequested(
  request: VoiceMemberMoveRequest,
  dependencies: VoiceMemberMoveDependencies,
): Promise<void> {
  const currentChannelId = dependencies.getJoinedVoiceChannelId()

  // A reconnect can replay a request after the client has already completed it.
  if (currentChannelId === request.destinationChannelId) {
    acknowledge(dependencies.send, request.requestId, true)
    return
  }

  if (currentChannelId !== request.sourceChannelId) {
    const message = 'Your active voice channel changed before the move could complete.'
    acknowledge(dependencies.send, request.requestId, false, message)
    dependencies.onError?.(message)
    return
  }

  if (!dependencies.joinVoice) {
    const message = 'The voice client is not ready to change channels.'
    acknowledge(dependencies.send, request.requestId, false, message)
    dependencies.onError?.(message)
    return
  }

  try {
    await dependencies.joinVoice(request.destinationChannelId)
    if (dependencies.getJoinedVoiceChannelId() !== request.destinationChannelId) {
      throw new Error('The destination voice connection was not established.')
    }
    acknowledge(dependencies.send, request.requestId, true)
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : 'The voice channel move failed.'
    acknowledge(dependencies.send, request.requestId, false, message)
    dependencies.onError?.(message)
  }
}
