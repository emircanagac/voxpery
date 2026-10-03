import { expect, test } from '@playwright/test'
import {
  buildFriends,
  buildRequests,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

test.describe('mocked social friend UI regressions', () => {
  for (const scenario of [{ width: 1920, theme: 'dark' }, { width: 1024, theme: 'light' },
    { width: 390, theme: 'dark' }, { width: 320, theme: 'light' }]) {
    test(`shows clear Send Request states at ${scenario.width}px in ${scenario.theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: scenario.width, height: 844 })
      await page.addInitScript(theme => localStorage.setItem('voxpery-settings-theme', theme), scenario.theme)
      await installMockCoreApi(page, createMockCoreState())
      const submissions: string[] = []
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/friends/requests') submissions.push(request.postData() ?? '')
      })
      await page.goto('/social')
      await page.getByRole('button', { name: /^Add Friend/ }).click()
      const input = page.getByRole('textbox', { name: 'Friend username' })
      const button = page.getByRole('button', { name: 'Send Request', exact: true })
      await expect(button).toBeDisabled()
      await expect(button).toHaveCSS('cursor', 'not-allowed')
      await expect(button).toHaveCSS('font-family', await input.evaluate(el => getComputedStyle(el).fontFamily))
      await expect(button).toHaveCSS('height', '40px')
      await expect(input).toHaveCSS('height', '40px')
      const disabledBackground = await button.evaluate(el => getComputedStyle(el).backgroundColor)
      await input.press('Enter')
      await input.fill('   ')
      await input.press('Enter')
      await expect(button).toBeDisabled()
      expect(submissions).toEqual([])
      await page.screenshot({ path: testInfo.outputPath(`send-request-disabled-${scenario.width}.png`) })
      await input.fill('newfriend')
      await expect(button).toBeEnabled()
      expect(await button.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(disabledBackground)
      await expect(button.locator('svg')).toHaveCount(1)
      expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(await page.locator('.social-content--friends').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`send-request-enabled-${scenario.width}.png`) })
      await button.click()
      await expect(page.getByRole('status').filter({ hasText: 'Friend request sent.' })).toBeVisible()
      expect(submissions).toHaveLength(1)
      await expect(button).toBeDisabled()
    })
  }

  for (const theme of ['Dark', 'Light', 'Custom Light']) {
    test(`keeps a single photo friend compact in ${theme}`, async ({ page }, testInfo) => {
      await installMockCoreApi(page, createMockCoreState({ friends: [{ ...buildFriends(1)[0], avatar_url: '/pwa-192.png' }] }))
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.goto('/social')
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      await page.locator('.user-settings-modal .theme-option', { hasText: theme === 'Custom Light' ? 'Light' : theme }).click()
      if (theme === 'Custom Light') {
        await page.locator('.user-settings-modal .theme-option', { hasText: 'Custom' }).click()
        const color = page.getByRole('textbox', { name: 'Custom theme hex color' })
        await color.fill('#00a896')
        await color.press('Enter')
        await expect(page.locator('html')).toHaveAttribute('data-custom-theme-mode', 'light')
      }
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      const main = page.locator('.social-content--friends')
      const row = main.locator('.home-member-row')
      await expect(row).toHaveCount(1)
      await expect.poll(() => row.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
      await expect(row).toHaveCSS('background-image', 'none')
      await expect(row).toHaveCSS('box-shadow', 'none')
      await expect(main.locator('.home-list-group')).toHaveCSS('border-top-width', '0px')
      expect((await row.boundingBox())!.height).toBe(72)
      await page.keyboard.press('Tab')
      await main.getByRole('button', { name: 'Send a message to Friend 01' }).focus()
      await expect(main.getByRole('button', { name: 'Send a message to Friend 01' })).toHaveCSS('outline-style', 'solid')
      for (const width of [1920, 390]) {
        await page.setViewportSize({ width, height: width === 1920 ? 1080 : 844 })
        const backdrop = page.getByRole('button', { name: 'Close social sidebar', exact: true })
        if (await backdrop.isVisible()) await backdrop.click()
        if (width < 1024) {
          await expect.poll(async () => {
            const sidebar = (await page.locator('.social-sidebar').boundingBox())!
            const rail = (await page.locator('.unified-sidebar').boundingBox())!
            return sidebar.x + sidebar.width <= rail.x + rail.width + 1
          }).toBe(true)
        }
        await expect(main.getByRole('button', { name: 'Send a message to Friend 01' })).toBeInViewport()
        expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`friends-single-${theme}-${width}.png`) })
      }
    })
  }

  test('keeps request actions reachable in a short 320px viewport', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 })
    const incoming = buildRequests(20, 'incoming')
    incoming[0].requester_username = 'A long incoming username that must not overlap Accept or Reject'
    await installMockCoreApi(page, createMockCoreState({ incomingRequests: incoming, outgoingRequests: buildRequests(20, 'outgoing') }))
    await page.goto('/social')
    await page.getByRole('button', { name: /^Add Friend/ }).click()
    const main = page.locator('.social-content--friends')
    expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    expect(await main.locator('.home-chip-label').evaluateAll(labels => labels.every(el => el.scrollWidth <= el.clientWidth))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('friends-requests-320.png') })
    const cancel = main.getByRole('button', { name: 'Cancel request to Request Out 20', exact: true })
    await cancel.scrollIntoViewIfNeeded()
    await expect(cancel).toBeInViewport()
    await cancel.click()
    await expect(cancel).toBeHidden()
    await expect(main.getByRole('searchbox', { name: 'Search requests' })).toBeInViewport()
  })

  for (const width of [1920, 1100, 390, 320]) {
    test(`keeps the Friends toolbar stable and rows reachable at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width < 1024 ? 640 : 900 })
      const friends = buildFriends(32)
      friends[0].username = 'A very long friend username that must not overlap the actions'
      friends[1].status = 'offline'
      await installMockCoreApi(page, createMockCoreState({ friends }))
      await page.goto('/social')
      const main = page.locator('.social-content--friends')
      await expect(main.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible()
      await main.getByRole('button', { name: 'All', exact: true }).click()
      await expect(main.locator('.home-member-row')).toHaveCount(32)
      expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      const search = main.getByRole('searchbox', { name: 'Search friends' })
      const before = (await search.boundingBox())!
      const last = main.locator('.home-member-row').last()
      await last.scrollIntoViewIfNeeded()
      await expect(last).toBeInViewport()
      expect((await search.boundingBox())!.y).toBe(before.y)
      await search.fill('FRIEND 02')
      await expect(main.getByRole('button', { name: 'Message Friend 02', exact: true })).toBeVisible()
      await expect(main.locator('.home-member-row')).toHaveCount(1)
      await main.getByRole('button', { name: 'Online', exact: true }).click()
      await expect(main.getByRole('heading', { name: 'No matching friends' })).toBeVisible()
      await search.press('Escape')
      await expect(search).toHaveValue('')
      await expect(main.getByRole('button', { name: 'Online', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.screenshot({ path: testInfo.outputPath(`friends-${width}.png`) })
      await main.getByRole('button', { name: 'Send a message to Friend 03', exact: true }).click()
      await expect(page.getByPlaceholder(width < 1024 ? 'Message' : 'Message @Friend 03', { exact: true })).toBeVisible()
    })
  }

  test('searches both request lists and sends with Enter from Add friend', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState({ incomingRequests: buildRequests(2, 'incoming'), outgoingRequests: buildRequests(2, 'outgoing') }))
    await page.goto('/social')
    await page.getByRole('button', { name: /^Add Friend/ }).click()
    const input = page.getByRole('textbox', { name: 'Friend username' })
    await expect(input).toBeFocused()
    const search = page.getByRole('searchbox', { name: 'Search requests' })
    await search.fill('  02  ')
    await expect(page.locator('.home-request-row')).toHaveCount(2)
    await expect(page.getByText('Request In 01', { exact: true })).toBeHidden()
    await expect(page.getByText('Request Out 02', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^Add Friend/ }).click()
    await expect(search).toHaveValue('')
    await expect(input).toBeFocused()
    await input.fill('newfriend')
    await input.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: 'Friend request sent.' })).toBeVisible()
    await expect(page.getByText('newfriend', { exact: true })).toBeVisible()
  })

  for (const width of [1920, 390]) {
    test(`keeps grouped DM rows compact and scrollable at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 1920 ? 1080 : 844 })
      const channels = Array.from({ length: 32 }, (_, index) => ({
        id: `dm-layout-${index}`, peer_id: `peer-layout-${index}`,
        peer_username: index === 0 ? 'A very long pinned username that must stay inside the sidebar' : `Contact ${index}`,
        peer_avatar_url: null, peer_status: 'online', last_message_at: null,
        unread_count: index === 0 ? 12 : 0,
        pinned_at: index === 0 ? '2026-10-01T12:00:00Z' : null, is_pinned: index === 0,
      }))
      await installMockCoreApi(page, createMockCoreState({ dmChannels: channels }))
      await page.goto('/social')
      if (width < 1024) await page.getByRole('link', { name: 'Social', exact: true }).click()
      const sidebar = page.locator('.social-sidebar')
      await expect(sidebar.getByRole('heading', { name: 'Direct Messages', exact: true })).toBeVisible()
      await expect(sidebar.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible()
      await expect(sidebar.getByRole('heading', { name: 'Recent', exact: true })).toBeVisible()
      const row = sidebar.locator('.social-dm-item').first()
      expect((await row.boundingBox())!.height).toBe(46)
      const hide = row.getByRole('button', { name: /^Hide DM with/ })
      if (width === 1920) {
        await page.locator('.social-sidebar-header').hover()
        await expect(hide).toHaveCSS('opacity', '0')
        await row.hover()
      }
      await expect(hide).toHaveCSS('opacity', '1')
      await expect(hide).toHaveCSS('pointer-events', 'auto')
      expect(await row.evaluate(element => {
        const rowBounds = element.getBoundingClientRect()
        const hideBounds = element.querySelector('.social-dm-close')!.getBoundingClientRect()
        return hideBounds.right <= rowBounds.right + 1
      })).toBe(true)
      await row.locator('.social-dm-open').focus()
      await page.keyboard.press('Tab')
      await expect(hide).toBeFocused()
      await expect(hide).toHaveCSS('outline-style', 'solid')
      await sidebar.screenshot({ path: testInfo.outputPath('social-dock.png') })
      await expect(sidebar.locator('.social-sidebar-title')).toHaveText('Direct Messages')
      const header = (await sidebar.locator('.social-sidebar-header').boundingBox())!
      const friends = (await sidebar.getByRole('button', { name: 'Friends', exact: true }).boundingBox())!
      expect(friends.y - (header.y + header.height)).toBeGreaterThanOrEqual(8)
      expect(await sidebar.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight > el.clientHeight)).toBe(true)
      const last = sidebar.getByRole('button', { name: 'Open DM with Contact 31', exact: true })
      await last.scrollIntoViewIfNeeded()
      await expect(last).toBeInViewport()
      await last.click()
      if (width < 1024) await page.getByRole('link', { name: 'Social', exact: true }).click()
      await expect(last).toHaveAttribute('aria-current', 'page')
      await last.click({ button: 'right' })
      await expect(page.getByRole('menuitem', { name: 'Pin Conversation' })).toBeVisible()
      await page.keyboard.press('Escape')
      const lastHide = sidebar.getByRole('button', { name: 'Hide DM with Contact 31', exact: true })
      await last.hover()
      await lastHide.click()
      await expect(last).toHaveCount(0)
    })
  }

  test('sends a friend request and keeps the outgoing request visible', async ({ page }) => {
    const state = createMockCoreState({
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
    })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: /^Add Friend/ }).click()
    await page.getByPlaceholder('Enter username').fill('newfriend')
    await page.getByRole('button', { name: 'Send Request' }).click()

    await expect(page.getByText('Friend request sent.')).toBeVisible()
    await expect(page.getByText('Pending request')).toBeVisible()
    await expect(page.getByText('newfriend')).toBeVisible()
    expect(state.outgoingRequests[0]?.receiver_username).toBe('newfriend')
  })

  test('accepts and rejects incoming friend requests from the Requests tab', async ({ page }) => {
    const state = createMockCoreState({
      friends: [],
      incomingRequests: buildRequests(2, 'incoming'),
      outgoingRequests: [],
    })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: /^Add Friend/ }).click()

    await page.getByRole('button', { name: 'Accept friend request from Request In 01' }).click()
    await expect(page.getByText('Request In 01')).toBeHidden()
    expect(state.friends.some((friend) => friend.username === 'Request In 01')).toBe(true)

    await page.getByRole('button', { name: 'Reject friend request from Request In 02' }).click()
    await expect(page.getByText('Request In 02')).toBeHidden()
    expect(state.incomingRequests).toHaveLength(0)

    await page.getByRole('button', { name: /All/ }).click()
    await expect(page.getByText('All Friends — 1')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Message Request In 01' })).toBeVisible()
  })

  test('cancels an outgoing friend request without clearing incoming requests', async ({ page }) => {
    const state = createMockCoreState({
      friends: [],
      incomingRequests: buildRequests(1, 'incoming'),
      outgoingRequests: buildRequests(2, 'outgoing'),
    })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: /^Add Friend/ }).click()
    await page.getByRole('button', { name: 'Cancel request to Request Out 01' }).click()

    await expect(page.getByText('Request Out 01')).toBeHidden()
    await expect(page.getByText('Request Out 02')).toBeVisible()
    await expect(page.getByText('Request In 01')).toBeVisible()
    expect(state.outgoingRequests.map((request) => request.receiver_username)).toEqual(['Request Out 02'])
    expect(state.incomingRequests).toHaveLength(1)
  })

  test('removes a friend only after confirmation', async ({ page }) => {
    const state = createMockCoreState({
      friends: buildFriends(2),
      incomingRequests: [],
      outgoingRequests: [],
    })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: /All/ }).click()
    await page.getByRole('button', { name: 'More actions for Friend 01' }).click()
    await page.getByRole('menuitem', { name: 'Remove friend' }).click()

    await expect(page.getByRole('heading', { name: 'Remove friend?' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('button', { name: 'Message Friend 01' })).toBeVisible()
    expect(state.friends.some((friend) => friend.id === 'friend-01')).toBe(true)

    await page.getByRole('button', { name: 'More actions for Friend 01' }).click()
    await page.getByRole('menuitem', { name: 'Remove friend' }).click()
    await page.getByRole('button', { name: 'Remove', exact: true }).click()

    await expect(page.getByRole('button', { name: 'Message Friend 01' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Message Friend 02' })).toBeVisible()
    expect(state.friends.some((friend) => friend.id === 'friend-01')).toBe(false)
  })

  test('opens a friend profile from a viewport-safe context menu on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 640 })
    const state = createMockCoreState({
      friends: buildFriends(1),
      incomingRequests: [],
      outgoingRequests: [],
    })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: /All/ }).click()
    await page.getByRole('button', { name: 'Message Friend 01' }).click({ button: 'right' })

    const menu = page.getByRole('menu', { name: 'Actions for Friend 01' })
    await expect(menu).toBeVisible()
    const menuBox = await menu.boundingBox()
    expect(menuBox).not.toBeNull()
    expect(menuBox!.x).toBeGreaterThanOrEqual(0)
    expect(menuBox!.y).toBeGreaterThanOrEqual(0)
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390)
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(640)

    await menu.getByRole('menuitem', { name: 'View profile (@Friend 01)' }).click()
    await expect(page.getByRole('dialog', { name: 'Friend 01' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Friend 01' })).toBeHidden()
  })

  test('opens a Friends more-actions menu in the main panel instead of the DM sidebar', async ({ page }) => {
    const state = createMockCoreState({
      friends: buildFriends(1),
      incomingRequests: [],
      outgoingRequests: [],
    })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: /All/ }).click()
    await page.getByRole('button', { name: 'More actions for Friend 01' }).click()

    const socialContentBox = await page.locator('.social-content').boundingBox()
    const menuBox = await page.getByRole('menu', { name: 'Actions for Friend 01' }).boundingBox()
    expect(socialContentBox).not.toBeNull()
    expect(menuBox).not.toBeNull()
    expect(menuBox!.x).toBeGreaterThanOrEqual(socialContentBox!.x)
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(socialContentBox!.x + socialContentBox!.width)
    const friendRowBox = await page.locator('.home-member-row').first().boundingBox()
    expect(friendRowBox).not.toBeNull()
    expect(menuBox!.y).toBeGreaterThanOrEqual(friendRowBox!.y + friendRowBox!.height + 3)
  })

  test('keeps Social and DM controls inside an 800px compact viewport', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })
    const state = createMockCoreState({ friends: buildFriends(1) })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await expect(page.locator('.home-side')).toBeHidden()
    await expect(page.getByRole('button', { name: /^Add Friend/ })).toBeVisible()
    await page.getByRole('button', { name: /All/ }).click()
    await page.getByRole('button', { name: 'More actions for Friend 01' }).click()
    const profileItem = page.getByRole('menuitem', { name: 'View profile (@Friend 01)' })
    await expect(profileItem).toBeVisible()
    expect((await profileItem.boundingBox())!.height).toBeLessThanOrEqual(40)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Message Friend 01' }).click()
    await page.getByRole('button', { name: 'Search in conversation' }).click()
    for (const control of [page.getByRole('button', { name: 'Close search' }), page.getByRole('textbox', { name: 'Search messages' })]) {
      await expect(control).toBeVisible()
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x + box!.width).toBeLessThanOrEqual(800)
    }
    await page.getByRole('button', { name: 'Close search' }).click()
    const pinned = page.getByRole('button', { name: 'Pinned messages' })
    await expect(pinned).toBeVisible()
    const pinnedBox = await pinned.boundingBox()
    expect(pinnedBox!.x + pinnedBox!.width).toBeLessThanOrEqual(800)
    await pinned.click()
    await expect(page.locator('.chat-header-pinned-dropdown')).toBeInViewport()
  })

  test('keeps direct-message context actions available from the Social sidebar', async ({ page }) => {
    const state = createMockCoreState({
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
    })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.locator('.social-dm-open').click({ button: 'right' })

    const menu = page.getByRole('menu', { name: 'Actions for Friend 01' })
    const sidebarBox = await page.locator('.social-sidebar').boundingBox()
    await expect(menu).toHaveCSS('width', '224px')
    const menuBox = await menu.boundingBox()
    expect(sidebarBox).not.toBeNull()
    expect(menuBox).not.toBeNull()
    expect(menuBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x)
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width)
    await expect(menu.getByRole('menuitem', { name: 'View profile (@Friend 01)' })).toBeFocused()
    await expect(menu.getByRole('menuitem', { name: 'Open direct message' })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Pin Conversation' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Remove friend' })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Close DM' })).toBeVisible()
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1024, height: 360 }]) {
      await page.keyboard.press('Escape')
      await page.setViewportSize(viewport)
      await page.locator('.social-dm-open').click({ button: 'right' })
      await expect(menu).toBeVisible()
      const rowBox = await page.locator('.social-dm-item').boundingBox()
      const anchoredBox = await menu.boundingBox()
      expect(rowBox).not.toBeNull()
      expect(anchoredBox).not.toBeNull()
      expect(anchoredBox!.y >= rowBox!.y + rowBox!.height + 3
        || anchoredBox!.y + anchoredBox!.height <= rowBox!.y - 3).toBe(true)
      expect(anchoredBox!.y).toBeGreaterThanOrEqual(8)
      expect(anchoredBox!.y + anchoredBox!.height).toBeLessThanOrEqual(viewport.height - 8)
    }
  })
})
