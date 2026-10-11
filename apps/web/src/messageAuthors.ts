import type { Message } from './types'

/** Public profile fields carried by `UserUpdated` events. */
export type AuthorProfileUpdate = {
  id: string
  username?: string
  avatar_url?: string | null
}

type AuthoredMessage = Pick<Message, 'author'>

/**
 * Applies a user's new name and avatar to the author of their messages. Returns the same
 * array when nothing changes, so unchanged conversations do not re-render. Attachments and
 * other message content are left untouched.
 */
export function withUpdatedAuthor<T extends AuthoredMessage>(messages: T[], profile: AuthorProfileUpdate): T[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.author?.user_id !== profile.id) return message
    const username = profile.username ?? message.author.username
    // A removed photo arrives as null; messages store a missing avatar as undefined.
    const avatarUrl = profile.avatar_url ?? undefined
    if (message.author.username === username && message.author.avatar_url === avatarUrl) return message
    changed = true
    return { ...message, author: { ...message.author, username, avatar_url: avatarUrl } }
  })
  return changed ? next : messages
}

/**
 * Gives cached older messages the author details from a freshly loaded page, so history kept
 * from before a profile change does not show the old name or avatar next to new messages.
 */
export function withAuthorsFrom<T extends AuthoredMessage>(messages: T[], fresh: AuthoredMessage[]): T[] {
  const authors = new Map<string, Message['author']>()
  fresh.forEach((message) => {
    if (message.author?.user_id) authors.set(message.author.user_id, message.author)
  })
  if (authors.size === 0) return messages
  let changed = false
  const next = messages.map((message) => {
    const author = message.author?.user_id ? authors.get(message.author.user_id) : undefined
    if (!author || (author.username === message.author.username
      && author.avatar_url === message.author.avatar_url
      && author.role_color === message.author.role_color)) return message
    changed = true
    return { ...message, author: { ...message.author, ...author } }
  })
  return changed ? next : messages
}
