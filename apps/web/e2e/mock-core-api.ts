import type { Page, Route } from '@playwright/test'
import type {
  Channel,
  DmChannel,
  Friend,
  FriendRequest,
  MemberInfo,
  MessageWithAuthor,
  Server,
  SystemFeatures,
  UserPublic,
} from '../src/api'

const AUTH_STORAGE_KEY = 'voxpery-auth'
const ALL_PERMISSIONS = (1 << 13) - 1

export interface MockCoreState {
  user: UserPublic
  friends: Friend[]
  incomingRequests: FriendRequest[]
  outgoingRequests: FriendRequest[]
  dmChannels: DmChannel[]
  dmMessagesByChannelId: Record<string, MessageWithAuthor[]>
  servers: Server[]
  channelsByServerId: Record<string, Channel[]>
  membersByServerId: Record<string, MemberInfo[]>
  messagesByChannelId: Record<string, MessageWithAuthor[]>
}

const DEFAULT_FEATURES: SystemFeatures = {
  google_oauth_enabled: false,
  email_delivery_enabled: false,
  email_verification_enabled: false,
  email_verification_required: false,
  password_reset_enabled: false,
}

export function buildFriends(count: number): Friend[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1
    return {
      id: `friend-${String(n).padStart(2, '0')}`,
      username: `Friend ${String(n).padStart(2, '0')}`,
      avatar_url: null,
      status: n % 3 === 0 ? 'dnd' : 'online',
    }
  })
}

export function buildRequests(count: number, direction: 'incoming' | 'outgoing'): FriendRequest[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1
    const label = `${direction === 'incoming' ? 'Request In' : 'Request Out'} ${String(n).padStart(2, '0')}`
    return {
      id: `${direction}-request-${String(n).padStart(2, '0')}`,
      requester_id: direction === 'incoming' ? `requester-${n}` : 'user-local',
      receiver_id: direction === 'incoming' ? 'user-local' : `receiver-${n}`,
      requester_username: direction === 'incoming' ? label : 'You',
      receiver_username: direction === 'incoming' ? 'You' : label,
      status: 'pending',
      created_at: new Date(Date.UTC(2026, 0, n)).toISOString(),
    }
  })
}

export function buildCoreServer(overrides: Partial<Server> = {}): Server {
  return {
    id: 'server-core',
    name: 'Core Guild',
    icon_url: undefined,
    description: 'Mocked community for core UI smoke tests.',
    owner_id: 'user-local',
    invite_code: 'core-guild',
    ...overrides,
  }
}

export function buildCoreChannels(serverId = 'server-core'): Channel[] {
  return [
    {
      id: `${serverId}-general`,
      server_id: serverId,
      name: 'general',
      description: 'General chat for the core smoke fixture.',
      channel_type: 'text',
      category: 'GENERAL',
      position: 0,
      my_permissions: ALL_PERMISSIONS,
    },
    {
      id: `${serverId}-announcements`,
      server_id: serverId,
      name: 'announcements',
      description: 'Read updates before chatting.',
      channel_type: 'text',
      category: 'GENERAL',
      position: 1,
      my_permissions: ALL_PERMISSIONS,
    },
    {
      id: `${serverId}-voice`,
      server_id: serverId,
      name: 'Voice Lounge',
      description: 'Voice room used by the smoke fixture.',
      channel_type: 'voice',
      category: 'VOICE',
      position: 2,
      my_permissions: ALL_PERMISSIONS,
    },
  ]
}

export function buildCoreMembers(): MemberInfo[] {
  return [
    {
      user_id: 'user-local',
      username: 'localuser',
      avatar_url: null,
      role: 'owner',
      status: 'online',
      role_color: '#93c5fd',
      roles: ['owner'],
    },
    {
      user_id: 'friend-01',
      username: 'Friend 01',
      avatar_url: null,
      role: 'member',
      status: 'online',
      role_color: null,
      roles: [],
    },
  ]
}

export function buildServerMessage(
  channelId: string,
  content: string,
  overrides: Partial<MessageWithAuthor> = {},
): MessageWithAuthor {
  return {
    id: `message-${channelId}-${Math.random().toString(36).slice(2, 8)}`,
    channel_id: channelId,
    content,
    attachments: [],
    reactions: [],
    edited_at: null,
    created_at: new Date(Date.UTC(2026, 0, 15, 10, 0, 0)).toISOString(),
    author: {
      user_id: 'friend-01',
      username: 'Friend 01',
      avatar_url: undefined,
      role_color: null,
    },
    ...overrides,
  }
}

export function createMockCoreState(overrides: Partial<MockCoreState> = {}): MockCoreState {
  const user: UserPublic = {
    id: 'user-local',
    username: 'localuser',
    email: 'localuser@example.test',
    email_verified: true,
    avatar_url: undefined,
    status: 'online',
    dm_privacy: 'friends',
    google_connected: false,
    has_password: true,
    username_changed_at: null,
  }

  return {
    user,
    friends: buildFriends(24),
    incomingRequests: buildRequests(10, 'incoming'),
    outgoingRequests: buildRequests(8, 'outgoing'),
    dmChannels: [],
    dmMessagesByChannelId: {},
    servers: [],
    channelsByServerId: {},
    membersByServerId: {},
    messagesByChannelId: {},
    ...overrides,
  }
}

export async function installMockCoreApi(page: Page, state: MockCoreState = createMockCoreState()) {
  await page.addInitScript(
    ({ authStorageKey, user }) => {
      window.localStorage.setItem(
        authStorageKey,
        JSON.stringify({
          state: { token: null, user },
          version: 2,
        }),
      )
      window.localStorage.removeItem('voxpery-hidden-dm-peers')
      window.sessionStorage.clear()

      const permissionStatus = {
        state: 'granted',
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true },
      }
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: {
          query: async () => permissionStatus,
        },
      })
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          enumerateDevices: async () => [
            {
              deviceId: 'mock-microphone',
              groupId: 'mock-audio',
              kind: 'audioinput',
              label: 'Mock Microphone',
            },
            {
              deviceId: 'mock-speaker',
              groupId: 'mock-audio',
              kind: 'audiooutput',
              label: 'Mock Speaker',
            },
          ],
          getUserMedia: async () => {
            throw new DOMException('Mock microphone unavailable in smoke tests.', 'NotAllowedError')
          },
          addEventListener() {},
          removeEventListener() {},
        },
      })

      class MockWebSocket extends EventTarget {
        static CONNECTING = 0
        static OPEN = 1
        static CLOSING = 2
        static CLOSED = 3

        readyState = MockWebSocket.CONNECTING
        onopen: ((event: Event) => void) | null = null
        onclose: ((event: CloseEvent) => void) | null = null
        onmessage: ((event: MessageEvent) => void) | null = null
        onerror: ((event: Event) => void) | null = null

        constructor() {
          super()
          window.setTimeout(() => {
            this.readyState = MockWebSocket.OPEN
            const event = new Event('open')
            this.onopen?.(event)
            this.dispatchEvent(event)
          }, 0)
        }

        send() {}

        close() {
          this.readyState = MockWebSocket.CLOSED
          const event = new CloseEvent('close', { code: 1000, reason: 'mock closed' })
          this.onclose?.(event)
          this.dispatchEvent(event)
        }
      }

      Object.defineProperty(window, 'WebSocket', {
        configurable: true,
        writable: true,
        value: MockWebSocket,
      })
    },
    { authStorageKey: AUTH_STORAGE_KEY, user: state.user },
  )

  await page.route('http://localhost:3001/**', async (route) => {
    await handleMockApiRoute(route, state)
  })
}

async function handleMockApiRoute(route: Route, state: MockCoreState) {
  const request = route.request()
  const url = new URL(request.url())
  const method = request.method()
  const pathname = url.pathname

  if (pathname === '/health') {
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    return
  }

  if (pathname === '/api/system/features' && method === 'GET') {
    await json(route, DEFAULT_FEATURES)
    return
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    await json(route, state.user)
    return
  }

  if (pathname === '/api/servers' && method === 'GET') {
    await json(route, state.servers)
    return
  }

  const serverDetailMatch = pathname.match(/^\/api\/servers\/([^/]+)$/)
  if (serverDetailMatch && method === 'GET') {
    const serverId = serverDetailMatch[1]
    const server = state.servers.find((item) => item.id === serverId)
    if (!server) {
      await json(route, { error: 'Server not found' }, 404)
      return
    }
    await json(route, {
      ...server,
      my_permissions: ALL_PERMISSIONS,
      members: state.membersByServerId[serverId] ?? buildCoreMembers(),
    })
    return
  }

  const serverChannelsMatch = pathname.match(/^\/api\/servers\/([^/]+)\/channels$/)
  if (serverChannelsMatch && method === 'GET') {
    await json(route, state.channelsByServerId[serverChannelsMatch[1]] ?? [])
    return
  }

  const channelMembersMatch = pathname.match(/^\/api\/servers\/([^/]+)\/channels\/([^/]+)\/members$/)
  if (channelMembersMatch && method === 'GET') {
    await json(route, state.membersByServerId[channelMembersMatch[1]] ?? buildCoreMembers())
    return
  }

  const categoriesMatch = pathname.match(/^\/api\/channels\/server\/([^/]+)\/categories$/)
  if (categoriesMatch && method === 'GET') {
    const categories = Array.from(
      new Set(
        (state.channelsByServerId[categoriesMatch[1]] ?? [])
          .map((channel) => channel.category?.trim())
          .filter((category): category is string => !!category),
      ),
    ).map((name) => ({ name }))
    await json(route, categories)
    return
  }

  if (pathname === '/api/webrtc/turn-credentials' && method === 'GET') {
    await json(route, { urls: [] })
    return
  }

  if (pathname === '/api/webrtc/livekit-token' && method === 'GET') {
    const channelId = url.searchParams.get('channel_id') ?? 'mock-channel'
    await json(route, {
      ws_url: 'wss://livekit.invalid',
      token: `mock-livekit-token-${channelId}`,
      room: `mock-room-${channelId}`,
      identity: state.user.id,
    })
    return
  }

  if (pathname === '/api/friends' && method === 'GET') {
    await json(route, state.friends)
    return
  }

  if (pathname === '/api/friends/requests' && method === 'GET') {
    await json(route, {
      incoming: state.incomingRequests,
      outgoing: state.outgoingRequests,
    })
    return
  }

  if (pathname === '/api/friends/requests' && method === 'POST') {
    const body = request.postDataJSON() as { username?: string }
    const next = buildRequests(1, 'outgoing')[0]
    state.outgoingRequests = [
      { ...next, id: `outgoing-request-${Date.now()}`, receiver_username: body.username ?? 'New Friend' },
      ...state.outgoingRequests,
    ]
    await json(route, {})
    return
  }

  const acceptMatch = pathname.match(/^\/api\/friends\/requests\/([^/]+)\/accept$/)
  if (acceptMatch && method === 'POST') {
    const requestId = acceptMatch[1]
    const accepted = state.incomingRequests.find((item) => item.id === requestId)
    state.incomingRequests = state.incomingRequests.filter((item) => item.id !== requestId)
    if (accepted) {
      state.friends = [
        {
          id: accepted.requester_id,
          username: accepted.requester_username,
          avatar_url: null,
          status: 'online',
        },
        ...state.friends,
      ]
    }
    await json(route, {})
    return
  }

  const rejectMatch = pathname.match(/^\/api\/friends\/requests\/([^/]+)\/reject$/)
  if (rejectMatch && method === 'POST') {
    const requestId = rejectMatch[1]
    state.incomingRequests = state.incomingRequests.filter((item) => item.id !== requestId)
    state.outgoingRequests = state.outgoingRequests.filter((item) => item.id !== requestId)
    await json(route, {})
    return
  }

  const removeFriendMatch = pathname.match(/^\/api\/friends\/([^/]+)$/)
  if (removeFriendMatch && method === 'DELETE') {
    const friendId = removeFriendMatch[1]
    state.friends = state.friends.filter((friend) => friend.id !== friendId)
    await json(route, {})
    return
  }

  if (pathname === '/api/dm/channels' && method === 'GET') {
    await json(route, state.dmChannels)
    return
  }

  const createDmMatch = pathname.match(/^\/api\/dm\/channels\/([^/]+)$/)
  if (createDmMatch && method === 'POST') {
    const peerId = createDmMatch[1]
    const friend = state.friends.find((item) => item.id === peerId)
    const channel = upsertDmChannel(state, {
      id: `dm-${peerId}`,
      peer_id: peerId,
      peer_username: friend?.username ?? 'Unknown Friend',
      peer_avatar_url: friend?.avatar_url ?? null,
      peer_status: friend?.status ?? 'offline',
      last_message_at: null,
      unread_count: 0,
    })
    await json(route, channel)
    return
  }

  const dmReadStateMatch = pathname.match(/^\/api\/dm\/channels\/([^/]+)\/read-state$/)
  if (dmReadStateMatch && method === 'GET') {
    await json(route, { peer_last_read_message_id: null })
    return
  }

  const dmReadMatch = pathname.match(/^\/api\/dm\/channels\/([^/]+)\/read$/)
  if (dmReadMatch && method === 'POST') {
    await json(route, {})
    return
  }

  const dmPinsMatch = pathname.match(/^\/api\/dm\/channels\/([^/]+)\/pins$/)
  if (dmPinsMatch && method === 'GET') {
    await json(route, [])
    return
  }

  const dmMessagesMatch = pathname.match(/^\/api\/dm\/messages\/([^/]+)$/)
  if (dmMessagesMatch && method === 'GET') {
    await json(route, state.dmMessagesByChannelId[dmMessagesMatch[1]] ?? [])
    return
  }

  if (dmMessagesMatch && method === 'POST') {
    const channelId = dmMessagesMatch[1]
    const body = request.postDataJSON() as { content?: string; attachments?: unknown[] }
    const message = createDmMessage(state, channelId, body.content ?? '', body.attachments ?? [])
    state.dmMessagesByChannelId[channelId] = [
      ...(state.dmMessagesByChannelId[channelId] ?? []),
      message,
    ]
    await json(route, message)
    return
  }

  const serverMessageSearchMatch = pathname.match(/^\/api\/messages\/([^/]+)\/search$/)
  if (serverMessageSearchMatch && method === 'GET') {
    const channelId = serverMessageSearchMatch[1]
    const query = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const rows = state.messagesByChannelId[channelId] ?? []
    await json(route, query ? rows.filter((message) => message.content.toLowerCase().includes(query)) : rows)
    return
  }

  const serverPinsMatch = pathname.match(/^\/api\/messages\/([^/]+)\/pins$/)
  if (serverPinsMatch && method === 'GET') {
    await json(route, [])
    return
  }

  if (serverPinsMatch && method === 'POST') {
    await json(route, buildServerMessage(serverPinsMatch[1], 'Pinned smoke message'))
    return
  }

  const serverPinDeleteMatch = pathname.match(/^\/api\/messages\/([^/]+)\/pins\/([^/]+)$/)
  if (serverPinDeleteMatch && method === 'DELETE') {
    await json(route, {})
    return
  }

  const serverMessagesMatch = pathname.match(/^\/api\/messages\/([^/]+)$/)
  if (serverMessagesMatch && method === 'GET') {
    await json(route, state.messagesByChannelId[serverMessagesMatch[1]] ?? [])
    return
  }

  if (serverMessagesMatch && method === 'POST') {
    const channelId = serverMessagesMatch[1]
    const body = request.postDataJSON() as { content?: string; attachments?: unknown[] }
    const message = createServerMessage(state, channelId, body.content ?? '', body.attachments ?? [])
    state.messagesByChannelId[channelId] = [
      ...(state.messagesByChannelId[channelId] ?? []),
      message,
    ]
    await json(route, message)
    return
  }

  await json(route, { error: `Unhandled mocked endpoint: ${method} ${pathname}` }, 404)
}

function upsertDmChannel(state: MockCoreState, channel: DmChannel): DmChannel {
  state.dmChannels = [channel, ...state.dmChannels.filter((item) => item.id !== channel.id)]
  if (!state.dmMessagesByChannelId[channel.id]) {
    state.dmMessagesByChannelId[channel.id] = []
  }
  return channel
}

function createDmMessage(
  state: MockCoreState,
  channelId: string,
  content: string,
  attachments: unknown[],
): MessageWithAuthor {
  return {
    id: `message-${channelId}-${Date.now()}`,
    channel_id: channelId,
    content,
    attachments: attachments as MessageWithAuthor['attachments'],
    reactions: [],
    edited_at: null,
    created_at: new Date().toISOString(),
    author: {
      user_id: state.user.id,
      username: state.user.username,
      avatar_url: state.user.avatar_url,
      role_color: null,
    },
  }
}

function createServerMessage(
  state: MockCoreState,
  channelId: string,
  content: string,
  attachments: unknown[],
): MessageWithAuthor {
  return {
    id: `message-${channelId}-${Date.now()}`,
    channel_id: channelId,
    content,
    attachments: attachments as MessageWithAuthor['attachments'],
    reactions: [],
    edited_at: null,
    created_at: new Date().toISOString(),
    author: {
      user_id: state.user.id,
      username: state.user.username,
      avatar_url: state.user.avatar_url,
      role_color: '#93c5fd',
    },
  }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
