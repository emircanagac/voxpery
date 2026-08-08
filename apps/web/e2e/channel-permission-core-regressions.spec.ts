import { expect, test } from '@playwright/test'
import {
  buildCoreChannels,
  buildCoreMembers,
  buildCoreServer,
  buildServerMessage,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

const PERM_VIEW_CHANNEL = 1 << 0
const PERM_MANAGE_CHANNELS = 1 << 3
const PERM_SEND_MESSAGES = 1 << 7
const PERM_MANAGE_MESSAGES = 1 << 8
const PERM_MANAGE_PINS = 1 << 9
const PERM_CONNECT_VOICE = 1 << 10

test.describe('mocked channel permission regressions', () => {
  test('locks server and channel controls when the session lacks manage/send permissions', async ({ page }) => {
    const server = buildCoreServer({
      owner_id: 'server-owner',
      name: 'Limited Guild',
    })
    const channels = buildCoreChannels(server.id).map((channel) => ({
      ...channel,
      my_permissions: PERM_VIEW_CHANNEL,
    }))
    const general = channels.find((channel) => channel.name === 'general')
    const voice = channels.find((channel) => channel.channel_type === 'voice')
    if (!general || !voice) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      serverPermissionsByServerId: { [server.id]: PERM_VIEW_CHANNEL },
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {
        [general.id]: [
          buildServerMessage(general.id, 'Remote message without send permission', { id: 'remote-message' }),
        ],
      },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')

    await expect(page.locator('.channel-header-title')).toHaveText('Limited Guild')
    await expect(page.getByTitle('Create Channel')).toHaveCount(0)
    await expect(page.getByTitle('Create Category')).toHaveCount(0)

    const input = page.getByPlaceholder("You don't have permission to send messages in #general")
    await expect(input).toBeVisible()
    await expect(input).toBeDisabled()
    await expect(page.locator('.dm-attach-btn input[type="file"]')).toBeDisabled()
    await expect(page.getByTitle('Insert emoji')).toBeDisabled()

    const remoteRow = page.locator('[data-message-id="remote-message"]')
    await expect(remoteRow).toBeVisible()
    await remoteRow.hover()
    await expect(remoteRow.getByRole('button', { name: 'Add reaction' })).toHaveCount(0)
    await expect(remoteRow.getByRole('button', { name: 'Pin' })).toHaveCount(0)
    await expect(remoteRow.getByRole('button', { name: 'Delete' })).toHaveCount(0)

    const voiceRow = page.locator('.channel-item', { hasText: voice.name })
    await expect(voiceRow).toHaveClass(/channel-item--disabled/)
    await expect(voiceRow).toHaveAttribute('title', "You don't have permission to connect to this voice channel.")
    await voiceRow.click()
    await expect(page.locator('.chat-header .channel-title')).toHaveText('general')
  })

  test('keeps allowed message actions while hiding moderator-only controls', async ({ page }) => {
    const server = buildCoreServer({ owner_id: 'server-owner' })
    const channels = buildCoreChannels(server.id).map((channel) => ({
      ...channel,
      my_permissions: channel.channel_type === 'voice'
        ? PERM_VIEW_CHANNEL | PERM_CONNECT_VOICE
        : PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES,
    }))
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      serverPermissionsByServerId: { [server.id]: PERM_VIEW_CHANNEL },
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {
        [general.id]: [
          buildServerMessage(general.id, 'Reactable remote message', { id: 'limited-remote-message' }),
          buildServerMessage(general.id, 'Own message stays editable', {
            id: 'limited-own-message',
            author: {
              user_id: 'user-local',
              username: 'localuser',
              avatar_url: undefined,
              role_color: '#93c5fd',
            },
          }),
        ],
      },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')

    await expect(page.getByPlaceholder('Message #general')).toBeVisible()
    await expect(page.getByTitle('Create Channel')).toHaveCount(0)

    const remoteRow = page.locator('[data-message-id="limited-remote-message"]')
    await remoteRow.hover()
    await expect(remoteRow.getByRole('button', { name: 'Add reaction' })).toBeVisible()
    await expect(remoteRow.getByRole('button', { name: 'Pin' })).toHaveCount(0)
    await expect(remoteRow.getByRole('button', { name: 'Delete' })).toHaveCount(0)

    await remoteRow.getByRole('button', { name: 'Add reaction' }).click()
    await page.getByRole('button', { name: 'thumbs up' }).click()
    await expect(remoteRow.locator('.message-reaction-btn')).toContainText('1')

    const ownRow = page.locator('[data-message-id="limited-own-message"]')
    await ownRow.hover()
    await expect(ownRow.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(ownRow.getByRole('button', { name: 'Delete' })).toBeVisible()
    await expect(ownRow.getByRole('button', { name: 'Pin' })).toHaveCount(0)

    const content = `Limited permission send ${Date.now()}`
    const input = page.getByPlaceholder('Message #general')
    await input.fill(content)
    await input.press('Enter')

    await expect(page.getByText(content)).toBeVisible()
    expect(state.messagesByChannelId[general.id].some((message) => message.content === content)).toBe(true)
  })

  test('exposes moderator controls only when channel permission bits allow them', async ({ page }) => {
    const server = buildCoreServer({ owner_id: 'server-owner' })
    const channels = buildCoreChannels(server.id).map((channel) => ({
      ...channel,
      my_permissions: channel.channel_type === 'voice'
        ? PERM_VIEW_CHANNEL | PERM_CONNECT_VOICE
        : PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_MANAGE_MESSAGES | PERM_MANAGE_PINS,
    }))
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      serverPermissionsByServerId: { [server.id]: PERM_VIEW_CHANNEL | PERM_MANAGE_CHANNELS },
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {
        [general.id]: [
          buildServerMessage(general.id, 'Moderator managed message', { id: 'moderated-message' }),
        ],
      },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')

    await expect(page.getByRole('button', { name: 'Create channel in GENERAL' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create channel in VOICE' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create channels and categories' })).toHaveCount(0)

    const row = page.locator('[data-message-id="moderated-message"]')
    await row.hover()
    await expect(row.getByRole('button', { name: 'Pin' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Delete' })).toBeVisible()

    await row.getByRole('button', { name: 'Pin' }).click()
    await page.getByRole('button', { name: 'Pinned messages' }).click()
    await expect(page.locator('.chat-header-pinned-dropdown')).toContainText('Moderator managed message')

    await page.getByRole('button', { name: 'Pinned messages' }).click()
    await row.hover()
    await row.getByRole('button', { name: 'Delete' }).click()
    await page.locator('.confirm-modal', { hasText: 'Delete message' }).getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByText('Moderator managed message')).toBeHidden()
    expect(state.messagesByChannelId[general.id].some((message) => message.id === 'moderated-message')).toBe(false)
  })
})
