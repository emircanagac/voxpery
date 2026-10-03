import { expect, test, type Locator } from '@playwright/test'
import { enableNotificationsFromSettings, installMockNotificationPermission } from './notification-prompt-fixture'
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
  test('opens Settings directly from the compact topbar and restores focus on dismissal', async ({ page }) => {
    const server = buildCoreServer()
    await installMockCoreApi(page, createMockCoreState({
      servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) },
    }))
    for (const width of [320, 390, 800]) {
      await page.setViewportSize({ width, height: width === 800 ? 600 : 844 })
      for (const path of ['/social', '/servers']) {
        await page.goto(path)
        const opener = page.getByRole('button', { name: 'Settings', exact: true })
        await expect(opener).toHaveCount(1)
        await expect(opener).toBeInViewport()
        await expectNoHorizontalOverflow(page.locator('.shell-topbar'))
        await opener.click()
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
        await expect(settings).toBeVisible()
        await expect(page.getByRole('dialog', { name: /Profile/ })).toHaveCount(0)
        await page.keyboard.press('Escape')
        await expect(settings).toHaveCount(0)
        await expect(opener).toBeFocused()
      }
    }
    await page.setViewportSize({ width: 1920, height: 1080 })
    await expect(page.locator('.left-bottom-panel').getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.locator('.shell-mobile-settings')).not.toBeVisible()
  })

  test('keeps Create and Join above the account dock with a long mobile server rail', async ({ page }) => {
    const servers = Array.from({ length: 20 }, (_, index) => buildCoreServer({
      id: `mobile-rail-${index}`, name: `Mobile Guild ${index}`, invite_code: `mobile-guild-${index}`,
    }))
    await installMockCoreApi(page, createMockCoreState({
      servers, channelsByServerId: { [servers[0].id]: buildCoreChannels(servers[0].id) },
    }))
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 800, height: 600 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport)
      for (const route of ['/social', '/servers']) {
        await page.goto(route)
        const dock = (await page.locator('.left-bottom-panel').boundingBox())!
        for (const name of ['Create Server', 'Join Server']) {
          const button = page.getByRole('button', { name, exact: true })
          await expect(button).toBeInViewport({ ratio: 1 })
          const box = (await button.boundingBox())!
          expect(box.y + box.height).toBeLessThanOrEqual(dock.y)
          await button.click()
          await expect(page.getByRole('dialog', { name: name === 'Create Server' ? 'Create a Server' : 'Join a Server', exact: true })).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(button).toBeFocused()
        }
        const scroller = page.locator('.server-sidebar-scroll')
        expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
        await scroller.evaluate(el => el.scrollTo(0, el.scrollHeight))
        await expect(page.getByRole('button', { name: 'Mobile Guild 19', exact: true })).toBeInViewport()
      }
    }
  })

  test('exposes public navigation on About and Compare without horizontal overflow', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState())
    for (const path of ['/about', '/compare']) {
      await page.goto(path)
      const toggle = page.getByRole('button', { name: 'Open navigation', exact: true })
      await toggle.click()
      const nav = page.getByRole('navigation', { name: 'Primary', exact: true })
      for (const name of ['Compare', 'Source', 'Contribute', 'Security']) {
        await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
      }
      await expect(nav.getByRole('link', { name: 'Releases', exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: /Download/ })).toHaveCount(0)
      await expectNoHorizontalOverflow(page.locator('.about-topbar'))
      await page.keyboard.press('Escape')
      await expect(toggle).toBeFocused()
      await expect(nav).not.toBeVisible()
      await toggle.click()
      await nav.getByRole('link', { name: 'Compare', exact: true }).click()
      await expect(page).toHaveURL(/\/compare$/)
      await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).not.toBeVisible()
    }
  })

  test('gives compact channel and DM search room for a query and keeps Close usable', async ({ page }) => {
    const server = buildCoreServer()
    await installMockCoreApi(page, createMockCoreState({
      servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) }, friends: buildFriends(1),
    }))
    await page.setViewportSize({ width: 390, height: 844 })
    for (const path of ['/servers', '/social']) {
      await page.goto(path)
      if (path === '/social') await page.getByRole('button', { name: 'Message Friend 01', exact: true }).click()
      await page.getByRole('button', { name: 'Search in conversation', exact: true }).click()
      const input = page.getByRole('textbox', { name: 'Search messages', exact: true })
      await input.fill('A useful search query')
      expect((await input.boundingBox())!.width).toBeGreaterThan(200)
      await expect(page.getByRole('button', { name: 'Close search', exact: true })).toBeInViewport()
      await expectNoHorizontalOverflow(page.locator('.chat-header--searching'))
      await page.getByRole('button', { name: 'Close search', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Search in conversation', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Search in conversation', exact: true })).toBeFocused()
    }
  })

  test('keeps mobile chat stable and requests notification permission only from Settings', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')!
    await installMockCoreApi(page, createMockCoreState({
      servers: [server], channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: [buildServerMessage(general.id, 'Mobile notification test message')] },
    }))
    await installMockNotificationPermission(page)
    await page.goto('/servers')
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toBeVisible()
    const headerBefore = await page.locator('.chat-header').boundingBox()
    await page.clock.fastForward(120_001)
    await expect(page.getByRole('region', { name: 'Enable notifications' })).toHaveCount(0)
    expect(await page.locator('.chat-header').boundingBox()).toEqual(headerBefore)
    await page.getByRole('button', { name: 'Search in conversation' }).click()
    await expect(page.getByRole('region', { name: 'Enable notifications' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Close search' }).click()
    await composer.fill('Mobile composer remains usable')
    await expect(composer).toBeInViewport()
    await page.screenshot({ path: 'test-results/notification-prompt-mobile.png' })
    expect(await page.evaluate(() => Reflect.get(window, '__notificationRequests'))).toBe(0)
    await enableNotificationsFromSettings(page)
    await expect(page.getByRole('region', { name: 'Enable notifications' })).toHaveCount(0)
    expect(await page.evaluate(() => Reflect.get(window, '__notificationRequests'))).toBe(1)
    expect(await page.evaluate(() => localStorage.getItem('voxpery-settings-push-enabled'))).toBe('1')
    expect(await page.evaluate(() => localStorage.getItem('voxpery-settings-push-explicit'))).toBe('1')
  })

  test('keeps hosted legal pages touch-scrollable on a phone viewport', async ({ page }) => {
    for (const path of ['/privacy', '/terms', '/kvkk']) {
      await page.goto(path)

      const scrollRegion = page.locator('.legal-page')
      await expect(scrollRegion).toBeVisible()
      await expectScrollable(scrollRegion)
      await expect.poll(async () => scrollRegion.evaluate((element) => (
        getComputedStyle(element).touchAction.includes('pan-y')
      ))).toBe(true)

      await scrollRegion.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
      await expect.poll(async () => scrollRegion.evaluate((element) => (
        element.scrollTop + element.clientHeight >= element.scrollHeight - 1
      ))).toBe(true)
    }
  })

  test('keeps theme settings usable and persistent on a phone viewport', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(3) })
    await installMockCoreApi(page, state)
    await page.addInitScript(() => {
      localStorage.setItem('voxpery-settings-theme', 'light')
    })

    await page.goto('/social')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'View my profile', exact: true }).click()
    await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
    const modal = page.locator('.user-settings-modal')
    await modal.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    const profileHeader = await modal.locator('.user-settings-header').boundingBox()
    const profileFooter = await modal.locator('.user-settings-footer').boundingBox()
    await page.getByRole('combobox', { name: 'Settings section', exact: true }).selectOption('appearance')
    const appearanceHeader = await modal.locator('.user-settings-header').boundingBox()
    const appearanceFooter = await modal.locator('.user-settings-footer').boundingBox()
    expect(appearanceHeader?.y).toBeCloseTo(profileHeader!.y, 0)
    expect(appearanceHeader?.height).toBeCloseTo(profileHeader!.height, 0)
    expect(appearanceFooter?.y).toBeCloseTo(profileFooter!.y, 0)
    expect(appearanceFooter?.height).toBeCloseTo(profileFooter!.height, 0)
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
    await expect(page.locator('.support-dock')).not.toBeVisible()
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
    await expect(page.getByRole('button', { name: /^Add Friend/ })).toBeVisible()
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))

    await page.getByRole('button', { name: /All/ }).click()
    const friendsScroller = page.locator('.home-friends-scroll').first()
    await expectScrollable(friendsScroller)
    await friendsScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Friend 24')).toBeVisible()
    await expect(page.getByRole('button', { name: 'More actions for Friend 24' })).toBeVisible()

    await page.getByRole('button', { name: 'Message Friend 24' }).click()
    await expect(page).toHaveURL(/\/social\/dm/)
    await expect(page.getByPlaceholder('Message', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))

    await page.goto('/social')
    await page.getByRole('button', { name: /^Add Friend/ }).click()
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
          buildServerMessage(general.id, 'Mobile consecutive reaction two', {
            id: 'mobile-reaction-two',
            created_at: new Date(Date.now() + 1_000).toISOString(),
            reactions: [{ emoji: '🎉', count: 1, reacted: false }],
          }),
          buildServerMessage(general.id, 'Mobile consecutive reaction three', {
            id: 'mobile-reaction-three',
            created_at: new Date(Date.now() + 2_000).toISOString(),
            reactions: [{ emoji: '❤️', count: 1, reacted: false }],
          }),
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
    await expect(page.getByRole('button', { name: 'Emoji, GIFs and stickers' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse GIFs' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse stickers' })).not.toBeVisible()
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))

    await page.getByRole('button', { name: 'Emoji, GIFs and stickers' }).click()
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
    await expect(page.getByRole('group', { name: 'Emoji categories' }).getByRole('button')).toHaveCount(10)
    await expect.poll(async () => page.locator('.chat-emoji-grid').evaluate((element) => (
      getComputedStyle(element).gridTemplateColumns.split(' ').every(width => parseFloat(width) >= 34)
    ))).toBe(true)
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
    await page.getByRole('button', { name: 'thumbs up' }).click()
    await expect(mediaRow.locator('.message-reaction-btn')).toContainText('2')
    await expect.poll(async () =>
      mediaRow.locator('.chat-inline-gif-link, .dm-attachments, .message-reactions').evaluateAll(
        (elements) => elements.map((element) => element.className)
      )
    ).toEqual(['chat-inline-gif-link', 'dm-attachments', 'message-reactions'])
    const consecutiveReactionIds = [
      'mobile-media-reaction-message',
      'mobile-reaction-two',
      'mobile-reaction-three',
    ]
    const reactionBounds = await Promise.all(consecutiveReactionIds.map((messageId) =>
      page.locator(`[data-message-id="${messageId}"]`).boundingBox()
    ))
    expect(reactionBounds.every(Boolean)).toBe(true)
    expect(reactionBounds[0]!.y + reactionBounds[0]!.height).toBeLessThanOrEqual(reactionBounds[1]!.y + 1)
    expect(reactionBounds[1]!.y + reactionBounds[1]!.height).toBeLessThanOrEqual(reactionBounds[2]!.y + 1)

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
    const firstSentRow = page.locator('.virtual-list-item', { hasText: content })
    const continuationRow = page.locator('.virtual-list-item', { hasText: continuation })
    await expect.poll(async () => continuationRow.evaluate((element) => {
      const text = element.querySelector('.message-text')?.getBoundingClientRect()
      const row = element.getBoundingClientRect()
      return !!text && text.top >= row.top - 1 && text.bottom <= row.bottom + 1
    })).toBe(true)
    await expect.poll(async () => {
      const firstSentBounds = await firstSentRow.boundingBox()
      const continuationBounds = await continuationRow.boundingBox()
      if (!firstSentBounds || !continuationBounds) return false
      return firstSentBounds.y + firstSentBounds.height <= continuationBounds.y + 1
    }).toBe(true)
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content === continuation)).toBe(true)

    await page.getByRole('button', { name: 'View members' }).click()
    const sheet = page.locator('.mobile-member-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('role', 'dialog')
    await expect(sheet.getByRole('heading', { name: 'Members' })).toBeVisible()
    await expect(sheet).toContainText('localuser')
    await expect(sheet).toContainText('Friend 01')
    await expectNoHorizontalOverflow(page.locator('.shell-layout'))
    await expect(sheet.getByRole('button', { name: 'Close members panel' })).toBeFocused()
    await expect(page.locator('.sidebar-resizer')).toHaveCount(0)
    const member = sheet.getByRole('button', { name: 'View profile for Friend 01' })
    await member.focus()
    await member.press('Shift+F10')
    const memberMenu = page.getByRole('menu', { name: 'Actions for Friend 01' })
    await expect(memberMenu).toBeVisible()
    expect(await memberMenu.evaluate(el => el.parentElement === document.body)).toBe(true)
    await expectNoHorizontalOverflow(memberMenu)
    await page.keyboard.press('Escape')
    await expect(memberMenu).toHaveCount(0)
    await expect(sheet).toBeVisible()
    await expect(member).toBeFocused()
    await member.press('Enter')
    const profile = page.getByRole('dialog', { name: 'Friend 01' })
    await expect(profile).toBeVisible()
    await expect(profile.locator('.member-profile-avatar')).toHaveCSS('width', '64px')
    await expectNoHorizontalOverflow(profile)
    await page.keyboard.press('Escape')
    await expect(profile).toHaveCount(0)
    await expect(sheet).toBeVisible()
    await expect(member).toBeFocused()
    await page.keyboard.press('Escape')
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

async function expectNoHorizontalOverflow(locator: Locator) {
  await expect.poll(async () => {
    return locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
  }).toBe(true)
}
