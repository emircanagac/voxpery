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
    await page.getByRole('button', { name: 'Remove Friend 01 as friend' }).click()

    await expect(page.getByRole('heading', { name: 'Remove friend?' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('button', { name: 'Message Friend 01' })).toBeVisible()
    expect(state.friends.some((friend) => friend.id === 'friend-01')).toBe(true)

    await page.getByRole('button', { name: 'Remove Friend 01 as friend' }).click()
    await page.getByRole('button', { name: 'Remove', exact: true }).click()

    await expect(page.getByRole('button', { name: 'Message Friend 01' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Message Friend 02' })).toBeVisible()
    expect(state.friends.some((friend) => friend.id === 'friend-01')).toBe(false)
  })
})
