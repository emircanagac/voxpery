import { expect, test } from '@playwright/test'
import {
  buildCoreChannels,
  buildCoreMembers,
  buildCoreServer,
  buildServerMessage,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

test('loads an old pinned target, returns to newest, and reports a removed target', async ({ page }) => {
  const server = buildCoreServer()
  const channels = buildCoreChannels(server.id)
  const general = channels[0]
  const messages = Array.from({ length: 65 }, (_, index) => buildServerMessage(
    general.id,
    index === 0 ? 'Old pinned target' : `History message ${index}`,
    {
      id: `history-${index}`,
      created_at: new Date(Date.UTC(2026, 0, 15, 10, index)).toISOString(),
    },
  ))
  const state = createMockCoreState({
    servers: [server],
    channelsByServerId: { [server.id]: channels },
    membersByServerId: { [server.id]: buildCoreMembers() },
    messagesByChannelId: { [general.id]: messages },
    pinnedMessageIdsByChannelId: { [general.id]: ['history-0'] },
  })
  await installMockCoreApi(page, state)
  await page.goto('/servers')

  await expect(page.locator('[data-message-id="history-0"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Pinned messages' }).click()
  await page.getByRole('button', { name: 'Go to message' }).click()
  await expect(page.locator('[data-message-id="history-0"]')).toBeVisible()
  await page.getByRole('button', { name: 'Jump to latest messages' }).click()
  await expect(page.locator('[data-message-id="history-64"]')).toBeVisible()
  await expect(page.locator('[data-message-id="history-0"]')).toHaveCount(0)

  state.messagesByChannelId[general.id] = messages.slice(1)
  await page.getByRole('button', { name: 'Pinned messages' }).click()
  await page.getByRole('button', { name: 'Go to message' }).click()
  await expect(page.getByText('This pinned message is no longer available.')).toBeVisible()
})

test('keeps server rows and create/join dialogs usable from the keyboard', async ({ page }) => {
  const server = buildCoreServer()
  const state = createMockCoreState({
    servers: [server],
    channelsByServerId: { [server.id]: buildCoreChannels(server.id) },
    membersByServerId: { [server.id]: buildCoreMembers() },
  })
  await installMockCoreApi(page, state)
  await page.goto('/servers')

  const channel = page.getByRole('button', { name: 'Text channel announcements' })
  await channel.focus()
  await channel.press('Enter')
  await expect(page.locator('.chat-header .channel-title')).toHaveText('announcements')
  await channel.press('Shift+F10')
  const channelMenu = page.getByRole('menu', { name: 'Actions for announcements' })
  await expect(channelMenu).toBeVisible()
  await expect(channelMenu.getByRole('menuitem').first()).toBeFocused()
  await channelMenu.press('Escape')
  await expect(channel).toBeFocused()

  const member = page.getByRole('button', { name: 'View profile for Friend 01' })
  await member.focus()
  await member.press('ContextMenu')
  const memberMenu = page.getByRole('menu', { name: 'Actions for Friend 01' })
  await expect(memberMenu.getByRole('menuitem').first()).toBeFocused()
  await memberMenu.press('Escape')
  await expect(member).toBeFocused()

  const create = page.locator('.server-sidebar-actions').getByRole('button', { name: 'Create Server' })
  await create.click()
  const createDialog = page.getByRole('dialog', { name: 'Create a Server' })
  const nameInput = createDialog.getByPlaceholder('My Awesome Server')
  await expect(nameInput).toBeFocused()
  // Create stays disabled until a name is typed, so focus wraps to the last enabled control.
  await nameInput.press('Shift+Tab')
  await expect(createDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(nameInput).toBeFocused()
  await nameInput.fill('Keyboard Guild')
  await nameInput.press('Shift+Tab')
  await expect(createDialog.getByRole('button', { name: 'Create', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(nameInput).toBeFocused()
  await nameInput.press('Escape')
  await expect(createDialog).toHaveCount(0)
  await expect(create).toBeFocused()

  const join = page.locator('.server-sidebar-actions').getByRole('button', { name: 'Join Server' })
  await join.click()
  const joinDialog = page.getByRole('dialog', { name: 'Join a Server' })
  await expect(joinDialog.getByPlaceholder('Paste an invite link or short code')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(joinDialog).toHaveCount(0)
  await expect(join).toBeFocused()
})

test('shows long external links in a wider warning without horizontal overflow', async ({ page }) => {
  const server = buildCoreServer()
  const channels = buildCoreChannels(server.id)
  const url = 'https://github.com/emircanagac/voxpery/issues/355'
  const state = createMockCoreState({
    servers: [server],
    channelsByServerId: { [server.id]: channels },
    membersByServerId: { [server.id]: buildCoreMembers() },
    messagesByChannelId: { [channels[0].id]: [buildServerMessage(channels[0].id, url)] },
  })
  await installMockCoreApi(page, state)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/servers')

  await page.getByRole('link', { name: url }).click()
  const warning = page.getByRole('dialog', { name: 'External Link Warning' })
  await expect(warning).toBeVisible()
  await expect(warning.getByRole('button', { name: 'Cancel' })).toBeFocused()
  const size = await warning.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    urlOverflows: element.querySelector('.external-link-warning-url')!.scrollWidth
      > element.querySelector('.external-link-warning-url')!.clientWidth + 1,
  }))
  expect(size.width).toBeGreaterThanOrEqual(480)
  expect(size.urlOverflows).toBe(false)

  await page.setViewportSize({ width: 390, height: 740 })
  const mobileWidth = await warning.evaluate((element) => element.getBoundingClientRect().width)
  expect(mobileWidth).toBeLessThanOrEqual(358)
  await page.keyboard.press('Escape')
  await expect(warning).toHaveCount(0)
  await expect(page.getByRole('link', { name: url })).toBeFocused()
})

test('returns focus to the control that opened the Create Channel dialog', async ({ page }) => {
  const server = buildCoreServer()
  await installMockCoreApi(page, createMockCoreState({
    servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) }, membersByServerId: { [server.id]: buildCoreMembers() },
  }))
  await page.goto('/servers')
  const add = page.getByRole('button', { name: 'Create channel in GENERAL' })
  await add.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Create Channel' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(add).toBeFocused()

  await page.locator('.channel-sidebar').click({ button: 'right', position: { x: 100, y: 400 } })
  await page.getByRole('menuitem', { name: 'Create Channel' }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.channel-header-server')).toBeFocused()
})

test('opens the server icon menu from the keyboard and returns focus on Escape', async ({ page }) => {
  const server = buildCoreServer()
  await installMockCoreApi(page, createMockCoreState({
    servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) }, membersByServerId: { [server.id]: buildCoreMembers() },
  }))
  await page.goto('/servers')
  const icon = page.locator(`.server-icon[data-server-id="${server.id}"]`)
  await icon.focus()
  await icon.press('Shift+F10')
  const menu = page.getByRole('menu', { name: `Actions for ${server.name}` })
  const items = menu.getByRole('menuitem')
  await expect(items.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(1)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(icon).toBeFocused()
})
