/**
 * Lightweight realtime load smoke test.
 *
 * This is not a full benchmark. It creates a small synthetic room, measures
 * WebSocket message delivery latency, exercises a reconnect burst, and checks
 * voice-state fan-out without touching the LiveKit media plane.
 *
 * Run with backend up:
 *   npm run load:realtime
 *
 * Optional env:
 *   SMOKE_API_URL=http://127.0.0.1:3001
 *   REALTIME_LOAD_USERS=5
 *   REALTIME_LOAD_MESSAGES=12
 *   REALTIME_LOAD_RECONNECT_USERS=3
 */
import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'

const API_BASE = process.env.SMOKE_API_URL || 'http://127.0.0.1:3001'
const WS_BASE = API_BASE.replace(/^http/, 'ws')

const USERS = intEnv('REALTIME_LOAD_USERS', 5, 2, 50)
const MESSAGES = intEnv('REALTIME_LOAD_MESSAGES', 12, 1, 200)
const RECONNECT_USERS = intEnv(
  'REALTIME_LOAD_RECONNECT_USERS',
  Math.min(3, USERS),
  1,
  USERS
)
const WAIT_TIMEOUT_MS = intEnv('REALTIME_LOAD_TIMEOUT_MS', 15000, 1000, 120000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function randomIdentity(prefix) {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`
  return {
    username: `${prefix}_${suffix}`,
    email: `${prefix}_${suffix}@voxpery.dev`,
    password: 'load-test-password-123',
  }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${method} ${path} failed (${res.status}): ${text}`)
  }
  return res.json()
}

async function registerUser(prefix) {
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: randomIdentity(prefix),
  })
  assert(res?.token && res?.user?.id, 'register response missing token/user')
  return { token: res.token, userId: res.user.id, username: res.user.username }
}

async function openWs(user) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws`, ['voxpery.auth', user.token])
    const client = {
      ...user,
      ws,
      events: [],
      messageTimes: new Map(),
      pongTimes: new Map(),
      voiceStateTimes: new Map(),
    }

    const onError = (err) => reject(err)
    ws.on('error', onError)
    ws.on('open', () => {
      ws.off('error', onError)
      ws.on('message', (raw) => {
        const receivedAt = Date.now()
        try {
          const event = JSON.parse(String(raw))
          client.events.push({ event, receivedAt })
          if (event?.type === 'NewMessage' && event?.data?.message?.id) {
            client.messageTimes.set(event.data.message.id, receivedAt)
          }
          if (event?.type === 'Pong' && event?.data?.sent_at_ms) {
            client.pongTimes.set(event.data.sent_at_ms, receivedAt)
          }
          if (event?.type === 'VoiceStateUpdate' && event?.data?.user_id) {
            client.voiceStateTimes.set(event.data.user_id, receivedAt)
          }
        } catch {
          // Ignore non-json frames.
        }
      })
      resolve(client)
    })
  })
}

function wsSend(ws, type, data) {
  ws.send(JSON.stringify({ type, data }))
}

async function waitFor(predicate, label, timeoutMs = WAIT_TIMEOUT_MS) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

function summarize(label, values) {
  const rounded = values.map((v) => Math.round(v))
  console.log(
    `[load:realtime] ${label}: count=${rounded.length} p50=${percentile(rounded, 50)}ms p95=${percentile(rounded, 95)}ms max=${Math.max(...rounded)}ms`
  )
}

async function createRoom(owner, members) {
  const server = await api('/api/servers', {
    method: 'POST',
    token: owner.token,
    body: { name: `Realtime Load ${Date.now()}`, icon_url: null },
  })
  assert(server?.id && server?.invite_code, 'server create failed')

  for (const member of members) {
    await api('/api/servers/join', {
      method: 'POST',
      token: member.token,
      body: { invite_code: server.invite_code },
    })
  }

  const channels = await api(`/api/servers/${server.id}/channels`, { token: owner.token })
  const textChannel = channels.find((c) => c.channel_type === 'text')
  const voiceChannel = channels.find((c) => c.channel_type === 'voice')
  assert(textChannel?.id, 'text channel missing')
  assert(voiceChannel?.id, 'voice channel missing')
  return { server, textChannel, voiceChannel }
}

async function measureMessageDelivery(clients, textChannel) {
  const latencies = []
  for (let i = 0; i < MESSAGES; i += 1) {
    const sender = clients[i % clients.length]
    const startedAt = Date.now()
    const sent = await api(`/api/messages/${textChannel.id}`, {
      method: 'POST',
      token: sender.token,
      body: { content: `load message ${i} ${startedAt}`, attachments: [] },
    })
    assert(sent?.id, 'message send response missing id')

    await waitFor(
      () => clients.every((client) => client.messageTimes.has(sent.id)),
      `NewMessage ${sent.id} delivery to ${clients.length} clients`
    )

    for (const client of clients) {
      latencies.push(client.messageTimes.get(sent.id) - startedAt)
    }
  }
  summarize('message delivery latency', latencies)
}

async function measureReconnectBurst(clients, textChannel, voiceChannel) {
  const subset = clients.slice(0, RECONNECT_USERS)
  const reconnectStartedAt = Date.now()
  for (const client of subset) {
    client.ws.terminate()
  }
  await sleep(300)

  const reconnected = await Promise.all(subset.map((client) => openWs(client)))
  for (const client of reconnected) {
    wsSend(client.ws, 'Subscribe', { channel_ids: [textChannel.id, voiceChannel.id] })
  }

  const pingLatencies = []
  for (const client of reconnected) {
    const sentAt = Date.now()
    wsSend(client.ws, 'Ping', { sent_at_ms: sentAt })
    await waitFor(() => client.pongTimes.has(sentAt), `Pong for ${client.username}`)
    pingLatencies.push(client.pongTimes.get(sentAt) - sentAt)
  }

  summarize('post-reconnect ping latency', pingLatencies)
  console.log(
    `[load:realtime] reconnect burst: users=${RECONNECT_USERS} elapsed=${Date.now() - reconnectStartedAt}ms`
  )

  return clients.map((client) => reconnected.find((next) => next.userId === client.userId) || client)
}

async function measureVoiceStateFanout(clients, voiceChannel) {
  const latencies = []
  for (const joiningClient of clients) {
    const startedAt = Date.now()
    wsSend(joiningClient.ws, 'JoinVoice', { channel_id: voiceChannel.id })
    await waitFor(
      () => clients.every((client) => client.voiceStateTimes.has(joiningClient.userId)),
      `VoiceStateUpdate for ${joiningClient.username}`
    )
    for (const client of clients) {
      latencies.push(client.voiceStateTimes.get(joiningClient.userId) - startedAt)
    }
  }
  summarize('voice state fan-out latency', latencies)
}

async function main() {
  console.log(`[load:realtime] API: ${API_BASE}`)
  console.log(
    `[load:realtime] users=${USERS} messages=${MESSAGES} reconnect_users=${RECONNECT_USERS}`
  )

  const users = []
  for (let i = 0; i < USERS; i += 1) {
    users.push(await registerUser(`rt_load_${i}`))
  }

  const owner = users[0]
  const members = users.slice(1)
  const { textChannel, voiceChannel } = await createRoom(owner, members)

  let clients = await Promise.all(users.map((user) => openWs(user)))
  for (const client of clients) {
    wsSend(client.ws, 'Subscribe', { channel_ids: [textChannel.id, voiceChannel.id] })
  }
  await sleep(300)

  await measureMessageDelivery(clients, textChannel)
  clients = await measureReconnectBurst(clients, textChannel, voiceChannel)
  await sleep(300)
  await measureVoiceStateFanout(clients, voiceChannel)

  for (const client of clients) {
    wsSend(client.ws, 'LeaveVoice', null)
    client.ws.close()
  }

  console.log('[load:realtime] OK')
}

main().catch((err) => {
  console.error('[load:realtime] FAILED')
  console.error(err)
  process.exit(1)
})
