import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useSocketStore } from './stores/socket'
import type { WsEvent } from './types'

/** The server relays at most one start per channel and connection every 3 seconds. */
export const TYPING_SEND_INTERVAL_MS = 3000
/** Without a keystroke for this long, the sender says it stopped. */
export const TYPING_IDLE_STOP_MS = 5000
/** A start that is not renewed shows for this long, so a lost stop cannot leave it behind. */
export const TYPING_DISPLAY_MS = 6000

interface Typer {
  username: string
  expiresAt: number
}

interface TypingState {
  /** channel id -> user id -> who is typing until when */
  byChannel: Record<string, Record<string, Typer>>
  setTyping: (channelId: string, userId: string, username: string | null, now: number) => void
}

export const useTypingStore = create<TypingState>((set) => ({
  byChannel: {},
  setTyping: (channelId, userId, username, now) => set((state) => {
    const current = { ...(state.byChannel[channelId] ?? {}) }
    if (username === null) {
      if (!current[userId]) return state
      delete current[userId]
    } else {
      current[userId] = { username, expiresAt: now + TYPING_DISPLAY_MS }
    }
    return { byChannel: { ...state.byChannel, [channelId]: current } }
  }),
}))

/** Applies a socket event: `Typing` starts or stops, and a sent message ends its author's typing. */
export function applyTypingEvent(event: WsEvent, now = Date.now()): void {
  const { setTyping } = useTypingStore.getState()
  if (event.type === 'Typing') {
    const { channel_id: channelId, user_id: userId, username, is_typing: isTyping } = event.data
    setTyping(channelId, userId, isTyping ? username : null, now)
  } else if (event.type === 'NewMessage') {
    const channelId = event.data.channel_id
    const authorId = event.data.message?.author?.user_id
    if (channelId && authorId) setTyping(channelId, authorId, null, now)
  }
}

let listenerUsers = 0
let stopListening: (() => void) | null = null

/** Keeps one socket listener while any conversation shows typing. */
function retainTypingListener(): () => void {
  listenerUsers += 1
  if (!stopListening) stopListening = useSocketStore.getState().subscribe((event) => applyTypingEvent(event))
  return () => {
    listenerUsers -= 1
    if (listenerUsers === 0) {
      stopListening?.()
      stopListening = null
    }
  }
}

/** "Ada is typing…", "Ada and Ben are typing…", or "Several people are typing…". */
export function typingLabel(names: string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return 'Several people are typing…'
}

export function activeTypers(
  typers: Record<string, Typer> | undefined,
  selfId: string | null | undefined,
  now: number,
): string[] {
  return Object.entries(typers ?? {})
    .filter(([userId, typer]) => userId !== selfId && typer.expiresAt > now)
    .map(([, typer]) => typer.username)
}

type Send = (channelId: string, isTyping: boolean) => void

/**
 * Decides when this client says it is typing in one conversation: a start at most every
 * {@link TYPING_SEND_INTERVAL_MS} while the draft has text, a stop after {@link TYPING_IDLE_STOP_MS}
 * without input, when the draft empties, when the message is sent, or when the conversation changes.
 */
export function createTypingSender(send: Send, now: () => number = Date.now) {
  let channelId: string | null = null
  let lastStartAt = Number.NEGATIVE_INFINITY
  let started = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  }
  const stop = () => {
    clearIdle()
    if (started && channelId) send(channelId, false)
    started = false
    lastStartAt = Number.NEGATIVE_INFINITY
  }

  return {
    setChannel(next: string | null) {
      if (next === channelId) return
      stop()
      channelId = next
    },
    draftChanged(text: string) {
      if (!channelId) return
      if (!text.trim()) {
        stop()
        return
      }
      const at = now()
      if (!started || at - lastStartAt >= TYPING_SEND_INTERVAL_MS) {
        send(channelId, true)
        started = true
        lastStartAt = at
      }
      clearIdle()
      idleTimer = setTimeout(stop, TYPING_IDLE_STOP_MS)
    },
    sent: stop,
    dispose: stop,
  }
}

/** Typing for one conversation: the label to show and the calls the composer makes. */
export function useTypingIndicator(channelId: string | null | undefined, selfId: string | null | undefined) {
  const typers = useTypingStore((state) => (channelId ? state.byChannel[channelId] : undefined))
  const [now, setNow] = useState(() => Date.now())
  const senderRef = useRef<ReturnType<typeof createTypingSender> | null>(null)
  if (!senderRef.current) {
    senderRef.current = createTypingSender((id, isTyping) => {
      useSocketStore.getState().send('Typing', { channel_id: id, is_typing: isTyping })
    })
  }

  useEffect(() => retainTypingListener(), [])

  useEffect(() => {
    senderRef.current?.setChannel(channelId ?? null)
  }, [channelId])

  useEffect(() => () => senderRef.current?.dispose(), [])

  const names = activeTypers(typers, selfId, now)
  // Redraw once the next shown entry expires, so a lost stop does not leave it behind.
  const nextExpiry = Object.values(typers ?? {})
    .map((typer) => typer.expiresAt)
    .filter((expiresAt) => expiresAt > now)
    .sort((a, b) => a - b)[0]
  useEffect(() => {
    if (!nextExpiry) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()) + 50)
    return () => clearTimeout(timer)
  }, [nextExpiry])
  // A new entry is judged against the current time, not the last redraw's.
  useEffect(() => {
    setNow(Date.now())
  }, [typers])

  const draftChanged = useCallback((text: string) => senderRef.current?.draftChanged(text), [])
  const sent = useCallback(() => senderRef.current?.sent(), [])

  return { label: typingLabel(names), draftChanged, sent }
}
