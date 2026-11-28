/**
 * How long the app took to start, step by step, measured from the page's navigation start.
 * The desktop app shows the last result in Settings and both clients log it once, so a slow
 * start on one machine can be compared with the web app for the same account.
 */

export type StartupStep = 'keyring' | 'session' | 'shell' | 'servers' | 'channels' | 'firstMessages'

const STEP_LABELS: Record<StartupStep, string> = {
  keyring: 'saved sign-in read',
  session: 'session checked',
  shell: 'app shown',
  servers: 'server list',
  channels: 'first channel list',
  firstMessages: 'first messages',
}

const LAST_STARTUP_KEY = 'voxpery-last-startup'
/** Requests after this point are not part of starting the app. */
const FINISH_STEP: StartupStep = 'firstMessages'
/** A start that never shows messages (no server, or signed out) is closed after this long. */
const GIVE_UP_MS = 60_000

const marks = new Map<StartupStep, number>()
let requestCount = 0
let finished = false

function now(): number {
  return typeof performance === 'undefined' ? 0 : Math.round(performance.now())
}

export interface StartupReport {
  totalMs: number
  requests: number
  steps: Array<{ step: StartupStep; label: string; atMs: number }>
}

function report(): StartupReport {
  const steps = [...marks.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([step, atMs]) => ({ step, label: STEP_LABELS[step], atMs }))
  return { totalMs: steps.at(-1)?.atMs ?? 0, requests: requestCount, steps }
}

function finish(): void {
  if (finished) return
  finished = true
  const result = report()
  try {
    localStorage.setItem(LAST_STARTUP_KEY, JSON.stringify(result))
  } catch {
    // Without storage the result is still logged.
  }
  console.info(`[startup] ${formatStartupReport(result)}`)
}

/** Records the first time a startup step completes. */
export function markStartup(step: StartupStep): void {
  if (finished || marks.has(step)) return
  marks.set(step, now())
  if (step === FINISH_STEP) finish()
}

/** Counts an API request made while the app is starting; the first list responses mark steps. */
export function noteStartupRequest(path: string): void {
  if (finished) return
  if (now() > GIVE_UP_MS) {
    finish()
    return
  }
  requestCount += 1
  if (path === '/api/servers') markStartup('servers')
  else if (path.startsWith('/api/channels/server/') || /^\/api\/servers\/[^/]+$/.test(path)) markStartup('channels')
}

export function formatStartupReport(result: StartupReport): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`
  const steps = result.steps.map((step) => `${step.label} ${seconds(step.atMs)}`).join(', ')
  return `${seconds(result.totalMs)} in total, ${result.requests} requests (${steps})`
}

/** The last completed start on this device, or null. */
export function getLastStartupReport(): StartupReport | null {
  try {
    const raw = localStorage.getItem(LAST_STARTUP_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StartupReport
    return Array.isArray(parsed?.steps) && typeof parsed.totalMs === 'number' ? parsed : null
  } catch {
    return null
  }
}

/** Test helper: forget the current start. */
export function resetStartupTimingForTests(): void {
  marks.clear()
  requestCount = 0
  finished = false
}
