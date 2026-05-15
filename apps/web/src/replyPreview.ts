const REPLY_PREFIX_RE = /^>\s*@[^:]+:\s*/s

function parseReplyEnvelope(content: string): { quote: string; body: string } | null {
  if (!content.startsWith('> @')) return null
  const doubleNewline = content.indexOf('\n\n')
  if (doubleNewline < 0) return null
  const quotePart = content.slice(0, doubleNewline).trim()
  const body = content.slice(doubleNewline + 2).trim()
  const match = quotePart.match(/^>\s*@([^:]+):\s*(.*)$/s)
  if (!match) return null
  return { quote: match[2].trim(), body }
}

export function cleanReplyQuotePreview(content: string): string {
  let text = content.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 8; i += 1) {
    const next = text.replace(REPLY_PREFIX_RE, '').trim()
    if (next === text) break
    text = next
  }
  return text
}

export function createReplyContentSnippet(content: string, maxLength = 80): string {
  let text = content.trim()
  for (let i = 0; i < 8; i += 1) {
    const parsed = parseReplyEnvelope(text)
    if (!parsed) break
    text = parsed.body || parsed.quote
  }

  const normalized = cleanReplyQuotePreview(text)
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}
