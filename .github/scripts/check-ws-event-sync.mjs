import { readFileSync } from 'node:fs'

// The web client's WebSocket event types are written by hand. This keeps them in step with the
// server's `WsEvent` enum: the same event names, and the same payload field names per event.

const RUST_PATH = 'apps/server/src/ws/mod.rs'
const TS_PATH = 'apps/web/src/types/index.ts'

function blockAfter(text, marker, path) {
  const start = text.indexOf(marker)
  if (start === -1) throw new Error(`${path}: could not find ${marker}`)
  const open = text.indexOf('{', start)
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  throw new Error(`${path}: unterminated ${marker}`)
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** Splits a field list at separators outside nested braces, brackets and generics. */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if ('{[(<'.includes(ch)) depth += 1
    if ('}])>'.includes(ch)) depth -= 1
    if (depth === 0 && (ch === ',' || ch === ';' || ch === '\n')) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts
}

/** Finds `Name { fields }` entries (Rust enum variants or TypeScript interface members). */
function parseEntries(body, separator) {
  const entries = new Map()
  const pattern = new RegExp(`(?:^|[,;\\s])([A-Z][A-Za-z0-9]*)\\s*${separator}\\s*\\{`, 'g')
  let match
  while ((match = pattern.exec(body)) !== null) {
    const open = body.indexOf('{', match.index + match[0].length - 1)
    let depth = 0
    let close = open
    for (let i = open; i < body.length; i += 1) {
      if (body[i] === '{') depth += 1
      if (body[i] === '}') {
        depth -= 1
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    const fields = splitTopLevel(body.slice(open + 1, close).replace(/#\[[^\]]*\]/g, ''))
      .map((part) => /^\s*(?:pub\s+)?([a-z_][a-z0-9_]*)\??\s*:/.exec(part)?.[1])
      .filter(Boolean)
    entries.set(match[1], new Set(fields))
    pattern.lastIndex = close + 1
  }
  return entries
}

const rust = stripComments(readFileSync(RUST_PATH, 'utf8'))
const ts = stripComments(readFileSync(TS_PATH, 'utf8'))
const serverEvents = parseEntries(blockAfter(rust, 'pub enum WsEvent', RUST_PATH), '')
const clientEvents = parseEntries(blockAfter(ts, 'export interface WsEventDataMap', TS_PATH), ':')

const failures = []
if (serverEvents.size === 0) failures.push(`${RUST_PATH}: no WsEvent variants found`)
for (const [name, fields] of serverEvents) {
  const client = clientEvents.get(name)
  if (!client) {
    failures.push(`${name} is sent by the server but missing from WsEventDataMap`)
    continue
  }
  for (const field of fields) {
    if (!client.has(field)) failures.push(`${name}.${field} is sent by the server but missing on the client`)
  }
  for (const field of client) {
    if (!fields.has(field)) failures.push(`${name}.${field} is declared on the client but not sent by the server`)
  }
}
for (const name of clientEvents.keys()) {
  if (!serverEvents.has(name)) failures.push(`${name} is declared on the client but not sent by the server`)
}

if (failures.length > 0) {
  console.error('WebSocket event contract check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`WebSocket event contract check passed (${serverEvents.size} events).`)
