import { randomUUID } from 'node:crypto'

const API_BASE = process.env.SMOKE_API_URL || 'http://127.0.0.1:3001'

function randomIdentity(prefix) {
  const suffix = `${Date.now()}${randomUUID().slice(0, 8)}`
  return {
    username: `${prefix}_${suffix}`,
    email: `${prefix}_${suffix}@voxpery.dev`,
    password: 'smoke-test-password-123',
  }
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text().catch(() => '')
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, ok: res.ok, json, text }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function checkAuthRateLimit() {
  const identity = randomIdentity('ratelimit_auth')
  const reg = await request('/api/auth/register', { method: 'POST', body: identity })
  assert(reg.ok && reg.json?.token, 'register failed for auth rate-limit check')

  let saw429 = false
  for (let i = 0; i < 15; i += 1) {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: { email: identity.email, password: 'wrong-password' },
    })
    if (res.status === 429) {
      saw429 = true
      break
    }
  }
  assert(saw429, 'auth login rate limit did not trigger (expected HTTP 429)')
}

async function checkMessageRateLimit() {
  const identity = randomIdentity('ratelimit_msg')
  const reg = await request('/api/auth/register', { method: 'POST', body: identity })
  assert(reg.ok && reg.json?.token, 'register failed for message rate-limit check')
  const token = reg.json.token

  const servers = await request('/api/servers', { token })
  assert(servers.ok && Array.isArray(servers.json) && servers.json.length > 0, 'server list failed')
  const server = servers.json.find((s) => s.invite_code === 'voxpery') || servers.json[0]

  const channels = await request(`/api/servers/${server.id}/channels`, { token })
  assert(channels.ok && Array.isArray(channels.json), 'channels list failed')
  const textChannel = channels.json.find((c) => c.channel_type === 'text')
  assert(textChannel?.id, 'text channel not found')

  let saw429 = false
  for (let i = 0; i < 45; i += 1) {
    const sendRes = await request(`/api/messages/${textChannel.id}`, {
      method: 'POST',
      token,
      body: { content: `ratelimit message ${Date.now()}_${i}`, attachments: [] },
    })
    if (sendRes.status === 429) {
      saw429 = true
      break
    }
  }
  assert(saw429, 'message rate limit did not trigger (expected HTTP 429)')
}

async function main() {
  console.log(`[rate-limit] API: ${API_BASE}`)
  await checkAuthRateLimit()
  console.log('[rate-limit] auth limit OK')
  await checkMessageRateLimit()
  console.log('[rate-limit] message limit OK')
  console.log('[rate-limit] OK')
}

main().catch((err) => {
  console.error('[rate-limit] FAILED')
  console.error(err)
  process.exit(1)
})
