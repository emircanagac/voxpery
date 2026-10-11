import { expect, test, type Page } from '@playwright/test'
import { buildCoreChannels, buildCoreMembers, buildCoreServer, buildServerMessage, createMockCoreState, installMockCoreApi } from './mock-core-api'

const author = { user_id: 'friend-01', username: 'Friend 01', avatar_url: undefined, role_color: null }

/** Delivers a `UserUpdated` event as the server would after a profile change. */
async function sendProfileUpdate(page: Page, avatarUrl: string | null) {
  await page.evaluate((avatar) => {
    const sockets = (window as unknown as { __mockSockets?: Array<{ onmessage: ((event: MessageEvent) => void) | null }> }).__mockSockets ?? []
    const data = JSON.stringify({
      type: 'UserUpdated',
      data: { user: { id: 'friend-01', username: 'Friend 01', avatar_url: avatar, status: 'online' } },
    })
    sockets.forEach(socket => socket.onmessage?.(new MessageEvent('message', { data })))
  }, avatarUrl)
}

test('updates message avatars in a server channel when the author changes their photo', { tag: '@core' }, async ({ page }) => {
  const server = buildCoreServer()
  const channels = buildCoreChannels(server.id)
  const messages = [
    buildServerMessage(channels[0].id, 'Older line', { id: 'avatar-older', author, created_at: '2026-01-15T10:00:00.000Z' }),
    buildServerMessage(channels[0].id, 'Newer line', { id: 'avatar-newer', author, created_at: '2026-01-15T11:00:00.000Z' }),
  ]
  const state = createMockCoreState({
    servers: [server],
    channelsByServerId: { [server.id]: channels },
    membersByServerId: { [server.id]: buildCoreMembers() },
    messagesByChannelId: { [channels[0].id]: messages, [channels[1].id]: [] },
  })
  await installMockCoreApi(page, state)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/servers')
  const avatar = page.locator('[data-message-id="avatar-older"] .message-avatar')
  await expect(avatar).toHaveText('F')

  await sendProfileUpdate(page, '/uploads/new-avatar.png')
  await expect(avatar.locator('img')).toHaveAttribute('src', /new-avatar/)

  // Coming back to the channel keeps the new photo (the server now returns it as well).
  messages.forEach(message => { message.author = { ...author, avatar_url: '/uploads/new-avatar.png' } })
  await page.getByRole('button', { name: 'Text channel announcements', exact: true }).click()
  await page.getByRole('button', { name: 'Text channel general', exact: true }).click()
  await expect(avatar.locator('img')).toHaveAttribute('src', /new-avatar/)

  // Removing the photo falls back to the initial.
  await sendProfileUpdate(page, null)
  await expect(avatar).toHaveText('F')
  await expect(avatar.locator('img')).toHaveCount(0)
})

test('updates message avatars in a direct message when the other person changes their photo', { tag: '@core' }, async ({ page }) => {
  const channel = {
    id: 'dm-avatar', peer_id: 'friend-01', peer_username: 'Friend 01',
    peer_avatar_url: null, peer_status: 'online', last_message_at: null,
    unread_count: 0, pinned_at: null, is_pinned: false,
  }
  const state = createMockCoreState({ dmChannels: [channel] })
  state.dmMessagesByChannelId[channel.id] = [
    buildServerMessage(channel.id, 'Hello from the DM', { id: 'dm-avatar-message', author }),
  ]
  await installMockCoreApi(page, state)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/social')
  await page.getByRole('button', { name: 'Open DM with Friend 01', exact: true }).click()
  const avatar = page.locator('[data-message-id="dm-avatar-message"] .message-avatar')
  await expect(avatar).toHaveText('F')

  await sendProfileUpdate(page, '/uploads/dm-new-avatar.png')
  await expect(avatar.locator('img')).toHaveAttribute('src', /dm-new-avatar/)
})
