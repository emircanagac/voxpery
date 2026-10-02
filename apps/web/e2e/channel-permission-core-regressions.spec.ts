import { expect, test } from '@playwright/test'
import {
  buildCoreChannels,
  buildCoreMembers,
  buildCoreServer,
  buildServerMessage,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

const PERM_VIEW_CHANNEL = 1 << 0
const PERM_MANAGE_CHANNELS = 1 << 3
const PERM_SEND_MESSAGES = 1 << 7
const PERM_MANAGE_MESSAGES = 1 << 8
const PERM_MANAGE_PINS = 1 << 9
const PERM_CONNECT_VOICE = 1 << 10

test.describe('mocked channel permission regressions', () => {
  test('creates and renames hash-named categories and text/voice channels without relaxing invalid-name checks', async ({ page }) => {
    const server = buildCoreServer()
    const state = createMockCoreState({
      servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) },
      membersByServerId: { [server.id]: buildCoreMembers() },
    })
    await installMockCoreApi(page, state)
    const categories = [{ name: 'GENERAL', position: 0 }, { name: 'VOICE', position: 1 }]
    let categoryWrites = 0
    await page.route('**/api/channels/*', async route => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      const id = new URL(route.request().url()).pathname.split('/').at(-1)
      const channel = state.channelsByServerId[server.id].find(entry => entry.id === id)
      if (!channel) return route.fallback()
      Object.assign(channel, route.request().postDataJSON())
      await route.fulfill({ json: channel })
    })
    await page.route('**/api/channels/server/**/categories**', async route => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      const base = `/api/channels/server/${server.id}/categories`
      if (pathname === base && request.method() === 'POST') {
        categoryWrites++
        const { name } = request.postDataJSON() as { name: string }
        categories.push({ name, position: categories.length })
        await route.fulfill({ json: categories.at(-1) })
      } else if (pathname === base && request.method() === 'GET') {
        await route.fulfill({ json: categories })
      } else if (pathname.startsWith(`${base}/`) && request.method() === 'PATCH') {
        const oldName = decodeURIComponent(pathname.slice(base.length + 1))
        expect(oldName).toBe('#Topics')
        expect(request.url()).toContain('%23Topics')
        const { name } = request.postDataJSON() as { name: string }
        categories.find(category => category.name === oldName)!.name = name
        state.channelsByServerId[server.id].forEach(channel => {
          if (channel.category === oldName) channel.category = name
        })
        await route.fulfill({ json: { name } })
      } else await route.fallback()
    })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/servers')
    await expect(page.getByRole('button', { name: 'Create channel in GENERAL' })).toBeVisible()
    const list = page.locator('.channel-list')
    const bounds = await list.boundingBox()
    if (!bounds) throw new Error('Channel list is missing')
    await list.click({ button: 'right', position: { x: 10, y: bounds.height - 12 } })
    await page.getByRole('menuitem', { name: 'Create Category', exact: true }).click()
    const modal = page.locator('.modal-create-channel')
    await modal.getByPlaceholder('e.g. Squad 1').fill('@invalid')
    await modal.getByRole('button', { name: 'Create Category', exact: true }).click()
    await expect(modal.locator('.auth-error')).toContainText("'#'")
    expect(categoryWrites).toBe(0)
    await modal.getByPlaceholder('e.g. Squad 1').fill('#Topics')
    await modal.getByRole('button', { name: 'Create Category', exact: true }).click()
    await expect(modal).toBeHidden()
    for (const [type, name] of [['Text', '#general'], ['Voice', 'voice #1']]) {
      await page.getByRole('button', { name: 'Create channel in #Topics', exact: true }).click()
      await modal.getByPlaceholder('e.g. general').fill(name)
      await modal.locator('.channel-type-option', { hasText: type }).click()
      await modal.getByRole('button', { name: 'Create Channel', exact: true }).click()
      await expect(modal).toBeHidden()
      expect(state.channelsByServerId[server.id].find(channel => channel.name === name)?.channel_type).toBe(type.toLowerCase())
      await page.locator('.channel-item', { hasText: name }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
      const rename = page.locator('.modal', { has: page.getByRole('heading', { name: 'Edit Channel', exact: true }) })
      await rename.getByPlaceholder('new-channel-name').fill(`${name} #2`)
      await rename.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(rename).toBeHidden()
      expect(state.channelsByServerId[server.id].some(channel => channel.name === `${name} #2`)).toBe(true)
    }
    await page.locator('.channel-category-btn', { hasText: '#Topics' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename Category', exact: true }).click()
    const renameCategory = page.locator('.modal', { has: page.getByRole('heading', { name: 'Rename Category', exact: true }) })
    await renameCategory.locator('input').fill('#Renamed')
    await renameCategory.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(renameCategory).toBeHidden()
    await expect(page.getByRole('button', { name: 'Create channel in #Renamed', exact: true })).toBeVisible()
  })

  test('locks server and channel controls when the session lacks manage/send permissions', async ({ page }) => {
    const server = buildCoreServer({
      owner_id: 'server-owner',
      name: 'Limited Guild',
    })
    const channels = buildCoreChannels(server.id).map((channel) => ({
      ...channel,
      my_permissions: PERM_VIEW_CHANNEL,
    }))
    const general = channels.find((channel) => channel.name === 'general')
    const voice = channels.find((channel) => channel.channel_type === 'voice')
    if (!general || !voice) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      serverPermissionsByServerId: { [server.id]: PERM_VIEW_CHANNEL },
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {
        [general.id]: [
          buildServerMessage(general.id, 'Remote message without send permission', { id: 'remote-message' }),
        ],
      },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')

    await expect(page.locator('.channel-header-title')).toHaveText('Limited Guild')
    await expect(page.getByTitle('Create Channel')).toHaveCount(0)
    await expect(page.getByTitle('Create Category')).toHaveCount(0)

    const input = page.getByPlaceholder("You don't have permission to send messages in #general")
    await expect(input).toBeVisible()
    await expect(input).toBeDisabled()
    await expect(page.locator('.message-input-wrapper input[type="file"]')).toBeDisabled()
    await expect(page.getByTitle('Emoji, GIFs and stickers')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Attach files' })).toBeDisabled()

    const remoteRow = page.locator('[data-message-id="remote-message"]')
    await expect(remoteRow).toBeVisible()
    await remoteRow.hover()
    await expect(remoteRow.getByRole('button', { name: 'Add reaction' })).toHaveCount(0)
    await expect(remoteRow.getByRole('button', { name: 'Pin' })).toHaveCount(0)
    await expect(remoteRow.getByRole('button', { name: 'Delete' })).toHaveCount(0)

    const voiceRow = page.locator('.channel-item', { hasText: voice.name })
    await expect(voiceRow).toHaveClass(/channel-item--disabled/)
    await expect(voiceRow).toHaveAttribute('title', "You don't have permission to connect to this voice channel.")
    await expect(voiceRow).toBeDisabled()
    await voiceRow.dispatchEvent('click')
    await expect(page.locator('.chat-header .channel-title')).toHaveText('general')
  })

  test('keeps allowed message actions while hiding moderator-only controls', async ({ page }) => {
    const server = buildCoreServer({ owner_id: 'server-owner' })
    const channels = buildCoreChannels(server.id).map((channel) => ({
      ...channel,
      my_permissions: channel.channel_type === 'voice'
        ? PERM_VIEW_CHANNEL | PERM_CONNECT_VOICE
        : PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES,
    }))
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      serverPermissionsByServerId: { [server.id]: PERM_VIEW_CHANNEL },
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {
        [general.id]: [
          buildServerMessage(general.id, 'Reactable remote message', { id: 'limited-remote-message' }),
          buildServerMessage(general.id, 'Own message stays editable', {
            id: 'limited-own-message',
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

    await expect(page.getByPlaceholder('Message #general')).toBeVisible()
    await expect(page.getByTitle('Create Channel')).toHaveCount(0)

    const remoteRow = page.locator('[data-message-id="limited-remote-message"]')
    await remoteRow.hover()
    await expect(remoteRow.getByRole('button', { name: 'Add reaction' })).toBeVisible()
    await expect(remoteRow.getByRole('button', { name: 'Pin' })).toHaveCount(0)
    await expect(remoteRow.getByRole('button', { name: 'Delete' })).toHaveCount(0)

    await remoteRow.getByRole('button', { name: 'Add reaction' }).click()
    await page.getByRole('button', { name: 'thumbs up' }).click()
    await expect(remoteRow.locator('.message-reaction-btn')).toContainText('1')

    const ownRow = page.locator('[data-message-id="limited-own-message"]')
    await ownRow.hover()
    await expect(ownRow.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(ownRow.getByRole('button', { name: 'Delete' })).toBeVisible()
    await expect(ownRow.getByRole('button', { name: 'Pin' })).toHaveCount(0)

    const content = `Limited permission send ${Date.now()}`
    const input = page.getByPlaceholder('Message #general')
    await input.fill(content)
    await input.press('Enter')

    await expect(page.getByText(content)).toBeVisible()
    expect(state.messagesByChannelId[general.id].some((message) => message.content === content)).toBe(true)
  })

  test('keeps a bottom-anchored chat at the latest row when a reaction adds height', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const messages = Array.from({ length: 48 }, (_, index) =>
      buildServerMessage(general.id, `Reaction anchor message ${index + 1}`, {
        id: index === 47 ? 'reaction-bottom-last' : `reaction-bottom-${index}`,
        created_at: new Date(Date.UTC(2026, 0, 15, 10, index)).toISOString(),
      })
    )
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: messages },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/servers')

    const scroller = page.locator('.chat-messages')
    const lastRow = page.locator('[data-message-id="reaction-bottom-last"]')
    await expect(lastRow).toBeVisible()
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => scroller.evaluate((element) =>
      Math.round(element.scrollHeight - element.scrollTop - element.clientHeight)
    )).toBeLessThanOrEqual(4)

    await lastRow.hover()
    await lastRow.getByRole('button', { name: 'Add reaction' }).click()
    await page.getByRole('button', { name: 'thumbs up' }).click()
    await expect(lastRow.locator('.message-reaction-btn')).toContainText('1')

    await expect.poll(() => scroller.evaluate((element) =>
      Math.round(element.scrollHeight - element.scrollTop - element.clientHeight)
    )).toBeLessThanOrEqual(4)
  })

  test('remeasures consecutive reaction rows without moving a history reader', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const targetIds = ['reaction-stack-a', 'reaction-stack-b', 'reaction-stack-c']
    const messages = Array.from({ length: 50 }, (_, index) =>
      buildServerMessage(general.id, `Reaction stack message ${index + 1}`, {
        id: index >= 2 && index <= 4 ? targetIds[index - 2] : `reaction-stack-${index}`,
        created_at: new Date(Date.UTC(2026, 0, 15, 11, index)).toISOString(),
      })
    )
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: messages },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/servers')

    const scroller = page.locator('.chat-messages')
    await expect.poll(() => scroller.evaluate((element) => (
      element.scrollHeight - element.clientHeight
    ))).toBeGreaterThan(200)
    await scroller.focus()
    await page.keyboard.press('Home')
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible()
    // Wait for keyboard scrolling and virtual row measurement before capturing an anchor.
    let previousTop = -1
    let stableSamples = 0
    await expect.poll(async () => {
      const top = await scroller.evaluate(element => element.scrollTop)
      stableSamples = top === previousTop ? stableSamples + 1 : 0
      previousTop = top
      return stableSamples
    }, { intervals: [100] }).toBeGreaterThanOrEqual(3)
    const firstRow = page.locator(`[data-message-id="${targetIds[0]}"]`)
    await expect(firstRow).toBeVisible()
    const anchorBefore = await firstRow.evaluate((element) => {
      const scrollerRect = element.closest('.chat-messages')?.getBoundingClientRect()
      return Math.round(element.getBoundingClientRect().top - (scrollerRect?.top ?? 0))
    })

    for (const targetId of targetIds) {
      const row = page.locator(`[data-message-id="${targetId}"]`)
      await row.hover()
      await row.getByRole('button', { name: 'Add reaction' }).click()
      await page.getByRole('button', { name: 'thumbs up' }).click()
      await expect(row.locator('.message-reaction-btn')).toContainText('1')
    }

    const bounds = await Promise.all(targetIds.map((targetId) =>
      page.locator(`[data-message-id="${targetId}"]`).boundingBox()
    ))
    expect(bounds.every(Boolean)).toBe(true)
    expect(bounds[0]!.y + bounds[0]!.height).toBeLessThanOrEqual(bounds[1]!.y + 1)
    expect(bounds[1]!.y + bounds[1]!.height).toBeLessThanOrEqual(bounds[2]!.y + 1)
    await expect.poll(() => firstRow.evaluate((element) => {
      const scrollerRect = element.closest('.chat-messages')?.getBoundingClientRect()
      return Math.round(element.getBoundingClientRect().top - (scrollerRect?.top ?? 0))
    })).toBe(anchorBefore)
  })

  test('exposes moderator controls only when channel permission bits allow them', async ({ page }) => {
    const server = buildCoreServer({ owner_id: 'server-owner' })
    const channels = buildCoreChannels(server.id).map((channel) => ({
      ...channel,
      my_permissions: channel.channel_type === 'voice'
        ? PERM_VIEW_CHANNEL | PERM_CONNECT_VOICE
        : PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_MANAGE_MESSAGES | PERM_MANAGE_PINS,
    }))
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      serverPermissionsByServerId: { [server.id]: PERM_VIEW_CHANNEL | PERM_MANAGE_CHANNELS },
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {
        [general.id]: [
          buildServerMessage(general.id, 'Moderator managed message', { id: 'moderated-message' }),
        ],
      },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')

    await expect(page.getByRole('button', { name: 'Create channel in GENERAL' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create channel in VOICE' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create channels and categories' })).toHaveCount(0)

    const row = page.locator('[data-message-id="moderated-message"]')
    await row.hover()
    await expect(row.getByRole('button', { name: 'Pin' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Delete' })).toBeVisible()

    await row.getByRole('button', { name: 'Pin' }).click()
    await page.getByRole('button', { name: 'Pinned messages' }).click()
    await expect(page.locator('.chat-header-pinned-dropdown')).toContainText('Moderator managed message')

    await page.getByRole('button', { name: 'Pinned messages' }).click()
    await row.hover()
    await row.getByRole('button', { name: 'Delete' }).click()
    await page.locator('.confirm-modal', { hasText: 'Delete message' }).getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByText('Moderator managed message')).toBeHidden()
    expect(state.messagesByChannelId[general.id].some((message) => message.id === 'moderated-message')).toBe(false)
  })
})
