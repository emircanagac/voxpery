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

test.describe('mocked mobile web smoke', () => {
  test('keeps Social friends, requests, and DM entry usable on a phone viewport', async ({ page }) => {
    const state = createMockCoreState({
      friends: buildFriends(24),
      incomingRequests: buildRequests(18, 'incoming'),
      outgoingRequests: buildRequests(18, 'outgoing'),
    })
    await installMockCoreApi(page, state)

    await page.goto('/social')

    await expect(page.getByRole('button', { name: /Online/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /All/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Requests/ })).toBeVisible()
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))

    await page.getByRole('button', { name: /All/ }).click()
    const homeScroller = page.locator('.home-main').first()
    await expectScrollable(homeScroller)
    await homeScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Friend 24')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open DM with Friend 24' })).toBeVisible()

    await page.getByRole('button', { name: 'Open DM with Friend 24' }).click()
    await expect(page).toHaveURL(/\/social\/dm/)
    await expect(page.getByPlaceholder('Message @Friend 24')).toBeVisible()
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))

    await page.goto('/social')
    await page.getByRole('button', { name: /Requests/ }).click()
    await expectScrollable(homeScroller)
    await homeScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Request Out 18')).toBeVisible()
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))
  })

  test('keeps server channel chat, composer, and mobile member sheet usable', async ({ page }) => {
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
          buildServerMessage(
            general.id,
            'Mobile smoke baseline message\n![gif](https://media.example.test/mobile.gif)',
            {
              id: 'mobile-media-reaction-message',
              attachments: [
                {
                  url: 'https://cdn.example.test/mobile.png',
                  type: 'image/png',
                  name: 'mobile.png',
                },
              ],
              reactions: [{ emoji: '👍', count: 1, reacted: false }],
            }
          ),
        ],
      },
    })
    await installMockCoreApi(page, state)

    await page.goto('/servers')

    await expect(page.locator('.chat-header .channel-title')).toHaveText('general')
    await expect(page.getByText('Mobile smoke baseline message')).toBeVisible()
    await expect(page.locator('.dm-attach-btn[title="Attach files"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Insert emoji' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse GIFs' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse stickers' })).toBeVisible()
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))

    const mediaRow = page.locator('[data-message-id="mobile-media-reaction-message"]')
    await expect(mediaRow.locator('.message-reactions')).toBeVisible()
    await expect.poll(async () =>
      mediaRow.locator('.chat-inline-gif-link, .dm-attachments, .message-reactions').evaluateAll(
        (elements) => elements.map((element) => element.className)
      )
    ).toEqual(['chat-inline-gif-link', 'dm-attachments', 'message-reactions'])

    const content = `Mobile smoke message ${Date.now()}`
    const messageInput = page.getByPlaceholder('Message #general')
    await messageInput.fill(content)
    await messageInput.press('Enter')
    await expect(page.getByText(content)).toBeVisible()
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content === content)).toBe(true)

    await page.getByRole('button', { name: 'View members' }).click()
    const sheet = page.locator('.mobile-member-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'Members' })).toBeVisible()
    await expect(sheet).toContainText('localuser')
    await expect(sheet).toContainText('Friend 01')
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))
  })
})

async function expectScrollable(locator: Locator) {
  await expect.poll(async () => {
    return locator.evaluate((element) => element.scrollHeight > element.clientHeight)
  }).toBe(true)
}

async function expectNoHorizontalOverflow(locator: Locator) {
  await expect.poll(async () => {
    return locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
  }).toBe(true)
}
