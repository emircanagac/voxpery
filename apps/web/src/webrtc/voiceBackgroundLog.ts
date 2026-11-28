/**
 * A short record of what happens to a voice call around the app being in the background:
 * the page hiding and showing, the WebSocket, the LiveKit connection, Web Audio and the
 * microphone. It is kept only in this browser (localStorage, so a reload after the browser
 * dropped the page keeps it), holds event names and times only, and is shown in
 * Settings > Voice & Audio to find out why a call dropped on a phone.
 */

const STORAGE_KEY = 'voxpery-voice-background-log'
const MAX_ENTRIES = 60

export type VoiceBackgroundLogEntry = { at: number; event: string }

let entries: VoiceBackgroundLogEntry[] | null = null
let recording = false
const listeners = new Set<() => void>()
const observedTargets = new WeakSet<object>()

function isEntry(value: unknown): value is VoiceBackgroundLogEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.at === 'number' && Number.isFinite(entry.at) && typeof entry.event === 'string'
}

function load(): VoiceBackgroundLogEntry[] {
  if (entries) return entries
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    entries = Array.isArray(parsed) ? parsed.filter(isEntry).slice(-MAX_ENTRIES) : []
  } catch {
    entries = []
  }
  return entries
}

function save(next: VoiceBackgroundLogEntry[]): void {
  entries = next
  try {
    if (next.length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage can be full or blocked; the log still works for this page.
  }
  listeners.forEach((listener) => listener())
}

/** Starts recording for a call that was just joined; an earlier call's entries are dropped. */
export function startVoiceBackgroundLog(now = Date.now()): void {
  recording = true
  save([{ at: now, event: 'joined voice' }])
}

/** Records the end of the call and stops recording; the entries stay for reading. */
export function stopVoiceBackgroundLog(now = Date.now()): void {
  if (!recording) return
  noteVoiceBackgroundEvent('left voice', now)
  recording = false
}

/** Adds an event while a call is being recorded; does nothing otherwise. */
export function noteVoiceBackgroundEvent(event: string, now = Date.now()): void {
  if (!recording) return
  save([...load(), { at: now, event }].slice(-MAX_ENTRIES))
}

export function getVoiceBackgroundLog(): VoiceBackgroundLogEntry[] {
  return load()
}

export function clearVoiceBackgroundLog(): void {
  save([])
}

export function subscribeVoiceBackgroundLog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** "14:02:11 page hidden", in local time. */
export function formatVoiceBackgroundLogEntry(entry: VoiceBackgroundLogEntry): string {
  const time = new Date(entry.at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())} ${entry.event}`
}

/** Records the microphone being muted by the system, coming back and ending. */
export function observeVoiceMicrophone(track: MediaStreamTrack): void {
  if (typeof track.addEventListener !== 'function' || observedTargets.has(track)) return
  observedTargets.add(track)
  track.addEventListener('mute', () => noteVoiceBackgroundEvent('microphone muted by the system'))
  track.addEventListener('unmute', () => noteVoiceBackgroundEvent('microphone back'))
  track.addEventListener('ended', () => noteVoiceBackgroundEvent('microphone ended'))
}

/** Records Web Audio being suspended, interrupted or resumed. */
export function observeVoiceAudioContext(context: AudioContext): void {
  if (typeof context.addEventListener !== 'function' || observedTargets.has(context)) return
  observedTargets.add(context)
  context.addEventListener('statechange', () => noteVoiceBackgroundEvent(`Web Audio ${context.state}`))
}

/** For tests: forgets the in-memory state. */
export function resetVoiceBackgroundLogForTests(): void {
  entries = null
  recording = false
  listeners.clear()
}
