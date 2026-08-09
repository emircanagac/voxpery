export type MessageDraftScope = 'channel' | 'dm'

export const MESSAGE_DRAFT_STORAGE_KEY = 'voxpery-message-drafts-v1'
export const MESSAGE_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MESSAGE_DRAFT_MAX_ENTRIES = 80
export const MESSAGE_DRAFT_MAX_LENGTH = 4000

type MessageDraftEntry = {
  userId: string
  scope: MessageDraftScope
  conversationId: string
  text: string
  updatedAt: number
}

type MessageDraftStore = {
  version: 1
  entries: Record<string, MessageDraftEntry>
}

let cachedStore: MessageDraftStore | null = null
let flushTimer: ReturnType<typeof window.setTimeout> | null = null
let listenersInstalled = false

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function draftKey(userId: string, scope: MessageDraftScope, conversationId: string): string {
  return JSON.stringify([userId, scope, conversationId])
}

function emptyStore(): MessageDraftStore {
  return { version: 1, entries: {} }
}

function validEntry(value: unknown): value is MessageDraftEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<MessageDraftEntry>
  return (
    typeof entry.userId === 'string'
    && typeof entry.scope === 'string'
    && (entry.scope === 'channel' || entry.scope === 'dm')
    && typeof entry.conversationId === 'string'
    && typeof entry.text === 'string'
    && typeof entry.updatedAt === 'number'
    && Number.isFinite(entry.updatedAt)
  )
}

function pruneStore(store: MessageDraftStore, now: number): MessageDraftStore {
  const freshEntries = Object.entries(store.entries)
    .filter(([, entry]) => (
      validEntry(entry)
      && entry.text.trim().length > 0
      && entry.updatedAt > now - MESSAGE_DRAFT_TTL_MS
    ))
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, MESSAGE_DRAFT_MAX_ENTRIES)

  return {
    version: 1,
    entries: Object.fromEntries(freshEntries),
  }
}

function loadStore(now = Date.now()): MessageDraftStore {
  if (cachedStore) {
    cachedStore = pruneStore(cachedStore, now)
    return cachedStore
  }
  if (!storageAvailable()) {
    cachedStore = emptyStore()
    return cachedStore
  }

  try {
    const raw = window.localStorage.getItem(MESSAGE_DRAFT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as Partial<MessageDraftStore> : null
    cachedStore = parsed?.version === 1 && parsed.entries && typeof parsed.entries === 'object'
      ? pruneStore({ version: 1, entries: parsed.entries as Record<string, MessageDraftEntry> }, now)
      : emptyStore()
  } catch {
    cachedStore = emptyStore()
  }
  return cachedStore
}

function installFlushListeners(): void {
  if (!storageAvailable() || listenersInstalled) return
  listenersInstalled = true
  window.addEventListener('pagehide', flushMessageDrafts)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushMessageDrafts()
  })
  window.addEventListener('storage', (event) => {
    if (event.key === MESSAGE_DRAFT_STORAGE_KEY && !flushTimer) cachedStore = null
  })
}

function scheduleFlush(): void {
  if (!storageAvailable()) return
  installFlushListeners()
  if (flushTimer) window.clearTimeout(flushTimer)
  flushTimer = window.setTimeout(flushMessageDrafts, 250)
}

export function flushMessageDrafts(): void {
  if (flushTimer) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!storageAvailable() || !cachedStore) return
  try {
    window.localStorage.setItem(
      MESSAGE_DRAFT_STORAGE_KEY,
      JSON.stringify(pruneStore(cachedStore, Date.now())),
    )
  } catch {
    // Draft persistence is best-effort and must never block chat input.
  }
}

export function readMessageDraft(
  userId: string | null | undefined,
  scope: MessageDraftScope,
  conversationId: string | null | undefined,
  now = Date.now(),
): string {
  if (!userId || !conversationId) return ''
  return loadStore(now).entries[draftKey(userId, scope, conversationId)]?.text ?? ''
}

export function saveMessageDraft(
  userId: string | null | undefined,
  scope: MessageDraftScope,
  conversationId: string | null | undefined,
  text: string,
  now = Date.now(),
): void {
  if (!userId || !conversationId) return
  const store = loadStore(now)
  const key = draftKey(userId, scope, conversationId)
  const boundedText = text.slice(0, MESSAGE_DRAFT_MAX_LENGTH)
  if (!boundedText.trim()) {
    delete store.entries[key]
  } else {
    store.entries[key] = {
      userId,
      scope,
      conversationId,
      text: boundedText,
      updatedAt: now,
    }
  }
  cachedStore = pruneStore(store, now)
  scheduleFlush()
}

export function clearMessageDraftIfUnchanged(
  userId: string | null | undefined,
  scope: MessageDraftScope,
  conversationId: string | null | undefined,
  expectedText: string,
): void {
  if (!userId || !conversationId) return
  const store = loadStore()
  const key = draftKey(userId, scope, conversationId)
  if (store.entries[key]?.text !== expectedText.slice(0, MESSAGE_DRAFT_MAX_LENGTH)) return
  delete store.entries[key]
  flushMessageDrafts()
}

export function resetMessageDraftCacheForTests(): void {
  if (flushTimer && typeof window !== 'undefined') window.clearTimeout(flushTimer)
  flushTimer = null
  cachedStore = null
}
