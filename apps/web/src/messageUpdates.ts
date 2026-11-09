import type { MessageWithAuthor } from './api'

/**
 * Applies a `MessageUpdated` event to a message this client already has.
 *
 * The server computes each reaction's `reacted` flag for the user who made the change
 * (`viewerId`) and sends the same payload to every recipient. That user's own sessions take the
 * flags as sent; everyone else keeps their own flags, so another member's reaction or edit never
 * marks or clears their reactions. An emoji this client has not seen yet starts unreacted.
 */
export function applyMessageUpdate<T extends MessageWithAuthor>(
  existing: T,
  incoming: MessageWithAuthor,
  viewerId: string | undefined,
  currentUserId: string | undefined,
): T {
  if (viewerId && currentUserId && viewerId === currentUserId) {
    return { ...existing, ...incoming }
  }
  const ownReactions = new Map((existing.reactions ?? []).map((reaction) => [reaction.emoji, reaction.reacted]))
  return {
    ...existing,
    ...incoming,
    reactions: incoming.reactions?.map((reaction) => ({
      ...reaction,
      reacted: ownReactions.get(reaction.emoji) ?? false,
    })),
  }
}
