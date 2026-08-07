import { effectiveApiBase, shouldUseTauriHttpPluginForApiBase } from './api/client'
import { isTauri } from './secureStorage'

export const OBSERVABILITY_EVENT_CODES = [
  'frontend_session_started',
  'frontend_crash',
  'desktop_oauth_return_received',
  'desktop_oauth_return_succeeded',
  'desktop_oauth_return_failed',
  'desktop_oauth_setup_failed',
  'websocket_reconnect_started',
  'websocket_reconnect_succeeded',
  'websocket_reconnect_exhausted',
  'voice_join_started',
  'voice_join_succeeded',
  'voice_join_failed',
  'livekit_reconnect_started',
  'livekit_reconnect_succeeded',
  'livekit_disconnected',
  'media_microphone_started',
  'media_microphone_failed',
  'media_camera_started',
  'media_camera_failed',
  'media_screen_share_started',
  'media_screen_share_failed',
] as const

export type ObservabilityEventCode = (typeof OBSERVABILITY_EVENT_CODES)[number]

const MAX_PENDING_EVENTS = 24
const OBSERVABILITY_PATH = '/api/system/observability/events'
const eventCodeSet = new Set<string>(OBSERVABILITY_EVENT_CODES)

type DeliveryMode = 'pending' | 'enabled' | 'disabled'

let deliveryMode: DeliveryMode = 'pending'
let pendingEvents: ObservabilityEventCode[] = []
let sessionStarted = false
let crashReported = false
let globalHandlersInstalled = false

export function isObservabilityEventCode(value: unknown): value is ObservabilityEventCode {
  return typeof value === 'string' && eventCodeSet.has(value)
}

async function deliverEvent(event: ObservabilityEventCode): Promise<void> {
  const apiBase = effectiveApiBase()
  const url = `${apiBase}${OBSERVABILITY_PATH}`
  const body = JSON.stringify({
    event,
    client: isTauri() ? 'desktop' : 'web',
  })

  if (shouldUseTauriHttpPluginForApiBase(isTauri(), apiBase)) {
    const mod = await import('@tauri-apps/plugin-http')
    await mod.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'omit',
      timeout: 10,
    } as RequestInit & { timeout?: number })
    return
  }

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    credentials: 'omit',
    keepalive: true,
  })
}

function dispatchEvent(event: ObservabilityEventCode): void {
  void deliverEvent(event).catch(() => {
    // Observability is best-effort and must never affect product behavior.
  })
}

export function reportObservabilityEvent(event: ObservabilityEventCode): void {
  if (!isObservabilityEventCode(event) || deliveryMode === 'disabled') return
  if (deliveryMode === 'enabled') {
    dispatchEvent(event)
    return
  }
  if (pendingEvents.length < MAX_PENDING_EVENTS) pendingEvents.push(event)
}

export function configureObservability(enabled: boolean): void {
  deliveryMode = enabled ? 'enabled' : 'disabled'
  if (!enabled) {
    pendingEvents = []
    return
  }

  if (!sessionStarted) {
    sessionStarted = true
    pendingEvents.unshift('frontend_session_started')
  }
  const queued = pendingEvents
  pendingEvents = []
  queued.forEach(dispatchEvent)
}

export function reportFrontendCrash(): void {
  if (crashReported) return
  crashReported = true
  reportObservabilityEvent('frontend_crash')
}

export function installGlobalObservabilityHandlers(): void {
  if (globalHandlersInstalled || typeof window === 'undefined') return
  globalHandlersInstalled = true
  window.addEventListener('error', reportFrontendCrash)
  window.addEventListener('unhandledrejection', reportFrontendCrash)
}

export function resetObservabilityForTests(): void {
  deliveryMode = 'pending'
  pendingEvents = []
  sessionStarted = false
  crashReported = false
}
