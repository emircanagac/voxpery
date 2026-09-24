export const MESSAGE_MAX_CHARACTERS = 4000

export function countMessageCharacters(value: string): number {
  return Array.from(value).length
}

export function truncateMessage(value: string, limit: number): string {
  return Array.from(value).slice(0, Math.max(0, limit)).join('')
}

export function replyPrefix(reply: { username: string; contentSnippet: string } | null | undefined): string {
  return reply ? `> @${reply.username}: ${reply.contentSnippet}\n\n` : ''
}

export function messageBodyLimit(reply: { username: string; contentSnippet: string } | null | undefined): number {
  return Math.max(0, MESSAGE_MAX_CHARACTERS - countMessageCharacters(replyPrefix(reply)))
}
