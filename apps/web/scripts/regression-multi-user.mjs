/**
 * Automated multi-user regression (no browser, no 3 human users).
 * Simulates 3 users via API + WebSocket: register, server create/join, channel messages, DM, voice state.
 * Run with backend up: npm run regression:multi-user
 * Optional: SMOKE_API_URL=http://127.0.0.1:3001
 */
import { WebSocket } from 'ws'

const API_BASE = process.env.SMOKE_API_URL || 'http://127.0.0.1:3001'
const WS_BASE = API_BASE.replace(/^http/, 'ws')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`
  return {
    username: `reg_${prefix}_${suffix}`,
    email: `reg_${prefix}_${suffix}@voxpery.dev`,
    password: 'regression-test-password-123',
  }
}

async function register(creds) {
  const res = await api('/api/auth/register', { method: 'POST', body: creds })
  assert(res?.token && res?.user?.id, 'register failed')
  return { token: res.token, userId: res.user.id, username: res.user.username }
}

async function openWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws`, ['voxpery.auth', token])
    const events = []
    ws.on('error', reject)
    ws.on('open', () => {
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

async function waitForEvent(events, predicate, label, ms = 8000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const found = events.find(predicate)
    if (found) return found
    await sleep(50)
  }
  throw new Error(`Timed out waiting for: ${label}`)
}

async function main() {
  console.log('[regression-multi-user] API:', API_BASE)

  const credsA = randomIdentity('A')
  const credsB = randomIdentity('B')
  const credsC = randomIdentity('C')

  console.log('[regression] Register user A')
  const userA = await register(credsA)
  console.log('[regression] Register user B')
  const userB = await register(credsB)
  console.log('[regression] Register user C')
  const userC = await register(credsC)

  console.log('[regression] User A creates server')
  const server = await api('/api/servers', {
    method: 'POST',
    token: userA.token,
    body: { name: 'Regression Server', icon_url: null },
  })
  assert(server?.id && server?.invite_code, 'create server failed')

  console.log('[regression] User B joins server')
  await api('/api/servers/join', {
    method: 'POST',
    token: userB.token,
    body: { invite_code: server.invite_code },
  })
  console.log('[regression] User C joins server')
  await api('/api/servers/join', {
    method: 'POST',
    token: userC.token,
    body: { invite_code: server.invite_code },
  })

  console.log('[regression] List channels (A)')
  const channels = await api(`/api/servers/${server.id}/channels`, { token: userA.token })
  assert(Array.isArray(channels) && channels.length > 0, 'no channels')
  const textChannel = channels.find((c) => c.channel_type === 'text')
  assert(textChannel?.id, 'no text channel')

  console.log('[regression] A, B, C send channel messages')
  const msgA = await api(`/api/messages/${textChannel.id}`, {
    method: 'POST',
    token: userA.token,
    body: { content: 'Message from A', attachments: [] },
  })
  assert(msgA?.id, 'A message failed')
  const msgB = await api(`/api/messages/${textChannel.id}`, {
    method: 'POST',
    token: userB.token,
    body: { content: 'Message from B', attachments: [] },
  })
  assert(msgB?.id, 'B message failed')
  const msgC = await api(`/api/messages/${textChannel.id}`, {
    method: 'POST',
    token: userC.token,
    body: { content: 'Message from C', attachments: [] },
  })
  assert(msgC?.id, 'C message failed')

  console.log('[regression] A sends friend request to B')
  await api('/api/friends/requests', {
    method: 'POST',
    token: userA.token,
    body: { username: userB.username },
  })
  console.log('[regression] B lists friend requests and accepts A')
  const requests = await api('/api/friends/requests', { token: userB.token })
  assert(requests?.incoming?.length >= 1, 'B should have incoming request from A')
  const requestFromA = requests.incoming.find((r) => r.requester_id === userA.userId)
  assert(requestFromA?.id, 'request from A not found')
  await api(`/api/friends/requests/${requestFromA.id}/accept`, {
    method: 'POST',
    token: userB.token,
  })

  console.log('[regression] A opens DM with B')
  const dmChannel = await api(`/api/dm/channels/${userB.userId}`, {
    method: 'POST',
    token: userA.token,
  })
  assert(dmChannel?.id, 'get_or_create DM failed')

  console.log('[regression] A sends DM to B')
  const dmMsg = await api(`/api/dm/messages/${dmChannel.id}`, {
    method: 'POST',
    token: userA.token,
    body: { content: 'DM from A to B', attachments: null },
  })
  assert(dmMsg?.id, 'DM message failed')

  console.log('[regression] B fetches DM messages')
  const dmMessages = await api(`/api/dm/messages/${dmChannel.id}`, { token: userB.token })
  assert(Array.isArray(dmMessages) && dmMessages.length >= 1, 'B should see DM messages')
  assert(dmMessages.some((m) => m.id === dmMsg.id), 'B should see A\'s DM')

  console.log('[regression] A and B join voice (WebSocket)')
  const { ws: wsA, events: eventsA } = await openWs(userA.token)
  const { ws: wsB, events: eventsB } = await openWs(userB.token)

  const voiceChannel = channels.find((c) => c.channel_type === 'voice')
  assert(voiceChannel?.id, 'no voice channel')

  wsSend(wsA, 'Subscribe', { channel_ids: [textChannel.id, voiceChannel.id] })
  wsSend(wsB, 'Subscribe', { channel_ids: [textChannel.id, voiceChannel.id] })
  await sleep(200)

  wsSend(wsA, 'JoinVoice', { channel_id: voiceChannel.id })
  await waitForEvent(
    eventsA,
    (e) => e?.type === 'VoiceStateUpdate' && e?.data?.user_id === userA.userId && e?.data?.channel_id === voiceChannel.id,
    'A VoiceStateUpdate join'
  )
  wsSend(wsB, 'JoinVoice', { channel_id: voiceChannel.id })
  await waitForEvent(
    eventsB,
    (e) => e?.type === 'VoiceStateUpdate' && e?.data?.user_id === userB.userId && e?.data?.channel_id === voiceChannel.id,
    'B VoiceStateUpdate join'
  )

  console.log('[regression] A and B leave voice')
  wsSend(wsA, 'LeaveVoice', null)
  await waitForEvent(
    eventsA,
    (e) => e?.type === 'VoiceStateUpdate' && e?.data?.user_id === userA.userId && e?.data?.channel_id == null,
    'A VoiceStateUpdate leave'
  )
  wsSend(wsB, 'LeaveVoice', null)
  await waitForEvent(
    eventsB,
    (e) => e?.type === 'VoiceStateUpdate' && e?.data?.user_id === userB.userId && e?.data?.channel_id == null,
    'B VoiceStateUpdate leave'
  )

  wsA.close()
  wsB.close()

  console.log('[regression-multi-user] OK – 3 users, server join, channel messages, DM, voice join/leave')
}

main().catch((err) => {
  console.error('[regression-multi-user] FAILED')
  console.error(err)
  process.exit(1)
})
