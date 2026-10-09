import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  buildCoreChannels,
  buildCoreMembers,
  buildCoreServer,
  buildFriends,
  buildServerMessage,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

test.describe('mocked release and settings regressions', () => {
  test('keeps the first voice ring and reorder slot visible and persists drag order', async ({ page }, testInfo) => {
    const servers = Array.from({ length: 3 }, (_, i) => buildCoreServer({ id: `rail-${i}`, name: `Rail ${i}` }))
    const channels = buildCoreChannels(servers[0].id)
    await installMockCoreApi(page, createMockCoreState({ servers, channelsByServerId: { [servers[0].id]: channels }, membersByServerId: { [servers[0].id]: buildCoreMembers() } }))
    await page.addInitScript(() => {
      const Base = window.WebSocket
      window.WebSocket = class extends Base {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols)
          Reflect.set(window, '__railSocket', this)
        }
      }
    })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/servers')
    const list = page.locator('.server-sidebar-scroll')
    const first = list.locator('[data-server-id="rail-0"]')
    await expect(page.getByRole('button', { name: 'View profile for Friend 01' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__railSocket')?.readyState)).toBe(1)
    await page.evaluate(({ serverId, channelId }) => {
      const socket = Reflect.get(window, '__railSocket') as WebSocket
      socket.onmessage?.call(socket, new MessageEvent('message', { data: JSON.stringify({
        type: 'VoiceStateUpdate', data: { server_id: serverId, channel_id: channelId, user_id: 'friend-01' },
      }) }))
    }, { serverId: servers[0].id, channelId: channels.find(c => c.channel_type === 'voice')!.id })
    await expect(first).toHaveClass(/has-active-voice/)
    const firstRect = (await first.boundingBox())!
    const listRect = (await list.boundingBox())!
    expect(firstRect.y - listRect.y).toBeGreaterThanOrEqual(7)
    await page.screenshot({ path: testInfo.outputPath('rail-voice-ring.png') })
    const last = list.locator('[data-server-id="rail-2"]')
    const source = (await last.boundingBox())!
    await page.mouse.move(source.x + 24, source.y + 24)
    await page.mouse.down()
    await page.mouse.move(source.x + 24, source.y + 8, { steps: 5 })
    await page.mouse.move(firstRect.x + 24, firstRect.y - 3, { steps: 12 })
    await expect(first.locator('..')).toHaveClass(/drag-over-before/)
    const marker = await first.locator('..').evaluate(el => {
      const style = getComputedStyle(el, '::before')
      const rect = el.getBoundingClientRect()
      return { top: rect.top + parseFloat(style.top), height: parseFloat(style.height) }
    })
    expect(marker.top).toBeGreaterThanOrEqual(listRect.y)
    expect(marker.height).toBe(3)
    await page.screenshot({ path: testInfo.outputPath('rail-first-insertion.png') })
    await page.mouse.up()
    const order = () => list.locator('[data-server-id]').evaluateAll(els => els.map(el => el.getAttribute('data-server-id')))
    await expect.poll(order).toEqual(['rail-2', 'rail-0', 'rail-1'])
    await page.reload()
    await expect.poll(order).toEqual(['rail-2', 'rail-0', 'rail-1'])
    await list.locator('[data-server-id="rail-2"]').dragTo(list.locator('[data-server-id="rail-1"]'), { targetPosition: { x: 24, y: 46 } })
    await expect.poll(order).toEqual(['rail-0', 'rail-1', 'rail-2'])
  })

  test('scrolls long server rails during drag without losing Social or create/join controls', async ({ page }) => {
    const servers = Array.from({ length: 16 }, (_, i) => buildCoreServer({ id: `rail-${i}`, name: `Rail ${i}` }))
    await installMockCoreApi(page, createMockCoreState({ servers, channelsByServerId: { [servers[0].id]: buildCoreChannels(servers[0].id) } }))
    await page.setViewportSize({ width: 1920, height: 600 })
    await page.goto('/servers')
    const list = page.locator('.server-sidebar-scroll')
    const last = list.locator('[data-server-id="rail-15"]')
    await last.scrollIntoViewIfNeeded()
    expect(await list.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    const source = (await last.boundingBox())!
    const bounds = (await list.boundingBox())!
    await page.mouse.move(source.x + 24, source.y + 24)
    await page.mouse.down()
    await page.mouse.move(source.x + 24, source.y + 8, { steps: 5 })
    await page.mouse.move(source.x + 24, bounds.y + 5, { steps: 15 })
    await expect(page.locator('.server-sidebar')).toHaveClass(/is-dragging/)
    await expect.poll(() => list.evaluate(el => el.scrollTop), { timeout: 15000 }).toBe(0)
    await page.mouse.move(source.x + 24, bounds.y + 12)
    await expect(list.locator('[data-server-id="rail-0"]').locator('..')).toHaveClass(/drag-over-before/)
    await page.mouse.up()
    await expect(list.locator('[data-server-id]').first()).toHaveAttribute('data-server-id', 'rail-15')
    await expect(page.getByRole('link', { name: 'Social', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Create Server' })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Join Server' })).toBeInViewport()
  })

  for (const viewport of [{ width: 1920, height: 600 }, { width: 1100, height: 600 }, { width: 390, height: 844 }]) {
  test(`reveals a thin overflowing rail scrollbar on hover without moving icons at ${viewport.width}px`, async ({ page }, testInfo) => {
    const servers = Array.from({ length: 16 }, (_, i) => buildCoreServer({ id: `rail-${i}`, name: `Rail ${i}` }))
    await installMockCoreApi(page, createMockCoreState({ servers, channelsByServerId: { [servers[0].id]: buildCoreChannels(servers[0].id) } }))
    await page.setViewportSize(viewport)
    await page.goto('/servers')
    const list = page.locator('.server-sidebar-scroll')
    const first = list.locator('[data-server-id="rail-0"]')
    await expect(first).toBeVisible()
    await page.locator('.chat-header').click()
    await page.mouse.move(viewport.width - 20, 200)
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    const usesWebkitScrollbar = await page.evaluate(() => CSS.supports('selector(::-webkit-scrollbar)'))
    const gutter = () => list.evaluate(el => el.offsetWidth - el.clientWidth)
    // Measure the actual reserved space: pseudo-element styles alone can be ignored by Chromium.
    expect(await gutter()).toBeLessThanOrEqual(usesWebkitScrollbar ? 8 : 16)
    if (usesWebkitScrollbar) {
      await expect(list).toHaveCSS('scrollbar-width', 'auto')
    } else {
      // Headless Firefox suppresses native scrollbar rendering; verify the authored fallback too.
      const declaredWidth = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => {
        try { return [...sheet.cssRules] } catch { return [] }
      }).filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === '.server-sidebar-scroll')
        .map(rule => rule.style.getPropertyValue('scrollbar-width')))
      expect(declaredWidth).toContain('thin')
    }
    await expect(list).toHaveCSS('scrollbar-color', usesWebkitScrollbar ? 'auto' : 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)')
    if (usesWebkitScrollbar) {
      expect(await list.evaluate(el => getComputedStyle(el, '::-webkit-scrollbar').width)).toBe('4px')
      expect(await list.evaluate(el => getComputedStyle(el, '::-webkit-scrollbar-button').display)).toBe('none')
    }
    const idle = (await first.boundingBox())!
    await page.screenshot({ path: testInfo.outputPath('rail-scrollbar-idle.png') })
    await first.hover()
    const thumb = () => list.evaluate((el, webkit) => webkit
      ? getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor
      : getComputedStyle(el).scrollbarColor, usesWebkitScrollbar)
    const transparent = usesWebkitScrollbar ? 'rgba(0, 0, 0, 0)' : 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)'
    await expect.poll(thumb).not.toBe(transparent)
    expect(await gutter()).toBeLessThanOrEqual(usesWebkitScrollbar ? 8 : 16)
    if (usesWebkitScrollbar) await expect(list).toHaveCSS('scrollbar-color', 'auto')
    const bounds = (await list.boundingBox())!
    expect(idle.x + idle.width).toBeLessThan(bounds.x + bounds.width - (await gutter()) / 2)
    expect((await first.boundingBox())!.x).toBe(idle.x)
    await page.screenshot({ path: testInfo.outputPath('rail-scrollbar-hover.png') })
    await page.mouse.wheel(0, 200)
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    await page.mouse.move(viewport.width - 20, 200)
    await expect.poll(thumb).toBe(transparent)
    await list.locator('[data-server-id="rail-15"]').focus()
    await expect.poll(thumb).not.toBe(transparent)
  })
  }

  test('groups Quick Search and preserves keyboard navigation, filtering and focus', async ({ page }, testInfo) => {
    const server = buildCoreServer()
    await installMockCoreApi(page, createMockCoreState({
      servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) },
      dmChannels: [{ id: 'dm-friend-01', peer_id: 'friend-01', peer_username: 'Friend 01', peer_status: 'online', peer_avatar_url: null, unread_count: 0, last_message_at: null, pinned_at: null, is_pinned: false }],
    }))
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/servers')
    const trigger = page.getByRole('button', { name: /Quick Search/ })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Quick switcher' })
    await expect(dialog.getByRole('heading')).toHaveText(['Direct messages', 'Servers', 'Channels'])
    const input = dialog.getByRole('textbox')
    await expect(input).toBeFocused()
    await input.press('ArrowDown')
    await expect(dialog.locator('.quick-switcher-item.active')).toContainText(server.name)
    await input.fill('not-a-match')
    await expect(dialog.getByText(/No matches/)).toBeVisible()
    await expect(dialog.getByRole('heading')).toHaveCount(0)
    await input.fill('general')
    await expect(dialog.getByRole('heading')).toHaveText(['Channels'])
    await input.fill('')
    await page.screenshot({ path: testInfo.outputPath('quick-search-groups.png') })
    await dialog.locator('.quick-switcher-item').last().focus()
    await page.keyboard.press('Tab')
    await expect(input).toBeFocused()
    await input.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('keeps long Quick Search scrolling native without backdrop blur or pointer-driven jumps', async ({ page }) => {
    const servers = Array.from({ length: 8 }, (_, n) => buildCoreServer({ id: `quick-scroll-${n}`, name: `Scroll Guild ${n}` }))
    await installMockCoreApi(page, createMockCoreState({
      servers, channelsByServerId: Object.fromEntries(servers.map(server => [server.id, buildCoreChannels(server.id)])),
    }))
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/servers')
    await page.getByRole('button', { name: /Quick Search/ }).click()
    await expect(page.locator('.quick-switcher-overlay')).toHaveCSS('backdrop-filter', 'none')
    const list = page.locator('.quick-switcher-list')
    await expect.poll(() => list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    await list.hover()
    await page.mouse.wheel(0, 20000)
    await expect.poll(() => list.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThan(1)
    const bottom = await list.evaluate(el => el.scrollTop)
    const box = (await list.boundingBox())!
    const rows = list.locator('.quick-switcher-item')
    let checkedClippedRow = false
    for (const row of await rows.all()) {
      const rect = (await row.boundingBox())!
      if (rect.y < box.y && rect.y + rect.height > box.y + 2) {
        await page.mouse.move(box.x + box.width / 2, box.y + 2)
        await expect(row).toHaveClass(/active/)
        expect(await list.evaluate(el => el.scrollTop)).toBeCloseTo(bottom, 1)
        checkedClippedRow = true
        break
      }
    }
    expect(checkedClippedRow).toBe(true)
    const input = page.getByRole('textbox', { name: 'Search servers, channels, and direct messages' })
    await input.fill('')
    await input.hover()
    for (let n = 0; n < 18; n++) await input.press('ArrowUp')
    await expect(rows.first()).toHaveClass(/active/)
    expect(await rows.first().evaluate(el => {
      const row = el.getBoundingClientRect()
      const list = el.closest('.quick-switcher-list')!.getBoundingClientRect()
      return row.top >= list.top && row.bottom <= list.bottom
    })).toBe(true)
    await input.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Quick switcher' })).toHaveCount(0)
  })

  for (const width of [1920, 1024, 1023, 800, 390]) {
    test(`uses one compact chat layout and keeps composer, photos, and panels usable at ${width}px`, { tag: [1920, 390].includes(width) ? '@core' : [] }, async ({ page }, testInfo) => {
      const server = buildCoreServer()
      const channels = buildCoreChannels(server.id)
      const general = channels[0]
      await installMockCoreApi(page, createMockCoreState({
        servers: [server], channelsByServerId: { [server.id]: channels }, membersByServerId: { [server.id]: buildCoreMembers() },
        messagesByChannelId: { [general.id]: [buildServerMessage(general.id, 'Square photo', {
          id: 'responsive-photo', attachments: [{ url: '/responsive-square.svg', name: 'square.svg', type: 'image/svg+xml' }],
        })] },
      }))
      await page.route('**/responsive-square.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#26b8a6"/></svg>' }))
      await page.setViewportSize({ width, height: width < 1024 ? 600 : 1080 })
      await page.goto('/servers')
      const compact = width < 1024
      const composer = page.locator('.message-input:visible')
      await expect(composer).toBeVisible()
      await expect(composer).toHaveAttribute('placeholder', compact ? 'Message' : 'Message #general')
      expect((await composer.boundingBox())!.width).toBeGreaterThanOrEqual(compact ? width - 230 : 200)
      expect(await page.locator('.shell-layout').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await expect(page.locator('.sidebar-resizer')).toHaveCount(0)
      const image = page.locator('.chat-image-attachment:visible')
      await expect(image).toBeVisible()
      const geometry = await image.evaluate((el: HTMLImageElement) => {
        const rect = el.getBoundingClientRect()
        const frame = el.parentElement!.getBoundingClientRect()
        return { ratio: rect.width / rect.height, width: rect.width, frame: frame.width, inside: rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom }
      })
      expect(geometry.ratio).toBeCloseTo(1, 2)
      expect(geometry.inside).toBe(true)
      const attach = page.getByRole('button', { name: 'Attach files' })
      const expressions = page.getByRole('button', { name: 'Emoji, GIFs and stickers' })
      expect((await attach.boundingBox())!.x).toBeLessThan((await expressions.boundingBox())!.x)
      expect((await expressions.boundingBox())!.x).toBeLessThan((await composer.boundingBox())!.x)
      await expressions.press('Enter')
      const picker = page.getByRole('dialog', { name: 'Emoji, GIFs and stickers' })
      await expect(picker).toBeInViewport()
      await expect(picker.getByPlaceholder('Search emoji')).toBeFocused()
      for (const mode of ['GIF', 'Sticker', 'Emoji']) {
        await picker.getByRole('tab', { name: mode, exact: true }).click()
        await expect(picker).toBeInViewport()
      }
      await page.keyboard.press('Escape')
      await expect(expressions).toBeFocused()
      await expect(picker).toHaveCount(0)
      await expressions.click()
      await picker.getByRole('tab', { name: 'GIF', exact: true }).click()
      await page.keyboard.press('Escape')
      await expressions.click()
      await expect(picker.getByRole('tab', { name: 'GIF', exact: true })).toHaveAttribute('aria-selected', 'true')
      await picker.getByRole('tab', { name: 'Sticker', exact: true }).click()
      await page.keyboard.press('Escape')
      await page.reload()
      await expressions.click()
      await expect(picker.getByRole('tab', { name: 'Sticker', exact: true })).toHaveAttribute('aria-selected', 'true')
      await picker.getByRole('tab', { name: 'Emoji', exact: true }).click()
      await page.keyboard.press('Escape')
      await composer.fill('A draft that survives layout changes')
      if (compact) {
        await expect(page.locator('.channel-sidebar')).not.toBeInViewport()
        await expect(page.locator('.member-sidebar:not(.member-sidebar--sheet)')).toBeHidden()
        await page.getByRole('button', { name: 'View members', exact: true }).click()
        await expect(page.locator('.mobile-member-sheet')).toBeInViewport()
        await page.getByRole('dialog', { name: 'Server members' }).getByRole('button', { name: 'Close members panel' }).click()
        await page.getByRole('button', { name: server.name, exact: true }).and(page.locator('.server-icon')).click()
        await expect(page.locator('.channel-sidebar')).toBeInViewport()
        await page.getByRole('button', { name: 'Text channel general', exact: true }).click()
        await expect(page.locator('.channel-sidebar')).not.toBeInViewport()
      } else {
        await expect(page.locator('.channel-sidebar')).toHaveCSS('width', '240px')
        await expect(page.locator('.member-sidebar')).toHaveCSS('width', '240px')
      }
      await expect(composer).toHaveValue('A draft that survives layout changes')
      await page.screenshot({ path: testInfo.outputPath(`responsive-chat-${width}.png`) })
    })
  }

  for (const width of [1920, 800]) {
    test(`contains Settings and account-dialog focus at ${width}px`, async ({ page }) => {
      await installMockCoreApi(page, createMockCoreState({ features: { email_verification_enabled: true, email_delivery_enabled: true } }))
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/social')
      const trigger = page.getByRole('button', { name: width >= 1024 ? 'Settings' : 'View my profile', exact: true })
      await trigger.click()
      if (width < 1024) await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      const firstControl = width >= 1024
        ? settings.getByRole('button', { name: 'Profile', exact: true })
        : settings.getByRole('combobox', { name: 'Settings section', exact: true })
      await expect(settings).toHaveAttribute('aria-modal', 'true')
      await expect(firstControl).toBeFocused()
      await expect(page.locator('#root')).toHaveAttribute('inert', '')
      await settings.getByRole('button', { name: 'Done', exact: true }).focus()
      await page.keyboard.press('Tab')
      await expect(firstControl).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(settings.getByRole('button', { name: 'Done', exact: true })).toBeFocused()
      for (const [row, dialog] of [['Username', 'Change username'], ['Email address', 'Change email'], ['Password', 'Change password']]) {
        const opener = settings.locator('.user-setting-row').filter({ has: page.getByText(row, { exact: true }) }).getByRole('button', { name: 'Change', exact: true })
        for (const dismissal of ['cancel', 'escape', 'backdrop']) {
          await opener.click()
          const account = page.getByRole('dialog', { name: dialog, exact: true })
          await expect(account).toBeVisible()
          await expect(page.locator('.user-settings-modal').locator('..')).toHaveAttribute('inert', '')
          await expect(page.locator('#root')).toHaveAttribute('inert', '')
          await account.getByRole('button', { name: 'Cancel', exact: true }).focus()
          await page.keyboard.press('Tab')
          expect(await account.evaluate(el => el.contains(document.activeElement))).toBe(true)
          if (dismissal === 'cancel') await account.getByRole('button', { name: 'Cancel', exact: true }).click()
          else if (dismissal === 'escape') await page.keyboard.press('Escape')
          else await page.locator('.modal-overlay').filter({ has: account }).click({ position: { x: 2, y: 2 } })
          await expect(account).toHaveCount(0)
          await expect(settings).toBeVisible()
          await expect(opener).toBeFocused()
        }
      }
      await page.keyboard.press('Escape')
      await expect(settings).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await expect(page.locator('#root')).not.toHaveAttribute('inert')
    })
  }

  test('opens profiles independently from messages and status', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    state.user.created_at = '2025-01-03T12:00:00.000Z'
    state.user.about_me = 'Building a community.'
    await installMockCoreApi(page, state)
    await page.goto('/social')
    await page.getByRole('button', { name: 'View profile for Friend 01', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Friend 01' })).toBeVisible()
    expect(state.dmChannels).toHaveLength(0)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'View my profile', exact: true }).click()
    await expect(page.getByRole('dialog', { name: state.user.username })).toBeVisible()
    await expect(page.getByRole('dialog', { name: state.user.username })).toContainText('Member since')
    await expect(page.getByRole('dialog', { name: state.user.username })).toContainText('Building a community.')
    await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
    await expect(page.locator('.user-settings-modal')).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    const statusButton = page.getByRole('button', { name: 'Set status', exact: true })
    await expect(page.getByRole('button', { name: 'View my profile', exact: true })).toHaveCount(1)
    await expect(statusButton).toContainText(state.user.username)
    await statusButton.locator('.user-name').click()
    await expect(page.locator('.user-status-popover')).toBeVisible()
    await expect(page.getByRole('dialog', { name: state.user.username, exact: true })).toHaveCount(0)
    await statusButton.locator('.user-status').click()
    await expect(page.locator('.user-status-popover')).toBeHidden()
    await statusButton.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.user-status-popover')).toBeVisible()
  })

  test('keeps a long account name readable without crowding status or settings', async ({ page }) => {
    const state = createMockCoreState()
    state.user.username = 'accountwithaverylongusernameforqa'
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/social')
    const bar = page.locator('.user-bar-wrap')
    const name = bar.locator('.user-name')
    await expect(name).toHaveAttribute('title', state.user.username)
    const layout = await bar.evaluate((element) => {
      const rect = (selector: string) => element.querySelector(selector)!.getBoundingClientRect()
      const nameElement = element.querySelector<HTMLElement>('.user-name')!
      return {
        bar: element.getBoundingClientRect(),
        avatar: rect('.user-avatar'),
        name: rect('.user-name'),
        status: rect('.user-status-row'),
        settings: rect('.user-panel-icon-btn'),
        truncated: nameElement.scrollWidth > nameElement.clientWidth,
      }
    })
    expect(layout.truncated).toBe(true)
    expect(layout.avatar.right).toBeLessThan(layout.name.left)
    expect(layout.name.right).toBeLessThanOrEqual(layout.settings.left)
    expect(layout.status.right).toBeLessThanOrEqual(layout.settings.left)
    expect(layout.settings.right).toBeLessThanOrEqual(layout.bar.right)
    await expect(bar.getByRole('button', { name: 'Settings' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Set status' })).toBeVisible()
  })

  test('edits a profile photo locally before an explicit save and allows retry', async ({ page }, testInfo) => {
    const state = createMockCoreState()
    await installMockCoreApi(page, state)
    let uploads = 0
    let submittedDataUrl = ''
    await page.route('**/api/auth/profile', async (route) => {
      uploads += 1
      const body = route.request().postDataJSON() as { avatar_url: string }
      submittedDataUrl = body.avatar_url
      if (uploads === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' }) })
        return
      }
      state.user.avatar_url = body.avatar_url
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.user) })
    })
    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const profile = page.locator('.user-settings-section--profile')
    const profileLayout = () => profile.evaluate(element => {
      const root = element.getBoundingClientRect()
      return ['.user-profile-preview-card', '#profile-about-me'].map(selector => {
        const box = element.querySelector(selector)!.getBoundingClientRect()
        return { top: Math.round(box.top - root.top), width: box.width, height: box.height }
      })
    })
    const layoutBeforeError = await profileLayout()
    await profile.locator('input[type="file"]').setInputFiles({
      name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    })
    const sizeError = profile.getByRole('alert')
    await expect(sizeError).toContainText('Profile photo must be 2 MB or smaller')
    await sizeError.click()
    expect(await profileLayout()).toEqual(layoutBeforeError)
    await expect(page.locator('.user-settings-modal')).toBeVisible()
    await expect(page.locator('.toast-item.error')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('profile-photo-too-large-inline.png') })
    const source = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 120
      canvas.height = 80
      const context = canvas.getContext('2d')!
      context.fillStyle = '#e64040'
      context.fillRect(0, 0, 60, 80)
      context.fillStyle = '#347ae8'
      context.fillRect(60, 0, 60, 80)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const file = { name: 'landscape.png', mimeType: 'image/png', buffer: Buffer.from(source, 'base64') }
    await profile.locator('input[type="file"]').setInputFiles(file)
    const editor = profile.locator('.profile-avatar-editor')
    await expect(sizeError).toHaveCount(0)
    await expect(editor.getByRole('button', { name: 'Save photo' })).toBeEnabled()
    expect(uploads).toBe(0)
    await editor.getByRole('button', { name: 'Cancel' }).click()
    await expect(editor).toHaveCount(0)
    expect(uploads).toBe(0)
    await profile.locator('input[type="file"]').setInputFiles(file)
    await expect(editor.getByRole('button', { name: 'Save photo' })).toBeEnabled()
    const firstDraftUrl = await editor.locator('img').getAttribute('src')
    await profile.locator('input[type="file"]').setInputFiles({ ...file, name: 'another.png' })
    await expect(editor.getByRole('button', { name: 'Save photo' })).toBeEnabled()
    await expect(editor.locator('img')).not.toHaveAttribute('src', firstDraftUrl!)
    expect(uploads).toBe(0)
    await profile.locator('input[type="file"]').setInputFiles(file)
    await expect(editor.getByRole('button', { name: 'Save photo' })).toBeEnabled()
    const zoom = editor.getByRole('slider', { name: 'Zoom' })
    await zoom.focus()
    await zoom.press('ArrowRight')
    expect(Number(await zoom.inputValue())).toBeGreaterThan(1)
    const stage = editor.getByRole('group', { name: 'Move photo crop with arrow keys' })
    await stage.hover()
    const zoomBeforeWheel = Number(await zoom.inputValue())
    await page.mouse.wheel(0, -120)
    await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(zoomBeforeWheel)
    await page.mouse.wheel(0, 120)
    await expect.poll(async () => Number(await zoom.inputValue())).toBe(zoomBeforeWheel)
    const controlsBox = (await editor.locator('.profile-avatar-editor__controls').boundingBox())!
    const actionsBox = (await editor.locator('.profile-avatar-editor__actions').boundingBox())!
    expect(Math.abs(controlsBox.x + controlsBox.width / 2 - actionsBox.x - actionsBox.width / 2)).toBeLessThan(2)
    const stageBox = (await stage.boundingBox())!
    const image = editor.locator('.profile-avatar-editor__stage img')
    const leftBeforeDrag = await image.evaluate(element => Number.parseFloat(element.style.left))
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(stageBox.x + stageBox.width / 2 + 16, stageBox.y + stageBox.height / 2)
    await page.mouse.up()
    expect(await image.evaluate(element => Number.parseFloat(element.style.left))).toBeGreaterThan(leftBeforeDrag)
    await stage.focus()
    await stage.press('Shift+ArrowRight')
    await editor.screenshot({ path: testInfo.outputPath('profile-photo-editor-desktop.png') })
    await editor.getByRole('button', { name: 'Save photo' }).click()
    await expect(editor.getByRole('alert')).toContainText('Photo was not saved')
    expect(uploads).toBe(1)
    await editor.getByRole('button', { name: 'Save photo' }).click()
    await expect(editor).toHaveCount(0)
    expect(uploads).toBe(2)
    // PNG sources keep transparency, so Chromium saves the crop as WebP rather than JPEG.
    expect(submittedDataUrl).toMatch(/^data:image\/webp;base64,/)
    const savedAvatar = profile.locator('.user-profile-preview-avatar img')
    await expect(savedAvatar).toBeVisible()
    await expect(savedAvatar).toHaveAttribute('src', submittedDataUrl)
    const dimensions = await savedAvatar.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])
    expect(dimensions).toEqual([512, 512])
    const center = await savedAvatar.evaluate((image: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 512
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      return Array.from(context.getImageData(256, 256, 1, 1).data)
    })
    expect(center[0]).toBeGreaterThan(center[2])
  })

  test('keeps default panels and responsive visibility despite old saved widths', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState({ friends: buildFriends(2) }))
    await page.addInitScript(() => localStorage.setItem('voxpery-panel-widths', JSON.stringify({ left: 360, right: 360 })))
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/social')
    await expect(page.locator('.sidebar-resizer')).toHaveCount(0)
    await expect(page.locator('.social-sidebar')).toHaveCSS('width', '240px')
    await expect(page.locator('.home-side')).toHaveCSS('width', '240px')
    await page.reload()
    await expect(page.locator('.social-sidebar')).toHaveCSS('width', '240px')
    await page.setViewportSize({ width: 1021, height: 600 })
    await expect.poll(() => page.locator('.home-main').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(350)
    await expect(page.locator('.social-sidebar')).not.toBeInViewport()
    await page.setViewportSize({ width: 800, height: 600 })
    await expect(page.locator('.home-side')).toBeHidden()
    await expect.poll(() => page.locator('.home-main').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(480)
    expect(await page.locator('.shell-layout').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.sidebar-resizer')).toHaveCount(0)
    await expect(page.locator('.social-sidebar')).not.toBeInViewport()
    await page.getByRole('button', { name: 'View my profile', exact: true }).click()
    await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
    await expect(page.locator('.user-settings-modal')).toBeVisible()
  })

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1024, height: 360 }]) {
    test(`keeps long member and voice menus usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      const server = buildCoreServer()
      const channels = buildCoreChannels(server.id)
      const voice = channels.find(channel => channel.channel_type === 'voice')!
      channels.push({ ...voice, id: 'voice-second', name: 'Second voice channel' })
      const members = buildCoreMembers()
      const peer = members[1]
      peer.username = 'MemberWithAVeryLongUsername'
      await installMockCoreApi(page, createMockCoreState({
        servers: [server], channelsByServerId: { [server.id]: channels }, membersByServerId: { [server.id]: members }, friends: [],
      }))
      await page.addInitScript(() => {
        const Base = window.WebSocket
        window.WebSocket = class extends Base {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols)
            Reflect.set(window, '__voiceMenuSocket', this)
          }
        }
      })
      await page.setViewportSize(viewport)
      await page.goto('/servers')
      await expect(page.locator('.channel-sidebar')).toHaveCSS('width', '240px')
      await expect(page.locator('.member-sidebar')).toHaveCSS('width', '240px')
      const member = page.getByRole('button', { name: `View profile for ${peer.username}` })
      await member.scrollIntoViewIfNeeded()
      await expect(member).toBeInViewport()
      await member.focus()
      await member.press('Shift+F10')
      const menu = page.getByRole('menu', { name: `Actions for ${peer.username}` })
      await expectViewportPopup(menu)
      const memberRect = (await member.boundingBox())!
      const menuRect = (await menu.boundingBox())!
      expect(menuRect.y >= memberRect.y + memberRect.height + 3 || menuRect.y + menuRect.height <= memberRect.y - 3).toBe(true)
      await expect(menu).toHaveCSS('width', '224px')
      const memberPanel = (await page.locator('.member-sidebar').boundingBox())!
      expect(menuRect.x).toBeGreaterThanOrEqual(memberPanel.x + 7)
      expect(menuRect.x + menuRect.width).toBeLessThanOrEqual(memberPanel.x + memberPanel.width - 7)
      expect(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await expect(menu.getByRole('menuitem', { name: 'Manage roles' })).toBeVisible()
      await menu.evaluate(el => el.scrollTop = el.scrollHeight)
      await expect(menu.getByRole('menuitem', { name: 'Ban user' })).toBeInViewport()
      await page.screenshot({ path: testInfo.outputPath('member-menu.png') })
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(member).toBeFocused()
      await expect.poll(() => page.evaluate(() => Reflect.get(window, '__voiceMenuSocket')?.readyState)).toBe(1)
      await page.evaluate(({ userId, channelId, serverId }) => {
        const socket = Reflect.get(window, '__voiceMenuSocket') as WebSocket
        socket.onmessage?.call(socket, new MessageEvent('message', { data: JSON.stringify({
          type: 'VoiceStateUpdate', data: { user_id: userId, channel_id: channelId, server_id: serverId },
        }) }))
      }, { userId: peer.user_id, channelId: voice.id, serverId: server.id })
      const participant = page.getByRole('button', { name: `${peer.username} in voice` })
      await participant.scrollIntoViewIfNeeded()
      await expect(participant).toBeInViewport()
      await participant.focus()
      await participant.press('Shift+F10')
      const voiceMenu = page.getByRole('group', { name: `Voice actions for ${peer.username}` })
      await expectViewportPopup(voiceMenu)
      const participantRect = (await participant.boundingBox())!
      const voiceMenuRect = (await voiceMenu.boundingBox())!
      expect(voiceMenuRect.y >= participantRect.y + participantRect.height + 3 || voiceMenuRect.y + voiceMenuRect.height <= participantRect.y - 3).toBe(true)
      const avatarRect = (await participant.locator('.voice-participant-avatar').boundingBox())!
      expect(voiceMenuRect.x).toBeCloseTo(avatarRect.x, 0)
      expect(voiceMenuRect.width).toBeLessThanOrEqual(224)
      const channelPanel = (await page.locator('.channel-sidebar').boundingBox())!
      expect(voiceMenuRect.x).toBeGreaterThanOrEqual(channelPanel.x + 7)
      expect(voiceMenuRect.x + voiceMenuRect.width).toBeLessThanOrEqual(channelPanel.x + channelPanel.width - 7)
      expect(await voiceMenu.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      const picker = voiceMenu.getByRole('combobox', { name: `Move ${peer.username} to voice channel` })
      await picker.scrollIntoViewIfNeeded()
      await expect(picker).toBeInViewport()
      const slider = voiceMenu.getByRole('slider', { name: `Voice volume for ${peer.username}` })
      await slider.scrollIntoViewIfNeeded()
      await expect(slider).toBeInViewport()
      await slider.focus()
      await slider.press('ArrowRight')
      await expect(slider).toHaveValue('105')
      await expect(voiceMenu).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('voice-menu.png') })
      await page.keyboard.press('Escape')
      await expect(voiceMenu).toHaveCount(0)
      await expect(participant).toBeFocused()
    })
  }

  test('keeps profile details readable and keyboard-safe across viewport sizes', async ({ page }, testInfo) => {
    const server = buildCoreServer()
    const members = buildCoreMembers()
    const peer = members[1]
    peer.username = 'MemberWithAVeryLongUsername'
    peer.about_me = 'A'.repeat(190)
    peer.roles = Array.from({ length: 16 }, (_, index) => `Community-role-${index + 1}`)
    peer.account_created_at = '2025-01-03T12:00:00.000Z'
    peer.server_joined_at = '2025-02-04T12:00:00.000Z'
    await installMockCoreApi(page, createMockCoreState({
      servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) }, membersByServerId: { [server.id]: members }, friends: [],
    }))
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/servers')
    const member = page.getByRole('button', { name: `View profile for ${peer.username}` })
    await member.focus()
    await member.press('Enter')
    const profile = page.getByRole('dialog', { name: peer.username })
    await expectViewportPopup(profile, false)
    await expect(profile).toHaveCSS('width', '420px')
    await expect(profile.locator('.member-profile-avatar')).toHaveCSS('width', '64px')
    await expect(profile.locator('.member-profile-avatar')).toHaveText('M')
    await expect(profile.locator('.member-profile-username')).toHaveCSS('font-size', '22px')
    await expect(profile.getByText(peer.about_me, { exact: true })).toHaveCSS('font-size', '14px')
    await expect(profile.getByText('Member since', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('profile-desktop.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 800, height: 600 })
    await expectViewportPopup(profile, false)
    await page.setViewportSize({ width: 320, height: 568 })
    await expectViewportPopup(profile, false)
    await profile.evaluate(el => el.scrollTop = el.scrollHeight)
    await expect(profile.getByText('Community-role-16', { exact: true })).toBeInViewport()
    await expect(profile).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('profile-mobile.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.keyboard.press('Escape')
    await expect(profile).toHaveCount(0)
    await expect(member).toBeFocused()
    await member.press('Enter')
    await expect(profile.getByRole('button', { name: 'Close profile' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(profile.getByRole('button', { name: 'Add friend' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(profile.getByRole('button', { name: 'Close profile' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(member).toBeFocused()
  })

  test('keeps custom light appearance persistent and readable', async ({ page }, testInfo) => {
    await installMockCoreApi(page, createMockCoreState({ friends: buildFriends(2) }))
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.locator('.theme-option', { hasText: 'Light' }).click()
    await page.locator('.theme-option', { hasText: 'Custom' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme-mode', 'light')
    await page.getByRole('textbox', { name: 'Custom accent hex color' }).fill('#ffffee')
    await page.getByRole('textbox', { name: 'Custom accent hex color' }).press('Enter')
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-link').trim())).not.toBe('#ffffee')
    await page.screenshot({ path: testInfo.outputPath('appearance-light.png') })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme-mode', 'light')
    await expect(page.getByRole('button', { name: 'View profile for Friend 01', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('social-light.png') })
  })

  test('tints real chat and settings surfaces in Custom Light independently from accent', async ({ page }, testInfo) => {
    const server = buildCoreServer()
    await installMockCoreApi(page, createMockCoreState({ servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) }, membersByServerId: { [server.id]: buildCoreMembers() } }))
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/servers')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.locator('.theme-option', { hasText: 'Light' }).click()
    await page.locator('.theme-option', { hasText: 'Custom' }).click()
    const readSurfaces = () => page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      return Object.fromEntries(['--bg-primary', '--bg-secondary', '--bg-surface', '--bg-chat', '--bg-input', '--bg-header', '--bg-popover'].map(key => [key, root.getPropertyValue(key).trim()]))
    })
    const colors: Record<string, string>[] = []
    const renderedSurfaces: string[][] = []
    for (const color of ['#00ffee', '#ff00aa']) {
      const field = page.getByRole('textbox', { name: 'Custom theme hex color' })
      await field.fill(color)
      await field.press('Enter')
      colors.push(await readSurfaces())
      const painted: string[] = []
      for (const selector of ['.chat-area', '.channel-sidebar', '.member-sidebar', '.user-settings-modal']) {
        const background = await page.locator(selector).evaluate(el => {
          const style = getComputedStyle(el)
          return { color: style.backgroundColor, image: style.backgroundImage }
        })
        expect(background.color, selector).not.toBe('rgb(255, 255, 255)')
        if (background.image === 'none') expect(background.color, selector).not.toBe('rgba(0, 0, 0, 0)')
        painted.push(JSON.stringify(background))
      }
      renderedSurfaces.push(painted)
      await page.screenshot({ path: testInfo.outputPath(`custom-light-${color.slice(1)}.png`) })
    }
    for (const key of Object.keys(colors[0])) expect(colors[0][key]).not.toBe(colors[1][key])
    for (let index = 0; index < renderedSurfaces[0].length; index++) expect(renderedSurfaces[0][index]).not.toBe(renderedSurfaces[1][index])
    await page.getByRole('button', { name: 'Use Emerald accent' }).click()
    expect(await readSurfaces()).toEqual(colors[1])
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme-mode', 'light')
    expect(await readSurfaces()).toEqual(colors[1])
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('button', { name: 'Reset defaults', exact: true }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-custom-theme')
    await expect(page.locator('html')).not.toHaveAttribute('data-custom-accent')
  })

  test('keeps the settings frame stable across tabs', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState())
    for (const viewport of [{ width: 1366, height: 768 }, { width: 800, height: 600 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport)
      await page.goto('/social')
      if (viewport.width < 1024) {
        await page.getByRole('button', { name: 'View my profile', exact: true }).click()
        await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
      } else await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const modal = page.locator('.user-settings-modal')
      await modal.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished))
      })
      const readFrame = () => modal.evaluate((element) => {
        const box = (selector: string) => {
          const target = element.querySelector(selector)
          if (!target) throw new Error(`Missing settings frame element: ${selector}`)
          const rect = target.getBoundingClientRect()
          return { y: rect.y, height: rect.height }
        }
        return {
          modal: { y: element.getBoundingClientRect().y, height: element.getBoundingClientRect().height },
          header: box('.user-settings-header'),
          nav: box('.user-settings-nav'),
          scroll: box('.user-settings-scroll'),
          footer: box('.user-settings-footer'),
        }
      })
      const initial = await readFrame()
      if (viewport.width < 1024) {
        expect(initial.scroll.height).toBeGreaterThan(250)
        expect(initial.nav.height).toBeLessThan(70)
        await expect(modal.getByRole('combobox', { name: 'Settings section' })).toBeFocused()
        await expect(modal.getByRole('button', { name: 'About Voxpery', exact: true })).toBeVisible()
      }
      for (const tab of ['Appearance', 'Communication', 'Voice & Audio', 'Privacy & Data', 'Profile']) {
        if (viewport.width < 1024) {
          await modal.getByRole('combobox', { name: 'Settings section' }).selectOption({ label: tab })
        } else await modal.getByRole('button', { name: tab, exact: true }).click()
        const frame = await readFrame()
        for (const region of ['modal', 'header', 'nav', 'scroll', 'footer'] as const) {
          expect(frame[region].y, `${viewport.width}px ${tab} ${region} top`).toBeCloseTo(initial[region].y, 0)
          expect(frame[region].height, `${viewport.width}px ${tab} ${region} height`).toBeCloseTo(initial[region].height, 0)
        }
        await expect(modal.getByRole('button', { name: 'Done', exact: true })).toBeVisible()
        await expectNoHorizontalOverflow(modal.locator('.user-settings-scroll'))
        await expectFlatSettingsSurfaces(modal)
      }
      await modal.getByRole('button', { name: 'Done', exact: true }).click()
    }
  })
  test('shows the beta channel and build version in a single brand badge', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(3) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')

    const releaseBadge = page.locator('.shell-brand-release')
    await expect(releaseBadge).toBeVisible()
    await expect(releaseBadge).toContainText('Beta')
    await expect(releaseBadge).toContainText('v0.2.0-test')
    await expect(releaseBadge).toHaveAttribute('title', 'Beta channel, running build v0.2.0-test')

    const hasHorizontalOverflow = await page.locator('.shell-topbar').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
  })

  for (const theme of ['Dark', 'Light', 'Custom Light']) {
    test(`keeps the unified beta version badge flat and readable in ${theme}`, async ({ page }, testInfo) => {
      await installMockCoreApi(page, createMockCoreState())
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.goto('/social')
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      await page.locator('.user-settings-modal .theme-option', { hasText: theme === 'Custom Light' ? 'Light' : theme }).click()
      if (theme === 'Custom Light') {
        await page.locator('.user-settings-modal .theme-option', { hasText: 'Custom' }).click()
        await page.getByRole('textbox', { name: 'Custom theme hex color' }).fill('#00a896')
        await page.getByRole('textbox', { name: 'Custom theme hex color' }).press('Enter')
      }
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      const badge = page.locator('.shell-brand-release')
      await expect(badge).toHaveText('Beta v0.2.0-test')
      await expect(badge.locator('span')).toHaveCount(0)
      for (const width of [1920, 1100, 1024, 390, 320]) {
        await page.setViewportSize({ width, height: width < 1024 ? 844 : 768 })
        await expect(badge).toBeVisible({ visible: width >= 1024 })
        const style = await badge.evaluate(element => ({
          dot: getComputedStyle(element, '::before').content,
          shadow: getComputedStyle(element).boxShadow,
          overflow: element.scrollWidth > element.clientWidth + 1,
          headerOverflow: element.closest('.shell-topbar')!.scrollWidth > element.closest('.shell-topbar')!.clientWidth + 1,
        }))
        expect(style.dot).toBe('none')
        expect(style.shadow).toBe('none')
        if (width >= 1024) expect(style.overflow).toBe(false)
        expect(style.headerOverflow).toBe(false)
        await page.evaluate(() => Promise.all(document.getAnimations()
          .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map(animation => animation.finished.catch(() => {}))))
        await page.screenshot({ path: testInfo.outputPath(`beta-${width}.png`) })
        await page.locator('.shell-brand').screenshot({ path: testInfo.outputPath(`beta-brand-${width}.png`) })
      }
    })
  }

  for (const theme of ['Dark', 'Light']) {
    test(`outlines Social DM rows and Friends filters in ${theme}`, async ({ page }, testInfo) => {
      const friend = buildFriends(1)[0]
      await installMockCoreApi(page, createMockCoreState({
        friends: [friend],
        dmChannels: [{ id: 'dm-outline', peer_id: friend.id, peer_username: friend.username, peer_status: 'online', peer_avatar_url: null, unread_count: 0, last_message_at: null, pinned_at: null, is_pinned: false }],
      }))
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.goto('/social')
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      await page.locator('.user-settings-modal .theme-option', { hasText: theme }).click()
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      const row = page.locator('.social-dm-item').first()
      const border = (element: HTMLElement | SVGElement) => {
        const style = getComputedStyle(element)
        return { width: style.borderTopWidth, color: style.borderTopColor }
      }
      await expect(row).toBeVisible()
      const idleBorder = await row.evaluate(border)
      expect(idleBorder.width).toBe('1px')
      expect(idleBorder.color).not.toBe('rgba(0, 0, 0, 0)')
      await row.hover()
      expect((await row.evaluate(border)).color).not.toBe(idleBorder.color)
      const openDm = row.locator('.social-dm-open')
      await openDm.focus()
      await expect(openDm).toBeFocused()
      expect((await row.evaluate(border)).color).not.toBe(idleBorder.color)
      await page.locator('.home-page').screenshot({ path: testInfo.outputPath('social-outlines.png') })
      await openDm.press('Enter')
      await expect(row).toHaveClass(/active/)
      const friendsNav = page.locator('.social-nav-item')
      const navBorder = await friendsNav.evaluate(border)
      expect(navBorder.width).toBe('1px')
      expect(navBorder.color).not.toBe('rgba(0, 0, 0, 0)')
      const sidebarBox = (await page.locator('.social-sidebar').boundingBox())!
      const rowBox = (await row.boundingBox())!
      const navBox = (await friendsNav.boundingBox())!
      expect(rowBox.width).toBeCloseTo(navBox.width, 0)
      expect(rowBox.x - sidebarBox.x).toBeGreaterThanOrEqual(16)
      expect(sidebarBox.x + sidebarBox.width - rowBox.x - rowBox.width).toBeGreaterThanOrEqual(16)
      await friendsNav.focus()
      await expect(friendsNav).toHaveCSS('outline-style', 'solid')
      await friendsNav.press('Enter')
      await expect(friendsNav).toHaveAttribute('aria-current', 'page')
      for (const width of [1920, 1100, 390, 320]) {
        await page.setViewportSize({ width, height: 844 })
        const filters = page.getByRole('group', { name: 'Friends filters' })
        await expect(filters).toBeVisible()
        for (const name of ['Online', 'All', 'Add Friend']) {
          const button = filters.getByRole('button', { name: name === 'Add Friend' ? /^Add Friend/ : name, exact: name !== 'Add Friend' })
          const outline = await button.evaluate(border)
          expect(outline.width).toBe('1px')
          expect(outline.color).not.toBe('rgba(0, 0, 0, 0)')
          await button.click()
          await expect(button).toHaveAttribute('aria-pressed', 'true')
          expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        }
        expect(await page.locator('.home-main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        await page.locator('.home-main').screenshot({ path: testInfo.outputPath(`friends-filters-${width}.png`) })
      }
    })
  }

  test('serializes captured desktop shortcut saves and retains the previous key on failure', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState())
    await page.addInitScript(() => {
      const registered = new Set<string>()
      const calls: string[] = []
      Reflect.set(window, '__shortcutCalls', calls)
      Reflect.set(window, '__TAURI_INTERNALS__', {
        invoke: async (command: string, args?: { shortcut?: string; shortcuts?: string[]; payload?: { prefixedKey?: string } }) => {
          if (command === 'plugin:app|version') return '0.3.0'
          if (command === 'plugin:autostart|is_enabled') return true
          if (command === 'plugin:secure-storage|get_item' && args?.payload?.prefixedKey === 'voxpery-auth-token') return 'mock-token'
          if (command === 'plugin:global-shortcut|is_registered') return registered.has(args?.shortcut ?? '')
          if (command === 'plugin:global-shortcut|unregister') {
            args?.shortcuts?.forEach(key => registered.delete(key))
          }
          if (command === 'plugin:global-shortcut|register') {
            const key = args!.shortcuts![0]
            calls.push(key)
            if (Reflect.get(window, '__rejectNextShortcut')) {
              Reflect.set(window, '__rejectNextShortcut', false)
              throw new Error('Shortcut occupied')
            }
            if (calls.length === 1) await new Promise<void>(resolve => Reflect.set(window, '__releaseShortcut', resolve))
            registered.add(key)
          }
          return null
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        convertFileSrc: (path: string) => path,
      })
    })
    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Voice & Audio', exact: true }).click()
    const modal = page.locator('.user-settings-modal')
    const row = modal.locator('.user-setting-row', { hasText: 'Toggle microphone mute' })
    await expect(row).toContainText('system-wide while Voxpery is running')
    await row.getByRole('button', { name: 'Set shortcut' }).click()
    await page.keyboard.down('F5')
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__shortcutCalls'))).toEqual(['F5'])
    await page.keyboard.down('F5')
    await page.keyboard.press('G')
    await page.keyboard.up('F5')
    expect(await page.evaluate(() => Reflect.get(window, '__shortcutCalls'))).toEqual(['F5'])
    await page.evaluate(() => Reflect.get(window, '__releaseShortcut')())
    await expect(row.getByRole('button', { name: 'Rebind' })).toBeEnabled()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('voxpery-settings-global-mute-shortcut'))).toBe('F5')
    await page.evaluate(() => Reflect.set(window, '__rejectNextShortcut', true))
    await row.getByRole('button', { name: 'Rebind' }).click()
    await page.keyboard.press('Control+Shift+M')
    await expect(row).toContainText('This shortcut is unavailable')
    expect(await page.evaluate(() => localStorage.getItem('voxpery-settings-global-mute-shortcut'))).toBe('F5')
    expect(await page.evaluate(() => Reflect.get(window, '__shortcutCalls'))).toEqual(['F5', 'CommandOrControl+Shift+M', 'F5'])
    await page.keyboard.press('Escape')
    await row.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('voxpery-settings-global-mute-shortcut'))).toBeNull()
  })

  test('keeps developer diagnostics out of web settings and uses web-specific copy', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.addInitScript(() => localStorage.setItem('voxperyVoiceDiagnostics', '1'))

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()

    const modal = page.locator('.user-settings-modal')
    await expect(modal.locator('.user-settings-subtitle')).toContainText('account, appearance, communication, voice, and privacy')
    await expect(modal.locator('.user-settings-subtitle')).not.toContainText('desktop')
    await page.getByRole('button', { name: 'Communication' }).click()
    await expect(modal.getByText('Browser notifications', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Voice & Audio' }).click()
    await expect(modal.getByText('Benchmark diagnostics', { exact: true })).toHaveCount(0)
  })

  test('captures an unmodified mute key without assigning mouse buttons', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState())
    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Voice & Audio' }).click()
    const modal = page.locator('.user-settings-modal')

    await modal.getByRole('button', { name: 'Set shortcut' }).click()
    await page.keyboard.press('F')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('voxpery-settings-global-mute-shortcut'))).toBe('F')
    await modal.getByRole('button', { name: 'Rebind' }).last().click()
    await page.evaluate(() => window.dispatchEvent(new MouseEvent('mousedown', {
      button: 3, bubbles: true, cancelable: true,
    })))
    await expect.poll(() => page.evaluate(() => localStorage.getItem('voxpery-settings-global-mute-shortcut'))).toBe('F')
    await page.keyboard.press('G')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('voxpery-settings-global-mute-shortcut'))).toBe('G')
    await modal.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(page.getByText('The microphone shortcut for this tab is no longer assigned.', { exact: true })).toBeVisible()
    await expect(page.getByText('The global microphone shortcut is no longer assigned.', { exact: true })).toHaveCount(0)
    for (const name of ['Input volume', 'Output volume']) {
      await expect(modal.getByRole('slider', { name, exact: true })).toBeVisible()
    }
    for (const name of ['Input sensitivity preset', 'Activation mode']) {
      await expect(modal.getByRole('combobox', { name, exact: true })).toBeVisible()
    }
    await modal.getByRole('button', { name: 'Communication', exact: true }).click()
    for (const name of ['Server message notifications', 'Who can send you DMs']) {
      await expect(modal.getByRole('combobox', { name, exact: true })).toBeVisible()
    }
  })

  test('switches built-in themes and resets appearance defaults without layout overflow', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()

    const modal = page.locator('.user-settings-modal')
    await expect(modal.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    await modal.locator('.theme-option', { hasText: 'Dark' }).click()
    await page.evaluate(() => {
      const probe = document.createElement('button')
      probe.className = 'chat-jump-to-latest theme-contract-probe'
      probe.textContent = 'Newest'
      document.body.appendChild(probe)
    })
    const darkTheme = await readAppearanceThemeSnapshot(page)

    await modal.locator('.theme-option', { hasText: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    const lightTheme = await readAppearanceThemeSnapshot(page)

    expect(darkTheme.modalSurface).not.toBe(lightTheme.modalSurface)
    expect(darkTheme.activeSettingsNavigation).not.toBe(lightTheme.activeSettingsNavigation)
    expect(darkTheme.serverActions).not.toBe(lightTheme.serverActions)
    expect(darkTheme.releaseBadge).not.toBe(lightTheme.releaseBadge)
    expect(darkTheme.jumpToLatest).not.toBe(lightTheme.jumpToLatest)
    await expect.poll(async () => {
      return page.locator('.server-sidebar-actions').evaluate((element) => getComputedStyle(element).backgroundImage)
    }).toContain('rgb(232, 235, 240)')

    await expectNoHorizontalOverflow(modal)

    await modal.getByRole('button', { name: 'Reset defaults' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'voxpery')
    await expect(modal.getByRole('button', { name: 'Reset defaults' })).toBeDisabled()

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'voxpery')
    await expect(page.locator('html')).not.toHaveAttribute('data-custom-accent', 'true')
  })

  test('persists a generated full theme from one custom color', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()

    const modal = page.locator('.user-settings-modal')
    const themeGroup = modal.getByRole('group', { name: 'Theme' })
    await expect(themeGroup.locator('.theme-option')).toHaveCount(4)
    await expect(themeGroup.locator('.theme-option-label')).toHaveText(['Default', 'Custom', 'Dark', 'Light'])
    await expect(themeGroup.getByRole('button', { name: /Default/ })).toBeVisible()
    await expect(themeGroup.getByRole('button', { name: /Dark/ })).toBeVisible()
    await expect(themeGroup.getByRole('button', { name: /Light/ })).toBeVisible()
    await expect(themeGroup.getByRole('button', { name: /Custom/ })).toBeVisible()
    await expect(modal.locator('.theme-custom-panel')).toHaveCount(0)
    await modal.getByRole('button', { name: /Custom/ }).click()
    await expect(modal.locator('.theme-custom-panel')).toBeVisible()
    const customThemeInput = modal.getByRole('textbox', { name: 'Custom theme hex color' })
    await expect(customThemeInput).toHaveAttribute('maxlength', '7')
    await customThemeInput.fill('7b3fc6')
    await customThemeInput.press('Enter')
    await expect(customThemeInput).toHaveValue('#7b3fc6')
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme-mode', 'dark')
    await expect(modal.getByText('Custom theme color', { exact: true })).toBeVisible()
    await expect(modal.getByText('Background style', { exact: true })).toHaveCount(0)
    const appearanceScrolls = await modal.locator('.user-settings-scroll').evaluate((element) => (
      element.scrollHeight > element.clientHeight + 1
    ))
    expect(appearanceScrolls).toBe(false)
    const customAccentInput = modal.getByRole('textbox', { name: 'Custom accent hex color' })
    await expect(customAccentInput).toBeVisible()
    await expect(customAccentInput).toHaveAttribute('maxlength', '7')
    await customAccentInput.fill('#2f9b78')
    await customAccentInput.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-custom-accent', 'true')
    await expect(page.locator('html')).toHaveCSS('--user-accent', '#2f9b78')
    await expectNoHorizontalOverflow(modal)

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(modal)

    const generatedBackground = await page.locator('html').evaluate((element) => (
      getComputedStyle(element).getPropertyValue('--user-theme-bg-primary').trim()
    ))
    expect(generatedBackground).toMatch(/^#[0-9a-f]{6}$/)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme-mode', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-custom-accent', 'true')
    await expect(page.locator('html')).toHaveCSS('--user-accent', '#2f9b78')
    await expect(page.locator('html')).toHaveCSS('--user-theme-bg-primary', generatedBackground)
  })

  test('keeps member, voice, callbar, and image-preview chrome readable across themes', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.evaluate(() => {
      const fixture = document.createElement('div')
      fixture.id = 'appearance-contract-fixture'
      fixture.style.cssText = 'position:fixed;left:-10000px;top:0;width:480px;'
      fixture.innerHTML = `
        <span class="appearance-primary-reference">Primary</span>
        <span class="appearance-secondary-reference">Secondary</span>
        <aside class="member-sidebar">
          <div class="member-item"><span class="member-name">Readable member</span></div>
        </aside>
        <div class="voice-stage-tile">
          <span class="voice-stage-name">Voice member</span>
          <span class="voice-stage-sub">In voice</span>
        </div>
        <div class="callbar-frame active-call-bar">
          <button class="active-call-title-btn">Voice channel</button>
          <button class="callbar-control-btn">Control</button>
        </div>
        <div class="chat-image-preview-modal">
          <div class="chat-image-preview-toolbar">
            <span class="chat-image-preview-title">Image preview</span>
          </div>
          <div class="chat-image-preview-stage"></div>
        </div>
      `
      fixture.querySelector<HTMLElement>('.appearance-primary-reference')!.style.color = 'var(--text-primary)'
      fixture.querySelector<HTMLElement>('.appearance-secondary-reference')!.style.color = 'var(--text-secondary)'
      document.body.appendChild(fixture)
    })

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()
    const modal = page.locator('.user-settings-modal')

    await modal.locator('.theme-option', { hasText: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const dark = await readSettledSemanticThemeSnapshot(page)

    await modal.locator('.theme-option', { hasText: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    const light = await readSettledSemanticThemeSnapshot(page)

    await modal.getByRole('button', { name: /Custom/ }).click()
    const customInput = modal.getByRole('textbox', { name: 'Custom theme hex color' })
    await customInput.fill('#8d50ca')
    await customInput.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme', 'true')
    const custom = await readSettledSemanticThemeSnapshot(page)

    expect(light.memberSurface).not.toBe(dark.memberSurface)
    expect(light.voiceSurface).not.toBe(dark.voiceSurface)
    expect(light.callbarSurface).not.toBe(dark.callbarSurface)
    expect(light.previewSurface).not.toBe(dark.previewSurface)
    expect(custom.voiceSurface).not.toBe(dark.voiceSurface)
  })

  test('keeps a single support link inside the footer on Social and server views', async ({ page }) => {
    const server = buildCoreServer()
    const state = createMockCoreState({
      friends: buildFriends(2),
      servers: [server],
      channelsByServerId: { [server.id]: buildCoreChannels(server.id) },
      membersByServerId: { [server.id]: buildCoreMembers() },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 620 })
    await page.addInitScript(() => {
      window.open = (url) => { Reflect.set(window, '__supportOpenedUrl', String(url)); return null }
    })

    for (const path of ['/social', '/servers']) {
      await page.goto(path)
      if (path === '/servers') {
        await expect(page.locator('.channel-header-title')).toHaveText('Core Guild')
        await expect(page.locator('.member-sidebar')).toHaveCSS('width', '240px')
      }
      if (path === '/social') {
        const resources = page.getByRole('navigation', { name: 'Voxpery resources' })
        await expect(page.locator('.home-side').getByRole('heading', { name: 'Friend Activity' })).toBeVisible()
        await expect(resources.locator(':scope > *')).toHaveCount(3)
        for (const action of await resources.locator(':scope > *').all()) {
          await expect(action).toHaveCSS('border-top-width', '1px')
          await expect(action).toHaveCSS('cursor', 'pointer')
          await expect(action.locator('.social-resource-link-trailing')).toBeVisible()
          await action.focus()
          await expect(action).toHaveCSS('outline-style', 'solid')
        }
      }
      await expect(page.locator('.feedback-card')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Share feedback on GitHub' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Report a bug' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Request a feature' })).toHaveCount(0)
      const support = page.getByRole('link', { name: 'Support Voxpery' })
      await expect(support).toHaveCount(1)
      await expect(support).toHaveAttribute('href', 'https://github.com/sponsors/emircanagac')
      await expect(support).toHaveCSS('border-top-style', 'solid')
      await expect(support).toHaveCSS('border-top-width', '1px')
      await expect(support.locator('.social-resource-link-trailing')).toBeVisible()
      const idleBackground = await support.evaluate((element) => getComputedStyle(element).backgroundColor)
      expect(idleBackground).not.toBe('rgba(0, 0, 0, 0)')
      await support.focus()
      await expect(support).toBeFocused()
      await expect(support).toHaveCSS('outline-style', 'solid')
      await expectCompactSupportDock(page)
      await page.screenshot({ path: `test-results/support-footer-${path.slice(1)}.png` })
      await support.click({ position: { x: 4, y: 4 } })
      expect(await page.evaluate(() => Reflect.get(window, '__supportOpenedUrl')))
        .toBe('https://github.com/sponsors/emircanagac')
      await expect(page).toHaveURL(new RegExp(`${path}$`))
    }
  })

  test('keeps profile password modal validation and submission wired', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    const profileScrollMetrics = await page.locator('.user-settings-scroll').evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    expect(profileScrollMetrics.scrollHeight).toBeLessThanOrEqual(profileScrollMetrics.clientHeight + 1)

    const profileActionSizes = await page.locator(
      '.user-settings-scroll .account-action-btn, .user-settings-scroll .user-profile-save-button',
    ).evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element)
      return { width: style.width, height: style.height }
    }))
    expect(profileActionSizes.length).toBeGreaterThan(3)
    expect(new Set(profileActionSizes.map(({ width }) => width))).toEqual(new Set(['112px']))
    expect(new Set(profileActionSizes.map(({ height }) => height))).toEqual(new Set(['32px']))

    const profileCard = page.locator('.user-profile-preview-card')
    const aboutMe = profileCard.getByLabel('About me')
    await expect(aboutMe).toBeVisible()
    await expect(profileCard.getByRole('button', { name: 'Save about me' })).toBeVisible()
    const aboutMeLayout = await aboutMe.evaluate((element) => {
      const style = getComputedStyle(element)
      return { height: style.height, minHeight: style.minHeight, maxHeight: style.maxHeight, resize: style.resize }
    })
    expect(aboutMeLayout).toEqual({ height: '72px', minHeight: '72px', maxHeight: '72px', resize: 'none' })
    await aboutMe.fill('a'.repeat(190))
    await expect(page.locator('.user-profile-field-count')).toHaveText('190/190')

    await page.locator('.user-setting-row', { hasText: 'Password' }).getByRole('button', { name: 'Change' }).click()
    const passwordModal = page.locator('.pw-modal', { hasText: 'Change password' })
    await expect(passwordModal).toBeVisible()

    const currentPassword = passwordModal.locator('#pw-old')
    const newPassword = passwordModal.locator('#pw-new')
    const confirmPassword = passwordModal.locator('#pw-confirm')
    const confirmButton = passwordModal.getByRole('button', { name: 'Confirm' })

    await expect(confirmButton).toBeDisabled()
    await currentPassword.fill('old-password-123')
    await newPassword.fill('new-password-123')
    await confirmPassword.fill('different-password')
    await expect(passwordModal.getByText('Passwords do not match')).toBeVisible()
    await expect(confirmButton).toBeDisabled()

    await confirmPassword.fill('new-password-123')
    await expect(confirmButton).toBeEnabled()
    await confirmButton.click()

    await expect(passwordModal.getByText(/Password changed! Redirecting to login/)).toBeVisible()
    expect(state.changePasswordRequestCount).toBe(1)
  })

  test('keeps Privacy & Data export and delete-account guardrails reachable', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Privacy & Data' }).click()

    const modal = page.locator('.user-settings-modal')
    await expect(modal).toContainText('Data export')
    await expect(modal).toContainText('Delete account')

    await modal.locator('.user-setting-row', { hasText: 'Data export' }).getByRole('button', { name: /Export/ }).click()
    const exportModal = page.locator('.data-export-modal')
    await expect(exportModal).toBeVisible()
    await expect(exportModal).toContainText('not encrypted')
    await expect(exportModal.getByRole('button', { name: 'Download ZIP' })).toBeDisabled()
    await exportModal.locator('#export-password').fill('current-password-123')
    const downloadPromise = page.waitForEvent('download')
    await exportModal.getByRole('button', { name: 'Download ZIP' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^voxpery-data-export-\d{4}-\d{2}-\d{2}\.zip$/)
    await expect(page.locator('.toast-item', { hasText: 'Data export ready' })).toBeVisible()
    expect(state.dataExportRequestCount).toBe(1)
    expect(state.lastDataExportPassword).toBe('current-password-123')

    await expect(modal).toBeVisible()
    await expect(modal).toContainText('Data export')
    await modal.locator('.user-setting-row', { hasText: 'Delete account' }).getByRole('button', { name: 'Manage' }).click()
    const deleteModal = page.locator('.delete-account-modal')
    await expect(deleteModal).toBeVisible()
    const deleteButton = deleteModal.getByRole('button', { name: 'Delete account' })
    await expect(deleteButton).toBeDisabled()

    await deleteModal.locator('#delete-password').fill('current-password-123')
    await deleteModal.locator('#delete-confirm').fill('DELETE')
    await expect(deleteModal.getByText('Confirmation text is valid.')).toBeVisible()
    await expect(deleteButton).toBeEnabled()
    await deleteButton.click()

    await expect(page).toHaveURL(/\/login/)
    expect(state.deleteAccountRequestCount).toBe(1)
    expect(state.lastDeleteAccountConfirm).toBe('DELETE')
  })
  for (const width of [1920, 800]) {
    test(`returns to Privacy & Data after cancelling export or deletion at ${width}px`, async ({ page }) => {
      await installMockCoreApi(page, createMockCoreState())
      await page.setViewportSize({ width, height: 600 })
      await page.goto('/social')
      await page.getByRole('button', { name: width >= 1024 ? 'Settings' : 'View my profile', exact: true }).click()
      if (width < 1024) await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
      const settings = page.locator('.user-settings-modal')
      if (width < 1024) await settings.getByRole('combobox', { name: 'Settings section' }).selectOption('privacy')
      else await settings.getByRole('button', { name: 'Privacy & Data', exact: true }).click()
      for (const [action, title] of [['Export', 'Create data export'], ['Manage', 'Delete account']]) {
      const opener = settings.getByRole('button', { name: action, exact: true })
      for (const dismissal of ['cancel', 'escape', 'backdrop']) {
        await opener.click()
        const dialog = page.getByRole('dialog', { name: title, exact: true })
        await expect(settings).toBeVisible()
        await expect(settings.locator('..')).toHaveAttribute('inert', '')
        if (action === 'Export') {
          const password = dialog.getByLabel('Current password', { exact: true })
          await expect(password).toBeFocused()
          await expect(password).toHaveValue('')
          await expect(dialog.getByRole('button', { name: 'Download ZIP' })).toBeDisabled()
          await password.fill('unsent-test-password')
        } else {
          await expect(dialog.locator('#delete-password')).toHaveValue('')
          await expect(dialog.locator('#delete-confirm')).toHaveValue('')
          await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toBeDisabled()
          await dialog.locator('#delete-password').fill('unsent-test-password')
          await dialog.locator('#delete-confirm').fill('DELETE')
        }
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus()
        await page.keyboard.press('Tab')
        expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
        if (dismissal === 'cancel') await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
        else if (dismissal === 'escape') await page.keyboard.press('Escape')
        else await page.locator('.modal-overlay').filter({ has: dialog }).click({ position: { x: 2, y: 2 } })
        await expect(dialog).toHaveCount(0)
        await expect(settings.locator('..')).not.toHaveAttribute('inert')
        await expect(opener).toBeFocused()
        await expect(settings).toContainText('Data export')
        await expect(page.locator('#root')).toHaveAttribute('inert', '')
      }
      }
      await page.keyboard.press('Escape')
      await expect(settings).toHaveCount(0)
      await expect(page.locator('#root')).not.toHaveAttribute('inert')
    })
  }
})

async function expectFlatSettingsSurfaces(modal: Locator) {
  expect(await modal.evaluate(element => [element, ...element.querySelectorAll('*')].flatMap(node => {
    const styles = ['', '::before', '::after'].map(pseudo => getComputedStyle(node, pseudo || null))
    return styles.filter(style => /gradient\(/.test(style.backgroundImage) || style.backdropFilter !== 'none' || style.filter !== 'none')
      .map(() => node.className)
  }))).toEqual([])
}

async function expectNoHorizontalOverflow(locator: import('@playwright/test').Locator) {
  await expect.poll(async () => {
    return locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
  }).toBe(true)
}

async function expectCompactSupportDock(page: import('@playwright/test').Page) {
  const dock = page.locator('.support-dock')
  const card = dock.locator('.project-support-link')
  await expect(dock).toBeVisible()
  await expect(card).toBeVisible()

  const boxes = await Promise.all([dock.boundingBox(), card.boundingBox()])
  const [dockBox, cardBox] = boxes
  expect(dockBox).not.toBeNull()
  expect(cardBox).not.toBeNull()
  if (!dockBox || !cardBox) return

  expect(dockBox.width).toBe(240)
  expect(dockBox.height).toBe(80)
  const insets = [
    cardBox.x - dockBox.x,
    dockBox.x + dockBox.width - cardBox.x - cardBox.width,
    cardBox.y - dockBox.y,
    dockBox.y + dockBox.height - cardBox.y - cardBox.height,
  ]
  expect(Math.min(...insets)).toBeGreaterThanOrEqual(7)
  expect(Math.max(...insets) - Math.min(...insets)).toBeLessThanOrEqual(1)
}

async function readAppearanceThemeSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const backgroundOf = (selector: string) => {
      const target = document.querySelector(selector)
      if (!target) throw new Error(`Missing appearance theme target: ${selector}`)
      return getComputedStyle(target).background
    }

    return {
      modalSurface: backgroundOf('.user-settings-modal'),
      activeSettingsNavigation: backgroundOf('.user-settings-nav__item--active'),
      serverActions: backgroundOf('.server-sidebar-actions'),
      releaseBadge: backgroundOf('.shell-brand-release'),
      jumpToLatest: backgroundOf('.theme-contract-probe'),
    }
  })
}

type SemanticThemeSnapshot = Awaited<ReturnType<typeof readSemanticThemeSnapshot>>

async function expectViewportPopup(popup: Locator, portalled = true) {
  await expect(popup).toBeVisible()
  await expect.poll(() => popup.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return rect.left >= 7 && rect.top >= 7
      && rect.right <= window.innerWidth - 7 && rect.bottom <= window.innerHeight - 7
      && element.scrollWidth <= element.clientWidth + 1
  })).toBe(true)
  if (portalled) expect(await popup.evaluate(element => element.parentElement === document.body)).toBe(true)
}

async function readSemanticThemeSnapshot(page: Page) {
  return page.evaluate(() => {
    const style = (selector: string) => {
      const target = document.querySelector(selector)
      if (!target) throw new Error(`Missing semantic theme target: ${selector}`)
      return getComputedStyle(target)
    }
    return {
      primary: style('.appearance-primary-reference').color,
      secondary: style('.appearance-secondary-reference').color,
      memberText: style('#appearance-contract-fixture .member-name').color,
      voiceName: style('#appearance-contract-fixture .voice-stage-name').color,
      voiceSub: style('#appearance-contract-fixture .voice-stage-sub').color,
      callbarText: style('#appearance-contract-fixture .active-call-title-btn').color,
      previewText: style('#appearance-contract-fixture .chat-image-preview-title').color,
      memberSurface: style('#appearance-contract-fixture .member-item').background,
      voiceSurface: style('#appearance-contract-fixture .voice-stage-tile').background,
      callbarSurface: style('#appearance-contract-fixture .active-call-bar').background,
      previewSurface: style('#appearance-contract-fixture .chat-image-preview-modal').background,
    }
  })
}

function assertSemanticTextContract(snapshot: SemanticThemeSnapshot) {
  expect(snapshot.memberText).toBe(snapshot.primary)
  expect(snapshot.voiceName).toBe(snapshot.primary)
  expect(snapshot.voiceSub).toBe(snapshot.secondary)
  expect(snapshot.callbarText).toBe(snapshot.secondary)
  expect(snapshot.previewText).toBe(snapshot.secondary)
}

async function readSettledSemanticThemeSnapshot(page: import('@playwright/test').Page) {
  await expect.poll(async () => {
    const snapshot = await readSemanticThemeSnapshot(page)
    return snapshot.memberText === snapshot.primary
      && snapshot.voiceName === snapshot.primary
      && snapshot.voiceSub === snapshot.secondary
      && snapshot.callbarText === snapshot.secondary
      && snapshot.previewText === snapshot.secondary
  }).toBe(true)
  const snapshot = await readSemanticThemeSnapshot(page)
  assertSemanticTextContract(snapshot)
  return snapshot
}
