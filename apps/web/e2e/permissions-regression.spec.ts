import { test, expect, type APIRequestContext, request } from '@playwright/test'

type AuthUser = {
  token: string
  userId: string
  email: string
  username: string
}

const PERM_VIEW_CHANNEL = 1
const PERM_SEND_MESSAGES = 1 << 7
const PERM_MANAGE_MESSAGES = 1 << 8
const PERM_MANAGE_PINS = 1 << 9
const PERM_CONNECT_VOICE = 1 << 10

async function registerUser(
  ctx: APIRequestContext,
  prefix: string,
  suffix: string
): Promise<AuthUser> {
  const email = `${prefix}_${suffix}@example.com`
  const username = `${prefix}_${suffix}`
  const password = 'TestPassword123!'

  const res = await ctx.post('/api/auth/register', {
    data: { email, username, password },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()

  return {
    token: body.token as string,
    userId: body.user.id as string,
    email,
    username,
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

test.describe('Permission Regression (API e2e)', () => {
  test('category override denies view/send/voice for everyone role', async ({ baseURL }) => {
    const api = await request.newContext({ baseURL })
    const runId = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`

    const owner = await registerUser(api, 'perm_owner', runId)
    const member = await registerUser(api, 'perm_member', runId)

    const createServer = await api.post('/api/servers', {
      headers: authHeaders(owner.token),
      data: { name: `Perm Server ${runId}` },
    })
    expect(createServer.ok()).toBeTruthy()
    const server = await createServer.json()
    const serverId = server.id as string
    const inviteCode = server.invite_code as string

    const join = await api.post('/api/servers/join', {
      headers: authHeaders(member.token),
      data: { invite_code: inviteCode },
    })
    expect(join.ok()).toBeTruthy()

    const createText = await api.post('/api/channels', {
      headers: authHeaders(owner.token),
      data: {
        server_id: serverId,
        name: `secret_text_${runId}`,
        channel_type: 'text',
        category: 'Secret',
      },
    })
    expect(createText.ok()).toBeTruthy()
    const textChannel = await createText.json()
    const textChannelId = textChannel.id as string

    const createVoice = await api.post('/api/channels', {
      headers: authHeaders(owner.token),
      data: {
        server_id: serverId,
        name: `secret_voice_${runId}`,
        channel_type: 'voice',
        category: 'Secret',
      },
    })
    expect(createVoice.ok()).toBeTruthy()
    const voiceChannel = await createVoice.json()
    const voiceChannelId = voiceChannel.id as string

    const rolesRes = await api.get(`/api/servers/${serverId}/roles?include_system=true`, {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    })
    expect(rolesRes.ok()).toBeTruthy()
    const roles = (await rolesRes.json()) as Array<{ id: string; name: string }>
    const everyone = roles.find((r) => r.name.toLowerCase() === 'everyone')
    expect(everyone).toBeTruthy()

    const beforeChannels = await api.get(`/api/servers/${serverId}/channels`, {
      headers: { Authorization: `Bearer ${member.token}` },
    })
    expect(beforeChannels.ok()).toBeTruthy()
    const beforeBody = (await beforeChannels.json()) as Array<{ id: string }>
    expect(beforeBody.some((c) => c.id === textChannelId)).toBeTruthy()
    expect(beforeBody.some((c) => c.id === voiceChannelId)).toBeTruthy()

    const denyBits = PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_CONNECT_VOICE
    const setCategoryOverride = await api.put(
      `/api/channels/server/${serverId}/categories/${encodeURIComponent('Secret')}/overrides/${everyone!.id}`,
      {
        headers: authHeaders(owner.token),
        data: { allow: 0, deny: denyBits },
      }
    )
    expect(setCategoryOverride.ok()).toBeTruthy()

    const afterChannels = await api.get(`/api/servers/${serverId}/channels`, {
      headers: { Authorization: `Bearer ${member.token}` },
    })
    expect(afterChannels.ok()).toBeTruthy()
    const afterBody = (await afterChannels.json()) as Array<{ id: string }>
    expect(afterBody.some((c) => c.id === textChannelId)).toBeFalsy()
    expect(afterBody.some((c) => c.id === voiceChannelId)).toBeFalsy()

    const sendMessage = await api.post(`/api/messages/${textChannelId}`, {
      headers: authHeaders(member.token),
      data: { content: 'blocked message' },
    })
    expect(sendMessage.status()).toBe(403)

    const livekitToken = await api.get(
      `/api/webrtc/livekit-token?channel_id=${encodeURIComponent(voiceChannelId)}`,
      {
        headers: { Authorization: `Bearer ${member.token}` },
      }
    )
    expect(livekitToken.status()).toBe(403)

    await api.dispose()
  })

  test('role bitmask enforces manage messages and pins', async ({ baseURL }) => {
    const api = await request.newContext({ baseURL })
    const runId = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`

    const owner = await registerUser(api, 'perm_owner2', runId)
    const moderator = await registerUser(api, 'perm_mod2', runId)
    const member = await registerUser(api, 'perm_member2', runId)

    const createServer = await api.post('/api/servers', {
      headers: authHeaders(owner.token),
      data: { name: `Role Bits Server ${runId}` },
    })
    expect(createServer.ok()).toBeTruthy()
    const server = await createServer.json()
    const serverId = server.id as string
    const inviteCode = server.invite_code as string

    for (const token of [moderator.token, member.token]) {
      const join = await api.post('/api/servers/join', {
        headers: authHeaders(token),
        data: { invite_code: inviteCode },
      })
      expect(join.ok()).toBeTruthy()
    }

    const createRole = await api.post(`/api/servers/${serverId}/roles`, {
      headers: authHeaders(owner.token),
      data: {
        name: 'ModLite',
        permissions: PERM_MANAGE_MESSAGES | PERM_MANAGE_PINS,
        color: '#00aaff',
      },
    })
    expect(createRole.ok()).toBeTruthy()
    const role = await createRole.json()
    const roleId = role.id as string

    const assignRole = await api.put(`/api/servers/${serverId}/members/${moderator.userId}/roles`, {
      headers: authHeaders(owner.token),
      data: { role_ids: [roleId] },
    })
    expect(assignRole.ok()).toBeTruthy()

    const createChannel = await api.post('/api/channels', {
      headers: authHeaders(owner.token),
      data: {
        server_id: serverId,
        name: `role_test_${runId}`,
        channel_type: 'text',
      },
    })
    expect(createChannel.ok()).toBeTruthy()
    const channel = await createChannel.json()
    const channelId = channel.id as string

    const userMessage = await api.post(`/api/messages/${channelId}`, {
      headers: authHeaders(member.token),
      data: { content: 'plain message' },
    })
    expect(userMessage.ok()).toBeTruthy()
    const userMessageBody = await userMessage.json()
    const userMessageId = userMessageBody.id as string

    const modDelete = await api.delete(`/api/messages/item/${userMessageId}`, {
      headers: { Authorization: `Bearer ${moderator.token}` },
    })
    expect(modDelete.ok()).toBeTruthy()

    const modMessage = await api.post(`/api/messages/${channelId}`, {
      headers: authHeaders(moderator.token),
      data: { content: 'mod message' },
    })
    expect(modMessage.ok()).toBeTruthy()
    const modMessageBody = await modMessage.json()
    const modMessageId = modMessageBody.id as string

    const userPin = await api.post(`/api/messages/${channelId}/pins`, {
      headers: authHeaders(member.token),
      data: { message_id: modMessageId },
    })
    expect(userPin.status()).toBe(403)

    const modPin = await api.post(`/api/messages/${channelId}/pins`, {
      headers: authHeaders(moderator.token),
      data: { message_id: modMessageId },
    })
    expect(modPin.ok()).toBeTruthy()

    const userUnpin = await api.delete(`/api/messages/${channelId}/pins/${modMessageId}`, {
      headers: { Authorization: `Bearer ${member.token}` },
    })
    expect(userUnpin.status()).toBe(403)

    const modUnpin = await api.delete(`/api/messages/${channelId}/pins/${modMessageId}`, {
      headers: { Authorization: `Bearer ${moderator.token}` },
    })
    expect(modUnpin.ok()).toBeTruthy()

    await api.dispose()
  })
})
