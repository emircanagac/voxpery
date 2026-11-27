import { expect, test, type Page } from '@playwright/test'
import {
  buildCoreChannels,
  buildCoreServer,
  buildFriends,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

// Answers each send after a delay that shrinks with every message, the way a slow phone network
// can, so requests sent all at once would reach the store in reverse order.
async function slowDownSends(page: Page, pattern: string, prefix: string) {
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const content = String((route.request().postDataJSON() as { content?: string }).content ?? '')
    const index = Number(content.slice(prefix.length)) || 0
    await new Promise((resolve) => setTimeout(resolve, (6 - index) * 120))
    await route.fallback()
  })
}

async function sendQuickly(page: Page, input: ReturnType<Page['getByRole']>, prefix: string) {
  for (let index = 1; index <= 5; index += 1) {
    await input.fill(`${prefix}${index}`)
    await input.press('Enter')
  }
}

async function shownOrder(page: Page, prefix: string): Promise<string[]> {
  return page.getByText(new RegExp(`^${prefix}[1-5]$`)).allTextContents()
}

const expected = (prefix: string) => [1, 2, 3, 4, 5].map((index) => `${prefix}${index}`)

test.describe('message order when sending quickly over a slow network', () => {
  test('keeps channel messages in the order they were written, before and after reload', { tag: '@core' }, async ({ page }) => {
    const server = buildCoreServer()
    const state = createMockCoreState({ servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) } })
    await installMockCoreApi(page, state)
    const prefix = 'channel order '
    await slowDownSends(page, '**/api/messages/*', prefix)

    await page.goto('/servers')
    const input = page.getByRole('textbox', { name: 'Message #general' })
    await expect(input).toBeVisible()
    await sendQuickly(page, input, prefix)

    const stored = () => Object.values(state.messagesByChannelId).flat()
      .filter((message) => message.content.startsWith(prefix))
      .map((message) => message.content)
    await expect.poll(() => stored().length, { timeout: 10_000 }).toBe(5)
    expect(stored()).toEqual(expected(prefix))
    await expect.poll(() => shownOrder(page, prefix)).toEqual(expected(prefix))

    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Message #general' })).toBeVisible()
    await expect.poll(() => shownOrder(page, prefix)).toEqual(expected(prefix))
  })

  test('keeps direct messages in the order they were written, before and after reload', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(3) })
    await installMockCoreApi(page, state)
    const prefix = 'dm order '
    await slowDownSends(page, '**/api/dm/messages/*', prefix)

    const openConversation = async () => {
      await page.goto('/social')
      await page.getByRole('button', { name: /All/ }).click()
      await page.getByRole('button', { name: 'Message Friend 01' }).click()
    }
    await openConversation()
    const input = page.getByPlaceholder('Message @Friend 01')
    await expect(input).toBeVisible()
    await sendQuickly(page, input as ReturnType<Page['getByRole']>, prefix)

    await expect.poll(() => (state.dmMessagesByChannelId['dm-friend-01'] ?? [])
      .filter((message) => message.content.startsWith(prefix)).length, { timeout: 10_000 }).toBe(5)
    expect((state.dmMessagesByChannelId['dm-friend-01'] ?? [])
      .filter((message) => message.content.startsWith(prefix))
      .map((message) => message.content)).toEqual(expected(prefix))
    await expect.poll(() => shownOrder(page, prefix)).toEqual(expected(prefix))

    await page.reload()
    await openConversation()
    await expect(page.getByPlaceholder('Message @Friend 01')).toBeVisible()
    await expect.poll(() => shownOrder(page, prefix)).toEqual(expected(prefix))
  })
})
