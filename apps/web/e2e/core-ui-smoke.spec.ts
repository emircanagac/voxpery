import { expect, test, type Locator, type Page } from '@playwright/test'
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
    await expect(page.locator('.feedback-dock .feedback-card').getByRole('heading', { name: 'Share feedback on GitHub' })).toBeVisible()

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

  test('keeps the expression picker wide, persistent, and free of GIF cropping', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: [] },
    })
    await installMockCoreApi(page, state)
    await page.route('https://media.giphy.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
    }))
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/servers')

    await page.getByRole('button', { name: 'Browse GIFs' }).click()
    const picker = page.locator('.chat-emoji-picker')
    await expect(picker).toBeVisible()
    await expect.poll(async () => picker.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(420)
    await expect.poll(async () => page.evaluate(() => {
      const pickerRect = document.querySelector('.chat-emoji-picker')?.getBoundingClientRect()
      const chatRect = document.querySelector('.chat-area')?.getBoundingClientRect()
      const inputRect = document.querySelector('.message-input-wrapper')?.getBoundingClientRect()
      if (!pickerRect || !chatRect || !inputRect) return false
      return pickerRect.left >= chatRect.left + 7
        && pickerRect.right <= chatRect.right - 7
        && pickerRect.top >= chatRect.top + 7
        && pickerRect.bottom <= inputRect.top + 1
    })).toBe(true)
    await expect.poll(async () => page.locator('.chat-gif-grid').evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        display: style.display,
        columns: style.gridTemplateColumns.split(' ').length,
        masonryColumns: element.querySelectorAll('.chat-gif-column').length,
        overflowsHorizontally: element.scrollWidth > element.clientWidth + 1,
      }
    })).toEqual({ display: 'grid', columns: 2, masonryColumns: 2, overflowsHorizontally: false })

    await page.getByRole('button', { name: 'Add Celebration to favorites' }).click()
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Send Celebration' })).toBeVisible()
    await page.getByRole('button', { name: 'Send Celebration' }).click()

    const sentGif = page.locator('.chat-inline-gif').last()
    await expect(sentGif).toBeVisible()
    await expect.poll(async () => sentGif.evaluate((element) => {
      const style = window.getComputedStyle(element)
      return { fit: style.objectFit, usesNaturalRatio: style.aspectRatio.startsWith('auto') }
    })).toEqual({ fit: 'contain', usesNaturalRatio: true })
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content.startsWith('![gif]('))).toBe(true)

    await page.getByRole('button', { name: 'Insert emoji' }).click()
    await expect(page.getByRole('tablist', { name: 'Emoji categories' }).getByRole('button')).toHaveCount(10)
    await expect.poll(async () => page.locator('.chat-emoji-grid').evaluate((element) => (
      getComputedStyle(element).gridTemplateColumns.split(' ').length
    ))).toBe(10)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Browse GIFs' }).click()
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove Celebration from favorites' })).toBeVisible()

    await page.getByRole('tab', { name: 'Sticker' }).click()
    const stickerCollections = page.getByRole('tablist', { name: 'Sticker collections' })
    await expect(stickerCollections.getByRole('button')).toHaveCount(3)
    await expect(stickerCollections.getByRole('button').allTextContents()).resolves.toEqual(['Browse', 'Recent', 'Favorites'])
  })

  test('keeps first-message text fixed while optimistic delivery is confirmed', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: [] },
      serverMessageSendDelayMs: 300,
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/servers')
    await expect(page.locator('.chat-header .channel-title')).toHaveText('general')
    const content = `Delayed first message ${Date.now()}`
    await startMessageGeometrySampling(page, content)
    const messageInput = page.getByPlaceholder('Message #general')
    await messageInput.fill(content)
    await messageInput.press('Enter')

    const messageRow = page.locator('.virtual-list-item', { hasText: content })
    await expect(messageRow).toBeVisible()
    await expect(messageRow.locator('.message-inline-actions')).toBeAttached()
    await page.waitForTimeout(400)
    const samples = await readMessageGeometrySamples(page)
    expect(samples.length).toBeGreaterThan(1)
    expect(samples.some((sample) => !sample.hasActions)).toBe(true)
    expect(samples.some((sample) => sample.hasActions)).toBe(true)
    expect(geometryRange(samples, 'avatarY')).toBeLessThan(0.25)
    expect(geometryRange(samples, 'authorY')).toBeLessThan(0.25)
    expect(geometryRange(samples, 'bodyY')).toBeLessThan(0.25)
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
    await page.getByRole('button', { name: 'Create channel in GENERAL' }).click()

    const modal = page.locator('.modal-create-channel')
    await expect(modal.getByRole('heading', { name: 'Create Channel' })).toBeVisible()
    await modal.getByPlaceholder('e.g. general').fill('raid-notes')
    await expect(modal.locator('input[list="channel-category-suggestions"]')).toHaveValue('GENERAL')
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
        pinned_at: null,
        is_pinned: false,
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

type MessageGeometrySample = {
  avatarY: number
  authorY: number
  bodyY: number
  hasActions: boolean
}

async function startMessageGeometrySampling(page: Page, messageText: string) {
  await page.evaluate((targetMessageText) => {
    const samples: MessageGeometrySample[] = []
    Object.defineProperty(window, '__messageGeometrySamples', {
      configurable: true,
      value: samples,
    })
    let frame = 0
    const sample = () => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'))
        .find((candidate) => candidate.querySelector('.message-text')?.textContent === targetMessageText)
      const avatar = row?.querySelector<HTMLElement>('.message-avatar')
      const author = row?.querySelector<HTMLElement>('.message-author')
      const body = row?.querySelector<HTMLElement>('.message-text')
      if (avatar && author && body) {
        samples.push({
          avatarY: avatar.getBoundingClientRect().y,
          authorY: author.getBoundingClientRect().y,
          bodyY: body.getBoundingClientRect().y,
          hasActions: !!row?.querySelector('.message-inline-actions'),
        })
      }
      frame += 1
      if (frame < 60) window.requestAnimationFrame(sample)
    }
    window.requestAnimationFrame(sample)
  }, messageText)
}

async function readMessageGeometrySamples(page: Page): Promise<MessageGeometrySample[]> {
  return page.evaluate(() => {
    return (window as typeof window & {
      __messageGeometrySamples?: MessageGeometrySample[]
    }).__messageGeometrySamples ?? []
  })
}

function geometryRange(samples: MessageGeometrySample[], key: 'avatarY' | 'authorY' | 'bodyY') {
  const values = samples.map((sample) => sample[key])
  return Math.max(...values) - Math.min(...values)
}

async function expectVirtualMessageHeight(locator: Locator, expectedHeight: number) {
  await expect.poll(async () => {
    return locator.evaluate((element) => Math.round(element.getBoundingClientRect().height))
  }).toBe(expectedHeight)
}
