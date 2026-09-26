import { expect, test } from '@playwright/test'
import { buildServerMessage, createMockCoreState, installMockCoreApi } from './mock-core-api'

test('paginates DM history and opens the latest message again after leaving', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Friends', exact: true }).click()
  await page.getByRole('button', { name: 'Open DM with History Friend', exact: true }).click()
  await expect(scroller.getByText('History line 119', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toHaveCount(0)
})
