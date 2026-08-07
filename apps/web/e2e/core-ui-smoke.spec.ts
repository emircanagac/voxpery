import { expect, test, type Locator } from '@playwright/test'
import {
  buildCoreChannels,
  buildCoreMembers,
  buildCoreServer,
  buildFriends,
  buildRequests,
  buildServerMessage,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

test.describe('mocked core UI smoke', () => {
  test('keeps Friends tabs scrollable and friend actions reachable', async ({ page }) => {
    const state = createMockCoreState({
      friends: buildFriends(30),
      incomingRequests: buildRequests(36, 'incoming'),
      outgoingRequests: buildRequests(30, 'outgoing'),
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')

    await expect(page.getByRole('button', { name: /Online/ })).toBeVisible()
    await expect(page.getByText('Online Friends — 30')).toBeVisible()
    await expectScrollable(page.locator('.home-friends-scroll').first())

    await page.getByRole('button', { name: /All/ }).click()
    await expect(page.getByText('All Friends — 30')).toBeVisible()
    await expectScrollable(page.locator('.home-friends-scroll').first())
    await expect(page.getByRole('button', { name: 'Open DM with Friend 01' })).toBeVisible()

    const allScroller = page.locator('.home-friends-scroll').first()
    await allScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Friend 30')).toBeVisible()

    await page.getByRole('button', { name: /Requests/ }).click()
    const requestScroller = page.locator('.home-friends-scroll--requests')
    await expect(page.getByText('Incoming')).toBeVisible()
    await expect(page.getByText('Outgoing')).toBeVisible()
    await expectScrollable(requestScroller)

    await requestScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Request Out 30')).toBeVisible()
  })

  test('opens a DM from the Friends action button and sends a message', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(8) })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: /All/ }).click()
    await page.getByRole('button', { name: 'Open DM with Friend 01' }).click()

    await expect(page).toHaveURL(/\/social\/dm/)
    const messageInput = page.getByPlaceholder('Message @Friend 01')
    await expect(messageInput).toBeVisible()

    const content = `Mocked smoke message ${Date.now()}`
    await messageInput.fill(content)
    await messageInput.press('Enter')

    await expect(page.getByText(content)).toBeVisible()
    expect(state.dmMessagesByChannelId['dm-friend-01']?.some((message) => message.content === content)).toBe(true)
  })

  test('keeps the Friends surface usable on mobile viewport', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(18) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 390, height: 760 })

    await page.goto('/social')

    await expect(page.getByRole('button', { name: /Online/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /All/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Requests/ })).toBeVisible()

    await page.getByRole('button', { name: /All/ }).click()
    await expect(page.getByRole('button', { name: 'Open DM with Friend 01' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Message Friend 01' })).toBeVisible()

    const hasHorizontalOverflow = await page.locator('.home-main').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('sends a server channel message and keeps channel switching intact', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    const announcements = channels.find((channel) => channel.name === 'announcements')
    if (!general || !announcements) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {
        [general.id]: [buildServerMessage(general.id, 'Pinned release note', {
          created_at: new Date().toISOString(),
        })],
        [announcements.id]: [buildServerMessage(announcements.id, 'Announcements stay visible')],
      },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')

    await expect(page.locator('.server-icon[data-server-id="server-core"]')).toBeVisible()
    await expect(page.locator('.channel-header-title')).toHaveText('Core Guild')
    await expect(page.locator('.chat-header .channel-title')).toHaveText('general')
    await expect(page.getByText('Pinned release note')).toBeVisible()

    const content = `Server smoke message ${Date.now()}`
    const messageInput = page.getByPlaceholder('Message #general')
    await expect(messageInput).toBeVisible()
    await messageInput.fill(content)
    await messageInput.press('Enter')

    await expect(page.getByText(content)).toBeVisible()
    await expectVirtualMessageHeight(page.locator('.virtual-list-item', { hasText: content }), 53)
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content === content)).toBe(true)

    const continuation = `Server smoke continuation ${Date.now()}`
    await messageInput.fill(continuation)
    await messageInput.press('Enter')

    await expect(page.getByText(continuation)).toBeVisible()
    await expectVirtualMessageHeight(page.locator('.virtual-list-item', { hasText: continuation }), 23)
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content === continuation)).toBe(true)

    await page.locator('.channel-item', { hasText: 'announcements' }).click()
    await expect(page.locator('.chat-header .channel-title')).toHaveText('announcements')
    await expect(page.getByText('Announcements stay visible')).toBeVisible()

    const hasHorizontalOverflow = await page.locator('.app-layout').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('creates a channel from the sidebar and makes it selectable', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {},
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')
    await page.locator('.channel-create-btn[title="Create Channel"]').click()

    const modal = page.locator('.modal-create-channel')
    await expect(modal.getByRole('heading', { name: 'Create Channel' })).toBeVisible()
    await modal.getByPlaceholder('e.g. general').fill('raid-notes')
    await modal.locator('input[list="channel-category-suggestions"]').fill('PLANNING')
    await modal.getByPlaceholder('What is this channel for?').fill('Planning notes used by the smoke test.')
    await modal.getByRole('button', { name: 'Create Channel' }).click()

    await expect(modal).toBeHidden()
    const createdChannel = state.channelsByServerId[server.id].find((channel) => channel.name === 'raid-notes')
    expect(createdChannel).toBeTruthy()

    await page.locator('.channel-item', { hasText: 'raid-notes' }).click()
    await expect(page.locator('.chat-header .channel-title')).toHaveText('raid-notes')
    await expect(page.getByPlaceholder('Message #raid-notes')).toBeVisible()
  })

  test('keeps quick switcher navigation wired to channels and DMs', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const state = createMockCoreState({
      friends: buildFriends(4),
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {},
      dmChannels: [{
        id: 'dm-friend-01',
        peer_id: 'friend-01',
        peer_username: 'Friend 01',
        peer_avatar_url: null,
        peer_status: 'online',
        last_message_at: null,
        unread_count: 0,
      }],
      dmMessagesByChannelId: { 'dm-friend-01': [] },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')
    await page.getByTitle('Search servers, channels, and direct messages').click()
    await page.getByPlaceholder('Search servers, channels, and direct messages').fill('announcements')
    await page.getByRole('button', { name: /# announcements/ }).click()

    await expect(page).toHaveURL(/\/servers/)
    await expect(page.locator('.chat-header .channel-title')).toHaveText('announcements')

    await page.getByTitle('Search servers, channels, and direct messages').click()
    await page.getByPlaceholder('Search servers, channels, and direct messages').fill('Friend 01')
    await page.getByRole('button', { name: /Friend 01/ }).click()

    await expect(page).toHaveURL(/\/social\/dm/)
    await expect(page.getByPlaceholder('Message @Friend 01')).toBeVisible()
  })

  test('keeps message actions wired for edit, reaction, pin, search, and delete', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {
        [general.id]: [
          buildServerMessage(general.id, 'Remote searchable topic', { id: 'friend-message' }),
          buildServerMessage(general.id, 'Local editable note', {
            id: 'own-message',
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
    const ownRow = page.locator('[data-message-id="own-message"]')
    const friendRow = page.locator('[data-message-id="friend-message"]')
    await expect(ownRow).toBeVisible()
    await expect(friendRow).toBeVisible()

    await ownRow.hover()
    await ownRow.getByRole('button', { name: 'Edit' }).click()
    await ownRow.locator('input.home-search').fill('Edited local note')
    await ownRow.getByTitle('Save').click()
    await expect(page.getByText('Edited local note')).toBeVisible()
    expect(state.messagesByChannelId[general.id].some((message) => message.content === 'Edited local note')).toBe(true)

    await friendRow.hover()
    await friendRow.getByRole('button', { name: 'Add reaction' }).click()
    await page.getByRole('button', { name: 'thumbs up' }).click()
    await expect(friendRow.locator('.message-reaction-btn')).toContainText('👍')
    await expect(friendRow.locator('.message-reaction-btn')).toContainText('1')

    await friendRow.hover()
    await friendRow.getByRole('button', { name: 'Pin' }).click()
    await page.getByRole('button', { name: 'Pinned messages' }).click()
    await expect(page.locator('.chat-header-pinned-dropdown')).toContainText('Remote searchable topic')

    await page.getByRole('button', { name: 'Pinned messages' }).click()
    await page.getByRole('button', { name: 'Search in conversation' }).click()
    await page.getByRole('textbox', { name: 'Search messages' }).fill('Remote searchable')
    await expect(page.getByText('Remote searchable topic')).toBeVisible()
    await expect(page.getByText('Edited local note')).toBeHidden()
    await page.getByRole('button', { name: 'Close search' }).click()

    await ownRow.hover()
    await ownRow.getByRole('button', { name: 'Delete' }).click()
    const confirmModal = page.locator('.confirm-modal', { hasText: 'Delete message' })
    await confirmModal.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Edited local note')).toBeHidden()
    expect(state.messagesByChannelId[general.id].some((message) => message.id === 'own-message')).toBe(false)
  })

  test('keeps reactions below inline media and attachments', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const message = buildServerMessage(
      general.id,
      'Media order\n![gif](https://media.example.test/reaction.gif)',
      {
        id: 'media-reaction-message',
        attachments: [
          {
            url: 'https://cdn.example.test/screenshot.png',
            type: 'image/png',
            name: 'screenshot.png',
          },
        ],
        reactions: [{ emoji: '👍', count: 2, reacted: false }],
      }
    )
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: [message] },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')
    const row = page.locator('[data-message-id="media-reaction-message"]')
    await expect(row.locator('.message-reactions')).toBeVisible()
    await expect(row.locator('.dm-attachments')).toBeVisible()
    await expect(row.locator('.chat-inline-gif-link')).toBeVisible()
    await expect.poll(async () =>
      row.locator('.chat-inline-gif-link, .dm-attachments, .message-reactions').evaluateAll(
        (elements) => elements.map((element) => element.className)
      )
    ).toEqual(['chat-inline-gif-link', 'dm-attachments', 'message-reactions'])
  })

  test('opens Voice & Audio settings without overflowing the settings modal', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(3) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByRole('button', { name: 'Voice & Audio' }).click()
    const modal = page.locator('.user-settings-modal')
    await expect(modal).toHaveClass(/user-settings-modal--voice/)
    await expect(page.getByText('Audio devices')).toBeVisible()
    await expect(page.getByText('Microphone', { exact: true })).toBeVisible()
    await expect(page.getByText('Speaker')).toBeVisible()
    await expect(page.getByText('Input tuning')).toBeVisible()
    await expect(page.getByText('Noise suppression')).toBeVisible()
    await expect(page.getByText('Activation mode')).toBeVisible()
    await expect(page.getByText('Toggle microphone mute')).toBeVisible()
    await expect(page.getByText(/Works while this Voxpery tab is focused/)).toBeVisible()
    await page.getByRole('button', { name: 'Set shortcut' }).click()
    await page.keyboard.press('Control+Shift+M')
    await expect(modal.getByText(/^Ctrl\/Cmd\+Shift\+M\./)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rebind' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByText(/Not assigned/)).toBeVisible()

    const hasHorizontalOverflow = await modal.evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)

    await page.getByRole('button', { name: 'Done' }).click()
    await expect(modal).toBeHidden()
  })

  test('keeps the voice channel view usable when microphone access is unavailable', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const voice = channels.find((channel) => channel.channel_type === 'voice')
    if (!voice) throw new Error('Core voice channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {},
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')
    await page.locator('.channel-item', { hasText: voice.name }).click()

    await expect(page.locator('.chat-header .channel-title')).toHaveText(voice.name)
    await expect(page.locator('.voice-focus-panel-stage')).toBeVisible()
    await expect(page.locator('.channel-item.active', { hasText: voice.name })).toBeVisible()
    await expect(page.locator('.toast-item', { hasText: 'Microphone access required' })).toBeVisible()

    const hasHorizontalOverflow = await page.locator('.app-layout').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('keeps the mobile member sheet usable from a server channel', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {},
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 390, height: 760 })

    await page.goto('/servers')
    await expect(page.locator('.chat-header .channel-title')).toHaveText('general')
    await page.getByRole('button', { name: 'View members' }).click()

    const sheet = page.locator('.mobile-member-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'Members' })).toBeVisible()
    await expect(sheet).toContainText('2 members')
    await expect(sheet).toContainText('localuser')
    await expect(sheet).toContainText('Friend 01')

    const hasHorizontalOverflow = await page.locator('.shell-layout').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)

    await sheet.getByRole('button', { name: 'Close members panel' }).click()
    await expect(sheet).toBeHidden()
  })
})

async function expectScrollable(locator: Locator) {
  await expect.poll(async () => {
    return locator.evaluate((element) => element.scrollHeight > element.clientHeight)
  }).toBe(true)
}

async function expectVirtualMessageHeight(locator: Locator, expectedHeight: number) {
  await expect.poll(async () => {
    return locator.evaluate((element) => Math.round(element.getBoundingClientRect().height))
  }).toBe(expectedHeight)
}
