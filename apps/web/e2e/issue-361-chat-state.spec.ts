import { expect, test, type Locator, type Page } from '@playwright/test'
import { buildCoreChannels, buildCoreMembers, buildCoreServer, buildServerMessage, createMockCoreState, installMockCoreApi } from './mock-core-api'

test('paginates DM history, restores the reading position after leaving, and reopens at latest from the bottom', async ({ page }) => {
  const channel = {
    id: 'dm-history', peer_id: 'friend-01', peer_username: 'History Friend',
    peer_avatar_url: null, peer_status: 'online', last_message_at: null,
    unread_count: 0, pinned_at: null, is_pinned: false,
  }
  const messages = Array.from({ length: 120 }, (_, index) => buildServerMessage(channel.id, `History line ${index}`, {
    id: `history-${index}`,
    created_at: new Date(Date.UTC(2026, 0, 15, 10, index)).toISOString(),
  }))
  await installMockCoreApi(page, createMockCoreState({ dmChannels: [channel] }))
  const cursors: string[] = []
  await page.route('**/api/dm/messages/dm-history*', async (route) => {
    const before = new URL(route.request().url()).searchParams.get('before')
    if (before) cursors.push(before)
    const end = before ? messages.findIndex((message) => message.id === before) : messages.length
    await route.fulfill({ json: messages.slice(Math.max(0, end - 50), end) })
  })
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/social')
  await page.getByRole('button', { name: 'Open DM with History Friend', exact: true }).click()
  const scroller = page.locator('.chat-messages')
  await expect(scroller.getByText('History line 119', { exact: true })).toBeVisible()
  expect(cursors).toEqual([])
  await scroller.hover()
  await page.mouse.wheel(0, -10000)
  await expect.poll(() => cursors).toContain('history-70')
  await expect(page.getByText('Loading older messages…', { exact: true })).toHaveCount(0)
  await page.mouse.wheel(0, -10000)
  await expect.poll(() => cursors).toContain('history-20')
  await page.mouse.wheel(0, -10000)
  await expect(scroller.getByText('History line 0', { exact: true })).toBeVisible()
  const openDm = async () => {
    await page.getByRole('button', { name: 'Friends', exact: true }).click()
    await page.getByRole('button', { name: 'Open DM with History Friend', exact: true }).click()
  }

  // Leaving while reading history keeps that place, even after the latest page reloads.
  await openDm()
  await expect(scroller.getByText('History line 0', { exact: true })).toBeVisible()
  await expect(scroller.getByText('History line 119', { exact: true })).toHaveCount(0)
  const jumpToLatest = page.getByRole('button', { name: 'Jump to latest messages' })
  await expect(jumpToLatest).toBeVisible()

  // Leaving from the latest message opens at the latest message again.
  await jumpToLatest.click()
  await expect(scroller.getByText('History line 119', { exact: true })).toBeVisible()
  await openDm()
  await expect(scroller.getByText('History line 119', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toHaveCount(0)
})

test('restores the reading position in a server channel after switching channels', async ({ page }) => {
  const server = buildCoreServer()
  const channels = buildCoreChannels(server.id)
  const messages = Array.from({ length: 120 }, (_, index) => buildServerMessage(channels[0].id, `Channel line ${index}`, {
    id: `channel-${index}`,
    created_at: new Date(Date.UTC(2026, 0, 15, 10, index)).toISOString(),
  }))
  await installMockCoreApi(page, createMockCoreState({
    servers: [server],
    channelsByServerId: { [server.id]: channels },
    membersByServerId: { [server.id]: buildCoreMembers() },
    messagesByChannelId: { [channels[0].id]: messages, [channels[1].id]: [buildServerMessage(channels[1].id, 'Other channel')] },
  }))
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/servers')
  const scroller = page.locator('.chat-messages')
  await expect(scroller.getByText('Channel line 119', { exact: true })).toBeVisible()
  await scroller.hover()
  await page.mouse.wheel(0, -1500)
  await expect(scroller.getByText('Channel line 119', { exact: true })).toHaveCount(0)
  await page.waitForTimeout(300)
  const anchor = await scroller.evaluate((el) => {
    const top = el.getBoundingClientRect().top
    const row = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((item) => item.getBoundingClientRect().bottom > top + 1)
    return row?.dataset.messageId ?? null
  })
  expect(anchor).not.toBeNull()

  // Leaving while reading history keeps that place in the server channel too.
  await page.getByRole('button', { name: 'Text channel announcements', exact: true }).click()
  await expect(scroller.getByText('Other channel', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Text channel general', exact: true }).click()
  await expect(scroller.locator(`[data-message-id="${anchor}"]`)).toBeVisible()
  await expect(scroller.getByText('Channel line 119', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible()
})

test('suggests only the conversation members for @ mentions in a DM', async ({ page }) => {
  const channel = {
    id: 'dm-mentions', peer_id: 'friend-01', peer_username: 'mentionfriend',
    peer_avatar_url: null, peer_status: 'online', last_message_at: null,
    unread_count: 0, pinned_at: null, is_pinned: false,
  }
  await installMockCoreApi(page, createMockCoreState({ dmChannels: [channel], dmMessagesByChannelId: { [channel.id]: [] } }))
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/social')
  await page.getByRole('button', { name: 'Open DM with mentionfriend', exact: true }).click()
  const composer = page.getByRole('textbox', { name: /Message/ })
  await composer.fill('@')
  const suggestions = page.locator('.mention-suggest-item')
  await expect(suggestions.filter({ hasText: '@mentionfriend' })).toHaveCount(1)
  await expect(suggestions.filter({ hasText: '@localuser' })).toHaveCount(1)
  await expect(suggestions.filter({ hasText: '@all' })).toHaveCount(0)
  await expect(page.getByText('Notify everyone', { exact: true })).toHaveCount(0)
})

async function setupLongServerChannel(page: Page) {
  const server = buildCoreServer()
  const channels = buildCoreChannels(server.id)
  const messages = Array.from({ length: 120 }, (_, index) => buildServerMessage(channels[0].id, `Channel line ${index}`, {
    id: `channel-${index}`,
    created_at: new Date(Date.UTC(2026, 0, 15, 10, index)).toISOString(),
  }))
  await installMockCoreApi(page, createMockCoreState({
    servers: [server],
    channelsByServerId: { [server.id]: channels },
    membersByServerId: { [server.id]: buildCoreMembers() },
    messagesByChannelId: { [channels[0].id]: messages, [channels[1].id]: [buildServerMessage(channels[1].id, 'Other channel')] },
  }))
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/servers')
  const scroller = page.locator('.chat-messages')
  await expect(scroller.getByText('Channel line 119', { exact: true })).toBeVisible()
  return { server, scroller }
}

async function topVisibleMessageId(scroller: Locator) {
  return scroller.evaluate((el) => {
    const top = el.getBoundingClientRect().top
    const row = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((item) => item.getBoundingClientRect().bottom > top + 1)
    return row?.dataset.messageId ?? null
  })
}

test('leaving a restored conversation at the bottom forgets the old reading position', async ({ page }) => {
  const { scroller } = await setupLongServerChannel(page)
  await scroller.hover()
  await page.mouse.wheel(0, -900)
  await expect(scroller.getByText('Channel line 119', { exact: true })).toHaveCount(0)
  await page.waitForTimeout(300)
  const general = page.getByRole('button', { name: 'Text channel general', exact: true })
  const announcements = page.getByRole('button', { name: 'Text channel announcements', exact: true })
  await announcements.click()
  await general.click()
  await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible()

  // Scroll down to the latest message by hand, then leave and come back.
  await scroller.hover()
  for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, 2000)
  await expect(scroller.getByText('Channel line 119', { exact: true })).toBeVisible()
  await page.waitForTimeout(300)
  await announcements.click()
  await general.click()
  await expect(scroller.getByText('Channel line 119', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toHaveCount(0)
})

test('keeps the server channel reading position across Social and server views', async ({ page }) => {
  const { server, scroller } = await setupLongServerChannel(page)
  await scroller.hover()
  await page.mouse.wheel(0, -900)
  await expect(scroller.getByText('Channel line 119', { exact: true })).toHaveCount(0)
  await page.waitForTimeout(300)
  const anchor = await topVisibleMessageId(scroller)
  expect(anchor).not.toBeNull()

  await page.getByRole('link', { name: 'Social', exact: true }).click()
  await expect(scroller).toBeHidden()
  await page.getByRole('button', { name: server.name, exact: true }).click()
  await expect(scroller.locator(`[data-message-id="${anchor}"]`)).toBeVisible()
  await expect(scroller.getByText('Channel line 119', { exact: true })).toHaveCount(0)
})
