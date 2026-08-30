import { expect, test } from '@playwright/test'
import {
  buildFriends,
  buildRequests,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

test.describe('mocked social friend UI regressions', () => {
  test('sends a friend request and keeps the outgoing request visible', async ({ page }) => {
    const state = createMockCoreState({
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
    })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: /Requests/ }).click()
    await page.getByPlaceholder('Enter username').fill('newfriend')
    await page.getByRole('button', { name: 'Send Request' }).click()

    await expect(page.getByText('Friend request sent.')).toBeVisible()
    await expect(page.getByText('Pending to')).toBeVisible()
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
    await page.getByRole('button', { name: /Requests/ }).click()

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
    await page.getByRole('button', { name: /Requests/ }).click()
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
  })
})
