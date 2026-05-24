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
        [general.id]: [buildServerMessage(general.id, 'Pinned release note')],
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
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content === content)).toBe(true)

    await page.locator('.channel-item', { hasText: 'announcements' }).click()
    await expect(page.locator('.chat-header .channel-title')).toHaveText('announcements')
    await expect(page.getByText('Announcements stay visible')).toBeVisible()

    const hasHorizontalOverflow = await page.locator('.app-layout').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
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
    await expect(page.getByText('Microphone')).toBeVisible()
    await expect(page.getByText('Speaker')).toBeVisible()
    await expect(page.getByText('Input tuning')).toBeVisible()
    await expect(page.getByText('Noise suppression')).toBeVisible()
    await expect(page.getByText('Activation mode')).toBeVisible()

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
})

async function expectScrollable(locator: Locator) {
  await expect.poll(async () => {
    return locator.evaluate((element) => element.scrollHeight > element.clientHeight)
  }).toBe(true)
}
