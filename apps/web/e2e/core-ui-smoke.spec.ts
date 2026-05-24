import { expect, test, type Locator } from '@playwright/test'
import {
  buildFriends,
  buildRequests,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

test.describe('mocked core UI smoke', () => {
  test('keeps Friends tabs scrollable and friend actions reachable', async ({ page }) => {
    const state = createMockCoreState({
      friends: buildFriends(30),
      incomingRequests: buildRequests(36, 'incoming'),
      outgoingRequests: buildRequests(30, 'outgoing'),
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')

    await expect(page.getByRole('button', { name: /Online/ })).toBeVisible()
    await expect(page.getByText('Online Friends — 30')).toBeVisible()
    await expectScrollable(page.locator('.home-friends-scroll').first())

    await page.getByRole('button', { name: /All/ }).click()
    await expect(page.getByText('All Friends — 30')).toBeVisible()
    await expectScrollable(page.locator('.home-friends-scroll').first())
    await expect(page.getByRole('button', { name: 'Open DM with Friend 01' })).toBeVisible()

    const allScroller = page.locator('.home-friends-scroll').first()
    await allScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Friend 30')).toBeVisible()

    await page.getByRole('button', { name: /Requests/ }).click()
    const requestScroller = page.locator('.home-friends-scroll--requests')
    await expect(page.getByText('Incoming')).toBeVisible()
    await expect(page.getByText('Outgoing')).toBeVisible()
    await expectScrollable(requestScroller)

    await requestScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Request Out 30')).toBeVisible()
  })

  test('opens a DM from the Friends action button and sends a message', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(8) })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: /All/ }).click()
    await page.getByRole('button', { name: 'Open DM with Friend 01' }).click()

    await expect(page).toHaveURL(/\/social\/dm/)
    const messageInput = page.getByPlaceholder('Message @Friend 01')
    await expect(messageInput).toBeVisible()

    const content = `Mocked smoke message ${Date.now()}`
    await messageInput.fill(content)
    await messageInput.press('Enter')

    await expect(page.getByText(content)).toBeVisible()
    expect(state.dmMessagesByChannelId['dm-friend-01']?.some((message) => message.content === content)).toBe(true)
  })

  test('keeps the Friends surface usable on mobile viewport', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(18) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 390, height: 760 })

    await page.goto('/social')

    await expect(page.getByRole('button', { name: /Online/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /All/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Requests/ })).toBeVisible()

    await page.getByRole('button', { name: /All/ }).click()
    await expect(page.getByRole('button', { name: 'Open DM with Friend 01' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Message Friend 01' })).toBeVisible()

    const hasHorizontalOverflow = await page.locator('.home-main').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
  })
})

async function expectScrollable(locator: Locator) {
  await expect.poll(async () => {
    return locator.evaluate((element) => element.scrollHeight > element.clientHeight)
  }).toBe(true)
}
