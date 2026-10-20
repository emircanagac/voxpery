/**
 * Minimal, HTML-free message formatting: ```code blocks```, `inline code`, **bold**, *italic* /
 * _italic_ and ~~strikethrough~~. The parser returns a node tree that the chat renders with React
 * elements, so user text is never inserted as HTML. Links and @mentions are protected first, so
 * underscores or asterisks inside them never start formatting.
 */
export type MarkdownNode =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'codeBlock'; text: string }
  | { type: 'bold' | 'italic' | 'strike'; children: MarkdownNode[] }

const CODE_BLOCK = /```(?:[\w+-]*\n)?([\s\S]*?)```/g
const INLINE_CODE = /`([^`\n]+)`/g
const PROTECTED = /https?:\/\/[^\s]+|@[^\s@]{2,32}/g
const PLACEHOLDER_START = 0xe000
const MAX_DEPTH = 4

const EMPHASIS: { type: 'bold' | 'italic' | 'strike'; pattern: RegExp }[] = [
  { type: 'bold', pattern: /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/ },
  { type: 'strike', pattern: /~~(?=\S)([\s\S]+?)(?<=\S)~~/ },
  { type: 'italic', pattern: /(?<!\*)\*(?=[^\s*])([^*\n]+?)(?<=\S)\*(?!\*)/ },
  { type: 'italic', pattern: /(?<![\p{L}\p{N}_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\p{L}\p{N}_])/u },
]

function pushText(nodes: MarkdownNode[], text: string) {
  if (!text) return
  const last = nodes.at(-1)
  if (last?.type === 'text') last.text += text
  else nodes.push({ type: 'text', text })
}

function restore(text: string, protectedParts: string[]): string {
  return text.replace(/[\ue000-\uf8ff]/g, char => protectedParts[char.charCodeAt(0) - PLACEHOLDER_START] ?? char)
}

function parseEmphasis(text: string, protectedParts: string[], depth: number): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  let rest = text
  while (rest) {
    let best: { type: 'bold' | 'italic' | 'strike'; match: RegExpExecArray } | null = null
    if (depth < MAX_DEPTH) {
      for (const { type, pattern } of EMPHASIS) {
        const match = pattern.exec(rest)
        if (match && (!best || match.index < best.match.index)) best = { type, match }
      }
    }
    if (!best) {
      pushText(nodes, restore(rest, protectedParts))
      break
    }
    pushText(nodes, restore(rest.slice(0, best.match.index), protectedParts))
    nodes.push({ type: best.type, children: parseEmphasis(best.match[1], protectedParts, depth + 1) })
    rest = rest.slice(best.match.index + best.match[0].length)
  }
  return nodes
}

function parseInline(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE_CODE)) {
    nodes.push(...parseFormattedText(text.slice(last, match.index)))
    nodes.push({ type: 'code', text: match[1] })
    last = match.index + match[0].length
  }
  nodes.push(...parseFormattedText(text.slice(last)))
  return nodes
}

function parseFormattedText(text: string): MarkdownNode[] {
  if (!text) return []
  // Placeholders use the private-use range; text that already contains it is shown as typed.
  if (/[\ue000-\uf8ff]/.test(text)) return [{ type: 'text', text }]
  const protectedParts: string[] = []
  const masked = text.replace(PROTECTED, part => {
    protectedParts.push(part)
    return String.fromCharCode(PLACEHOLDER_START + protectedParts.length - 1)
  })
  if (protectedParts.length > 0x18ff) return [{ type: 'text', text }]
  return parseEmphasis(masked, protectedParts, 0)
}

export function parseMessageMarkdown(content: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  let last = 0
  for (const match of content.matchAll(CODE_BLOCK)) {
    for (const node of parseInline(content.slice(last, match.index))) {
      if (node.type === 'text') pushText(nodes, node.text)
      else nodes.push(node)
    }
    nodes.push({ type: 'codeBlock', text: match[1].replace(/\n$/, '') })
    last = match.index + match[0].length
  }
  for (const node of parseInline(content.slice(last))) {
    if (node.type === 'text') pushText(nodes, node.text)
    else nodes.push(node)
  }
  return nodes
}
