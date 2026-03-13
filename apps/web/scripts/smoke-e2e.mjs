import { WebSocket } from 'ws'

const API_BASE = process.env.SMOKE_API_URL || 'http://127.0.0.1:3001'
const WS_BASE = API_BASE.replace(/^http/, 'ws')
const REQUIRE_SECURITY_HEADERS = process.env.SMOKE_REQUIRE_SECURITY_HEADERS === '1'

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`${method} ${path} failed (${res.status}): ${errText}`)
  }
  return res.json()
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function checkSecurityHeaders() {
  const res = await fetch(`${API_BASE}/health`)
  if (!res.ok) {
    throw new Error(`GET /health failed (${res.status})`)
  }

  const header = (name) => (res.headers.get(name) || '').trim()
  const csp = header('content-security-policy')
  const xFrameOptions = header('x-frame-options').toUpperCase()
  const xContentType = header('x-content-type-options').toLowerCase()
  const referrerPolicy = header('referrer-policy').toLowerCase()

  const missing = []
  if (!csp || !csp.toLowerCase().includes('default-src')) missing.push('content-security-policy')
  if (xFrameOptions !== 'DENY') missing.push('x-frame-options=DENY')
  if (xContentType !== 'nosniff') missing.push('x-content-type-options=nosniff')
  if (!referrerPolicy) missing.push('referrer-policy')

  if (missing.length > 0) {
    const msg = `[smoke] security headers missing/invalid: ${missing.join(', ')}`
    if (REQUIRE_SECURITY_HEADERS) {
      throw new Error(msg)
    }
    console.warn(`${msg} (non-strict mode)`)
    return
  }

  console.log('[smoke] security headers OK')
}

function randomIdentity() {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  return {
    username: `smoke_${suffix}`,
    email: `smoke_${suffix}@voxpery.dev`,
    password: 'smoke-test-password-123',
  }
}

async function waitForEvent(events, predicate, label, ms = 8000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const found = events.find(predicate)
    if (found) return found
    await timeout(80)
  }
  throw new Error(`Timed out waiting for: ${label}`)
}

async function openWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(token)}`)
    const events = []
    const onError = (err) => reject(err)
    ws.on('error', onError)
    ws.on('open', () => {
      ws.off('error', onError)
      ws.on('message', (raw) => {
        try {
          const json = JSON.parse(String(raw))
          events.push(json)
        } catch {
          // ignore non-json
        }
      })
      resolve({ ws, events })
    })
  })
}

function wsSend(ws, type, data) {
  ws.send(JSON.stringify({ type, data }))
}

async function main() {
  console.log(`[smoke] API: ${API_BASE}`)
  console.log(`[smoke] require security headers: ${REQUIRE_SECURITY_HEADERS ? 'yes' : 'no'}`)
  await checkSecurityHeaders()
  const creds = randomIdentity()

  console.log('[smoke] register')
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: creds,
  })
  assert(reg?.token, 'register token missing')
  assert(reg?.user?.id, 'register user missing')
  const token = reg.token
  const userId = reg.user.id

  console.log('[smoke] list servers')
  const servers = await api('/api/servers', { token })
  assert(Array.isArray(servers) && servers.length > 0, 'no servers found after register')
  const server = servers.find((s) => s.invite_code === 'voxpery') || servers[0]
  assert(server?.id, 'failed to resolve target server')

  console.log('[smoke] list channels')
  const channels = await api(`/api/servers/${server.id}/channels`, { token })
  const textChannel = channels.find((c) => c.channel_type === 'text')
  const voiceChannel = channels.find((c) => c.channel_type === 'voice')
  assert(textChannel?.id, 'missing text channel')
  assert(voiceChannel?.id, 'missing voice channel')

  console.log('[smoke] send message')
  const content = `smoke message ${Date.now()}`
  const sent = await api(`/api/messages/${textChannel.id}`, {
    method: 'POST',
    token,
    body: { content, attachments: [] },
  })
  assert(sent?.id, 'message id missing')
  assert(sent?.content === content, 'message content mismatch')

  console.log('[smoke] open websocket')
  const { ws, events } = await openWs(token)
  wsSend(ws, 'Subscribe', { channel_ids: [textChannel.id, voiceChannel.id] })

  console.log('[smoke] join voice')
  wsSend(ws, 'JoinVoice', { channel_id: voiceChannel.id })
  await waitForEvent(
    events,
    (e) => e?.type === 'VoiceStateUpdate' && e?.data?.user_id === userId && e?.data?.channel_id === voiceChannel.id,
    'VoiceStateUpdate join'
  )

  console.log('[smoke] set voice control (screen sharing on)')
  wsSend(ws, 'SetVoiceControl', { muted: false, deafened: false, screen_sharing: true })
  await waitForEvent(
    events,
    (e) =>
      e?.type === 'VoiceControlUpdate' &&
      e?.data?.user_id === userId &&
      e?.data?.screen_sharing === true,
    'VoiceControlUpdate screen_sharing=true'
  )

  console.log('[smoke] leave voice')
  wsSend(ws, 'LeaveVoice', null)
  await waitForEvent(
    events,
    (e) => e?.type === 'VoiceStateUpdate' && e?.data?.user_id === userId && e?.data?.channel_id == null,
    'VoiceStateUpdate leave'
  )

  ws.close()
  console.log('[smoke] OK')
}

main().catch((err) => {
  console.error('[smoke] FAILED')
  console.error(err)
  process.exit(1)
})
