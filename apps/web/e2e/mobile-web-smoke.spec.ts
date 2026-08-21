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
  test('keeps theme settings usable and persistent on a phone viewport', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(3) })
    await installMockCoreApi(page, state)
    await page.addInitScript(() => {
      localStorage.setItem('voxpery-settings-theme', 'light')
    })

    await page.goto('/social')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()

    const modal = page.locator('.user-settings-modal')
    await expect(modal.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    await expectNoHorizontalOverflow(modal)
    await modal.locator('.theme-option', { hasText: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await modal.getByRole('button', { name: /Custom/ }).click()
    const customThemeInput = modal.getByRole('textbox', { name: 'Custom theme hex color' })
    await customThemeInput.fill('#c9578f')
    await customThemeInput.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme-mode', 'dark')
    await modal.getByRole('button', { name: 'Use Emerald accent' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-custom-accent', 'true')
    await expect(modal.getByText('Background style', { exact: true })).toHaveCount(0)
    await expectNoHorizontalOverflow(modal)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-custom-accent', 'true')
    await expect(page.locator('.feedback-dock')).not.toBeVisible()
  })

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
    const friendsScroller = page.locator('.home-friends-scroll').first()
    await expectScrollable(friendsScroller)
    await friendsScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Friend 24')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open DM with Friend 24' })).toBeVisible()

    await page.getByRole('button', { name: 'Open DM with Friend 24' }).click()
    await expect(page).toHaveURL(/\/social\/dm/)
    await expect(page.getByPlaceholder('Message', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))

    await page.goto('/social')
    await page.getByRole('button', { name: /Requests/ }).click()
    const requestsScroller = page.locator('.home-friends-scroll--requests')
    await expectScrollable(requestsScroller)
    await requestsScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Request Out 18')).toBeVisible()
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))
  })

  test('keeps server channel chat, composer, and mobile member sheet usable', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')
    general.name = 'general-community-updates-and-announcements'

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
              created_at: new Date().toISOString(),
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

    const channelTitle = page.locator('.chat-header .channel-title')
    await expect(channelTitle).toHaveText('general-community-updates-and-announcements')
    await expect.poll(async () => channelTitle.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.textOverflow === 'ellipsis'
        && style.whiteSpace === 'nowrap'
        && element.scrollWidth > element.clientWidth
    })).toBe(true)
    await expect(page.getByText('Mobile smoke baseline message')).toBeVisible()
    await expect(page.locator('.dm-attach-btn[title="Attach files"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Insert emoji' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse GIFs' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse stickers' })).not.toBeVisible()
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))

    await page.getByRole('button', { name: 'Insert emoji' }).click()
    const expressionPicker = page.locator('.chat-emoji-picker')
    await expect(expressionPicker).toBeVisible()
    await expectNoHorizontalOverflow(expressionPicker)
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
    await expressionPicker.getByRole('tab', { name: 'GIF' }).click()
    await expect.poll(async () => page.locator('.chat-gif-grid').evaluate((element) => (
      element.scrollWidth <= element.clientWidth + 1
    ))).toBe(true)
    await expressionPicker.getByRole('tab', { name: 'Emoji' }).click()
    await expect(page.getByRole('tablist', { name: 'Emoji categories' }).getByRole('button')).toHaveCount(10)
    await expect.poll(async () => page.locator('.chat-emoji-grid').evaluate((element) => (
      getComputedStyle(element).gridTemplateColumns.split(' ').length
    ))).toBe(8)
    await page.keyboard.press('Escape')

    const mediaRow = page.locator('[data-message-id="mobile-media-reaction-message"]')
    await expect(mediaRow.locator('.message-reactions')).toBeVisible()
    await mediaRow.getByRole('button', { name: 'More message actions' }).click()
    const mobileActionsMenu = page.getByRole('menu', { name: 'Message actions' })
    await expect(mobileActionsMenu).toBeVisible()
    expect(await mobileActionsMenu.evaluate((element) => element.parentElement === document.body)).toBe(true)
    await expect.poll(async () => mobileActionsMenu.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0
        && rect.top >= 0
        && rect.right <= window.innerWidth
        && rect.bottom <= window.innerHeight
    })).toBe(true)
    await mobileActionsMenu.getByRole('menuitem', { name: 'Add reaction' }).click()
    await expect(page.locator('.message-reaction-picker-portal')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(async () =>
      mediaRow.locator('.chat-inline-gif-link, .dm-attachments, .message-reactions').evaluateAll(
        (elements) => elements.map((element) => element.className)
      )
    ).toEqual(['chat-inline-gif-link', 'dm-attachments', 'message-reactions'])

    const content = `Mobile smoke message ${Date.now()}`
    const messageInput = page.getByPlaceholder('Message', { exact: true })
    await messageInput.fill(content)
    await messageInput.press('Enter')
    await expect(page.getByText(content)).toBeVisible()
    await expectVirtualMessageHeight(page.locator('.virtual-list-item', { hasText: content }), 44)
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content === content)).toBe(true)

    const continuation = `Mobile smoke continuation ${Date.now()}`
    await messageInput.fill(continuation)
    await messageInput.press('Enter')
    await expect(page.getByText(continuation)).toBeVisible()
    await expectVirtualMessageHeight(page.locator('.virtual-list-item', { hasText: continuation }), 23)
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content === continuation)).toBe(true)

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

async function expectVirtualMessageHeight(locator: Locator, expectedHeight: number) {
  await expect.poll(async () => {
    return locator.evaluate((element) => Math.round(element.getBoundingClientRect().height))
  }).toBe(expectedHeight)
}

async function expectNoHorizontalOverflow(locator: Locator) {
  await expect.poll(async () => {
    return locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
  }).toBe(true)
}
