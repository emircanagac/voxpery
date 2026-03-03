import { WebSocket } from 'ws'

const API_BASE = process.env.SMOKE_API_URL || 'http://127.0.0.1:3001'
const WS_BASE = API_BASE.replace(/^http/, 'ws')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

function randomIdentity(prefix) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  return {
    username: `${prefix}_${suffix}`,
    email: `${prefix}_${suffix}@voxpery.dev`,
    password: 'smoke-test-password-123',
  }
}

async function waitForEvent(events, predicate, label, ms = 10000) {
  const started = Date.now()
  while (Date.now() - started < ms) {
    const event = events.find(predicate)
    if (event) return event
    await sleep(70)
  }
  throw new Error(`Timed out waiting for ${label}`)
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
          events.push(JSON.parse(String(raw)))
        } catch {
          // ignore
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
  console.log(`[chaos] API: ${API_BASE}`)

  // 1) Register two users
  const aCreds = randomIdentity('chaos_a')
  const bCreds = randomIdentity('chaos_b')
  const aReg = await api('/api/auth/register', { method: 'POST', body: aCreds })
  const bReg = await api('/api/auth/register', { method: 'POST', body: bCreds })
  const aToken = aReg.token
  const bToken = bReg.token
  const aUserId = aReg.user.id

  // 2) Resolve common voice channel (default voxpery)
  const bServers = await api('/api/servers', { token: bToken })
  const server = bServers.find((s) => s.invite_code === 'voxpery') || bServers[0]
  assert(server?.id, 'Failed to resolve server for reconnect chaos')
  const channels = await api(`/api/servers/${server.id}/channels`, { token: bToken })
  const voice = channels.find((c) => c.channel_type === 'voice')
  const text = channels.find((c) => c.channel_type === 'text')
  assert(voice?.id, 'Voice channel not found')
  assert(text?.id, 'Text channel not found')

  // 3) Open WS for both users and subscribe
  const a = await openWs(aToken)
  const b = await openWs(bToken)
  wsSend(a.ws, 'Subscribe', { channel_ids: [voice.id, text.id] })
  wsSend(b.ws, 'Subscribe', { channel_ids: [voice.id, text.id] })

  // 4) Both join voice; user A starts "screen share" flag
  wsSend(a.ws, 'JoinVoice', { channel_id: voice.id })
  wsSend(b.ws, 'JoinVoice', { channel_id: voice.id })
  await waitForEvent(
    b.events,
    (e) => e?.type === 'VoiceStateUpdate' && e?.data?.user_id === aUserId && e?.data?.channel_id === voice.id,
    'B sees A in voice'
  )

  wsSend(a.ws, 'SetVoiceControl', { muted: false, deafened: false, screen_sharing: true })
  await waitForEvent(
    b.events,
    (e) => e?.type === 'VoiceControlUpdate' && e?.data?.user_id === aUserId && e?.data?.screen_sharing === true,
    'B sees A screen_sharing=true'
  )

  // 5) Chaos: disconnect B abruptly, then reconnect B and verify state recovery
  b.ws.terminate()
  await sleep(300)
  const b2 = await openWs(bToken)
  wsSend(b2.ws, 'Subscribe', { channel_ids: [voice.id, text.id] })
  wsSend(b2.ws, 'JoinVoice', { channel_id: voice.id })

  await waitForEvent(
    b2.events,
    (e) => e?.type === 'VoiceStateUpdate' && e?.data?.user_id === aUserId && e?.data?.channel_id === voice.id,
    'Reconnected B sees A in voice'
  )
  await waitForEvent(
    b2.events,
    (e) => e?.type === 'VoiceControlUpdate' && e?.data?.user_id === aUserId && e?.data?.screen_sharing === true,
    'Reconnected B sees A screen_sharing=true'
  )

  // 6) Cleanup
  wsSend(a.ws, 'LeaveVoice', null)
  wsSend(b2.ws, 'LeaveVoice', null)
  a.ws.close()
  b2.ws.close()

  console.log('[chaos] OK')
}

main().catch((err) => {
  console.error('[chaos] FAILED')
  console.error(err)
  process.exit(1)
})
