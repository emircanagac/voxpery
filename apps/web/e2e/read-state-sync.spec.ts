import { expect, test, type Page } from '@playwright/test'
import { buildCoreChannels, buildCoreServer, createMockCoreState, installMockCoreApi } from './mock-core-api'

// The desktop window opens a channel before it has focus, for example when a system notification
// is clicked or the app comes back from the tray. The read mark must still reach the server, or
// the account's other devices keep showing the channel as unread.
async function setFocus(page: Page, focused: boolean) {
  await page.evaluate((focused) => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused })
    if (focused) window.dispatchEvent(new Event('focus'))
  }, focused)
}

test.describe('read state across devices', () => {
  test('marks a channel read once the window gets focus after opening it unfocused', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const announcements = channels[1]
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      notificationState: {
        channels: [{ channel_id: announcements.id, server_id: server.id, unread_count: 3, mention_count: 1 }],
        muted_server_ids: [],
        muted_channel_ids: [],
      },
    })
    await installMockCoreApi(page, state)
    await page.goto('/servers')
    await page.locator(`.server-icon[data-server-id="${server.id}"]`).click()
    await expect(page.locator('.channel-unread-badge')).toHaveText('@1')

    await setFocus(page, false)
    await page.getByRole('button', { name: announcements.name, exact: false }).first().click({ force: true })
    await expect(page.locator('.channel-unread-badge')).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect(state.channelReadMarks).not.toContain(announcements.id)

    await setFocus(page, true)
    await expect.poll(() => state.channelReadMarks.includes(announcements.id)).toBe(true)
  })

  test('reloads unread counts when the page becomes visible again', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const announcements = channels[1]
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      notificationState: {
        channels: [{ channel_id: announcements.id, server_id: server.id, unread_count: 3, mention_count: 1 }],
        muted_server_ids: [],
        muted_channel_ids: [],
      },
    })
    await installMockCoreApi(page, state)
    await page.goto('/servers')
    await page.locator(`.server-icon[data-server-id="${server.id}"]`).click()
    await expect(page.locator('.channel-unread-badge')).toHaveText('@1')

    // Another device read the channel while this page was hidden and its event never arrived.
    state.notificationState = { ...state.notificationState, channels: [] }
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.evaluate(() => {
      const now = Date.now
      Date.now = () => now() + 60_000
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(page.locator('.channel-unread-badge')).toHaveCount(0)
  })
})
