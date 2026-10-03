import { expect, test, type Locator, type Page } from '@playwright/test'
import { buildCoreChannels, buildCoreMembers, buildCoreServer, buildFriends, buildServerMessage, createMockCoreState, installMockCoreApi } from './mock-core-api'

function stateWithImage() {
  const server = buildCoreServer()
  const channels = buildCoreChannels(server.id)
  const text = channels.find(channel => channel.channel_type === 'text')!
  return createMockCoreState({
    servers: [server], channelsByServerId: { [server.id]: channels }, membersByServerId: { [server.id]: buildCoreMembers() },
    messagesByChannelId: { [text.id]: [buildServerMessage(text.id, 'Focus regression', {
      attachments: [{ url: '/audit-photo.svg', type: 'image/svg+xml', name: 'audit-photo.svg' }],
    })] },
  })
}

async function expectMenuNavigation(page: Page, menu: Locator) {
  const actions = menu.locator('button:enabled:not([aria-disabled="true"])')
  const count = await actions.count()
  expect(count).toBeGreaterThan(1)
  await actions.first().press('ArrowDown')
  await expect(actions.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(actions.last()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(actions.first()).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(actions.last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(actions.first()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(actions.nth(1)).toBeFocused()
}

for (const width of [1920, 390]) {
  test(`navigates Friends and DM action menus with arrows at ${width}px`, async ({ page }) => {
    const state = { ...stateWithImage(), friends: buildFriends(1) }
    state.dmChannels = [{ id: 'dm-friend-01', peer_id: 'friend-01', peer_username: 'Friend 01', peer_avatar_url: null,
      peer_status: 'online', last_message_at: null, unread_count: 0, pinned_at: null, is_pinned: false }]
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/social')
    const opener = page.getByRole('button', { name: 'More actions for Friend 01', exact: true })
    await opener.click()
    const menu = page.getByRole('menu', { name: 'Actions for Friend 01', exact: true })
    await expectMenuNavigation(page, menu)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(opener).toBeFocused()
    if (width < 1024) await page.getByRole('link', { name: 'Social', exact: true }).click()
    const dm = page.getByRole('button', { name: 'Open DM with Friend 01', exact: true })
    await dm.press('Shift+F10')
    await expectMenuNavigation(page, menu)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(dm).toBeFocused()
  })
}

test('navigates channel, category and member action menus with arrows', async ({ page }) => {
  await installMockCoreApi(page, stateWithImage())
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/servers')
  for (const opener of [
    page.getByRole('button', { name: 'Text channel general', exact: true }),
    page.locator('.channel-category-btn').filter({ hasText: 'GENERAL' }),
    page.locator('.member-sidebar').getByRole('button', { name: 'View profile for Friend 01', exact: true }),
  ]) {
    await opener.press('Shift+F10')
    const menu = page.getByRole('menu')
    await expectMenuNavigation(page, menu)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(opener).toBeFocused()
  }
})

for (const width of [1920, 390, 320]) {
  test(`contains image-preview keyboard focus and restores its trigger at ${width}px`, async ({ page }) => {
    await installMockCoreApi(page, stateWithImage())
    await page.route('**/audit-photo.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="green"/></svg>' }))
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/servers')
    const trigger = page.getByRole('button', { name: 'Preview audit-photo.svg', exact: true })
    await trigger.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'audit-photo.svg', exact: true })
    const close = dialog.getByRole('button', { name: 'Close image preview' })
    await expect(close).toBeFocused()
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key)
      await expect(close).toBeFocused()
    }
    await expect(page.locator('#root')).toHaveAttribute('inert', '')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(page.locator('#root')).not.toHaveAttribute('inert')
  })
}

for (const width of [320, 390, 844]) {
  test(`excludes closed drawers and keeps mobile composer targets usable at ${width}px`, async ({ page }) => {
    const state = stateWithImage()
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 })
    await page.goto('/social')
    const drawer = page.locator('.social-sidebar')
    await expect(drawer).toHaveCSS('visibility', 'hidden')
    await page.getByRole('button', { name: 'Settings', exact: true }).press('Tab')
    for (let step = 0; step < 20; step++) {
      expect(await drawer.evaluate(el => el.contains(document.activeElement))).toBe(false)
      await page.keyboard.press('Tab')
    }
    await page.getByRole('link', { name: 'Social', exact: true }).click()
    await expect(drawer).toHaveCSS('visibility', 'visible')
    await drawer.getByRole('button', { name: 'Friends', exact: true }).click()
    await expect(drawer).toHaveCSS('visibility', 'hidden')

    const server = state.servers[0]
    await page.getByRole('button', { name: server.name, exact: true }).click()
    const channels = page.locator('.channel-sidebar')
    await expect(channels).toHaveCSS('visibility', 'visible')
    await channels.getByRole('button', { name: 'Text channel general', exact: true }).click()
    await expect(channels).toHaveCSS('visibility', 'hidden')
    expect(await channels.locator('.channel-item').first().evaluate(el => getComputedStyle(el).visibility)).toBe('hidden')
    await page.getByRole('button', { name: 'Settings', exact: true }).press('Tab')
    for (let step = 0; step < 20; step++) {
      expect(await channels.evaluate(el => ({ inDrawer: el.contains(document.activeElement), active: document.activeElement?.outerHTML.slice(0, 200), visibility: document.activeElement ? getComputedStyle(document.activeElement).visibility : null }))).toMatchObject({ inDrawer: false })
      await page.keyboard.press('Tab')
    }
    for (const name of ['Attach files', 'Emoji, GIFs and stickers', 'Send message']) {
      const button = page.getByRole('button', { name, exact: true })
      const box = (await button.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      await expect(button).toBeInViewport({ ratio: 1 })
    }
    expect(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true)
    const send = page.getByRole('button', { name: 'Send message', exact: true })
    await expect(send).toBeDisabled()
    const input = page.locator('textarea.message-input')
    await input.fill('   ')
    await expect(send).toBeDisabled()
    await input.fill('Ready')
    await expect(send).toBeEnabled()
    await expect(page.getByLabel('Characters remaining')).toHaveCount(0)
    await input.fill('a'.repeat(3900))
    await expect(page.getByLabel('Characters remaining')).toHaveText('100')
    await input.fill('')
    await page.setViewportSize({ width: 1920, height: 1080 })
    await expect(channels).toHaveCSS('visibility', 'visible')
    await expect(page.getByLabel('Characters remaining')).toHaveText('4000')
  })
}

test('disables empty and whitespace-only server forms without changing valid submission', async ({ page }) => {
  await installMockCoreApi(page, createMockCoreState())
  await page.goto('/social')
  for (const form of [
    { name: 'Create Server', dialog: 'Create a Server', placeholder: 'My Awesome Server', action: 'Create' },
    { name: 'Join Server', dialog: 'Join a Server', placeholder: 'Paste an invite link or short code', action: 'Join' },
  ]) {
    await page.getByRole('button', { name: form.name, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: form.dialog, exact: true })
    const action = dialog.getByRole('button', { name: form.action, exact: true })
    const input = dialog.getByPlaceholder(form.placeholder)
    await expect(action).toBeDisabled()
    await input.fill('   ')
    await expect(action).toBeDisabled()
    await input.fill('valid-server')
    await expect(action).toBeEnabled()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  }
})

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1024, height: 600 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  for (const path of ['/servers', '/social']) {
    test(`restores conversation search focus on ${path} at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await installMockCoreApi(page, { ...stateWithImage(), friends: buildFriends(1) })
      await page.setViewportSize(viewport)
      await page.goto(path)
      if (path === '/social') await page.getByRole('button', { name: 'Message Friend 01', exact: true }).click()
      const trigger = page.getByRole('button', { name: 'Search in conversation', exact: true })
      const input = page.getByRole('textbox', { name: 'Search messages', exact: true })
      for (const dismiss of ['Escape', 'Close search', 'shortcut']) {
        if (dismiss === 'shortcut') await page.locator('textarea.message-input:visible').press('Control+f')
        else await trigger.click()
        await expect(input).toBeFocused()
        await expect(input).toHaveValue('')
        await input.fill('Focus regression')
        if (dismiss === 'Close search') await page.getByRole('button', { name: dismiss, exact: true }).click()
        else await page.keyboard.press('Escape')
        await expect(input).toHaveCount(0)
        await expect(trigger).toBeFocused()
      }
      if (viewport.width >= 1024) {
        await trigger.click()
        const pins = page.getByRole('button', { name: 'Pinned messages', exact: true })
        await pins.click()
        await expect(pins).toBeFocused()
        await expect(pins).toHaveAttribute('aria-expanded', 'true')
        await expect(input).toHaveCount(0)
      }
    })
  }
}

for (const mode of ['GIF', 'Sticker']) {
  for (const touch of [false, true]) {
    test(`reveals ${mode} favorite stars only during interaction with touch=${touch}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: touch ? 390 : 1920, height: 844 }, hasTouch: touch, isMobile: touch })
      try {
        const page = await context.newPage()
        await installMockCoreApi(page, stateWithImage())
        await page.route('https://media.giphy.com/**', route => route.fulfill({
          contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
        }))
        await page.goto('/servers')
        await page.getByRole('button', { name: 'Emoji, GIFs and stickers' }).click()
        await page.getByRole('tab', { name: mode, exact: true }).click()
        const picker = page.locator('.chat-emoji-picker')
        const card = picker.locator(mode === 'GIF' ? '.chat-gif-card' : '.chat-sticker-card').first()
        const star = card.locator('.chat-media-favorite')
        const search = picker.getByRole('textbox')
        await expect(star).toHaveCSS('opacity', touch ? '1' : '0')
        if (!touch) {
          await expect(star).toHaveCSS('pointer-events', 'none')
          await card.hover()
          await expect(star).toHaveCSS('opacity', '1')
        }
        await star.click()
        await expect(star).toHaveAttribute('aria-pressed', 'true')
        await expect(star.locator('svg')).toHaveAttribute('fill', 'currentColor')
        if (!touch) {
          await search.hover()
          await expect(star).toHaveCSS('opacity', '0')
        }
        await picker.getByRole('button', { name: 'Favorites', exact: true }).click()
        await expect(picker.locator(mode === 'GIF' ? '.chat-gif-card' : '.chat-sticker-card')).toHaveCount(1)
        await expect(star).toHaveCSS('opacity', touch ? '1' : '0')
        if (!touch) {
          await page.keyboard.press('Tab')
          await expect(card.getByRole('button', { name: /^Send / })).toBeFocused()
          await expect(star).toHaveCSS('opacity', '1')
          await page.keyboard.press('Tab')
          await expect(star).toBeFocused()
          await page.keyboard.press('Space')
        } else {
          await star.click()
        }
        await expect(picker.locator(mode === 'GIF' ? '.chat-gif-card' : '.chat-sticker-card')).toHaveCount(0)
      } finally {
        await context.close()
      }
    })
  }
}
