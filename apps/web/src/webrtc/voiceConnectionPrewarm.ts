/**
 * Warms up the route to the LiveKit server (DNS, TCP and TLS) when the user is about to join
 * voice, so a join does not pay for that setup. This is the request LiveKit's
 * `Room.prepareConnection` sends to a self-hosted server, without creating a room. The address is
 * learned from the first join of the session; nothing is sent before that.
 */
const PREWARM_INTERVAL_MS = 30_000

let livekitUrl: string | null = null
let lastPrewarmAt = Number.NEGATIVE_INFINITY

function toHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'wss:') parsed.protocol = 'https:'
    else if (parsed.protocol === 'ws:') parsed.protocol = 'http:'
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.origin
  } catch {
    return null
  }
}

export function rememberLivekitUrl(url: string): void {
  livekitUrl = toHttpUrl(url)
}

export function prewarmVoiceConnection(now: number = Date.now()): void {
  if (!livekitUrl || now - lastPrewarmAt < PREWARM_INTERVAL_MS) return
  lastPrewarmAt = now
  void fetch(livekitUrl, { method: 'HEAD', credentials: 'omit', cache: 'no-store' }).catch(() => {
    // Only an optimization: the join connects normally without it.
  })
}
