import { expect, test, type Page } from '@playwright/test'
import { buildCoreChannels, buildCoreServer, buildFriends, createMockCoreState, installMockCoreApi } from './mock-core-api'

// The mocked socket has no server: what the app sends is recorded, and other members' typing is
// delivered to the app's own socket listener.
async function recordSocketSends(page: Page) {
  await page.evaluate(async () => {
    const { useSocketStore } = await import('/src/stores/socket.ts')
    const sent: Array<{ type: string; data: unknown }> = []
    Reflect.set(window, '__typingSent', sent)
    const original = useSocketStore.getState().send
    useSocketStore.setState({
      send: (type: string, data: unknown) => {
        sent.push({ type, data })
        original(type, data)
      },
    })
  })
}

async function typingSent(page: Page) {
  return page.evaluate(() => (Reflect.get(window, '__typingSent') as Array<{ type: string; data: { channel_id: string; is_typing: boolean } }>)
    .filter((message) => message.type === 'Typing')
    .map((message) => message.data))
}

async function deliverTyping(page: Page, channelId: string, userId: string, username: string, isTyping = true) {
  await page.evaluate(async ({ channelId, userId, username, isTyping }) => {
    const { useSocketStore } = await import('/src/stores/socket.ts')
    const socket = useSocketStore.getState().socket
    if (!socket?.onmessage) throw new Error('Application socket is not ready')
    socket.onmessage.call(socket, new MessageEvent('message', {
      data: JSON.stringify({ type: 'Typing', data: { channel_id: channelId, user_id: userId, username, is_typing: isTyping } }),
    }))
  }, { channelId, userId, username, isTyping })
}

test.describe('typing indicator', () => {
  test('reports typing in a channel and shows who else is typing', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const state = createMockCoreState({ servers: [server], channelsByServerId: { [server.id]: channels } })
    await installMockCoreApi(page, state)
    await page.goto('/servers')
    const input = page.getByRole('textbox', { name: 'Message #general' })
    await expect(input).toBeVisible()
    await recordSocketSends(page)
    const general = channels.find((channel) => channel.name === 'general')!

    await input.pressSequentially('hello there')
    await expect.poll(() => typingSent(page)).toEqual([{ channel_id: general.id, is_typing: true }])

    await deliverTyping(page, general.id, 'friend-a', 'Ada')
    await expect(page.getByText('Ada is typing…')).toBeVisible()
    await deliverTyping(page, general.id, 'friend-b', 'Ben')
    await expect(page.getByText('Ada and Ben are typing…')).toBeVisible()
    await deliverTyping(page, general.id, state.user.id, state.user.username)
    await expect(page.getByText('Ada and Ben are typing…')).toBeVisible()
    await deliverTyping(page, general.id, 'friend-a', 'Ada', false)
    await expect(page.getByText('Ben is typing…')).toBeVisible()

    await input.press('Enter')
    await expect.poll(async () => (await typingSent(page)).at(-1)).toEqual({ channel_id: general.id, is_typing: false })

    // With messages in the list, the line is the list's last row.
    await expect(page.getByText('hello there')).toBeVisible()
    await deliverTyping(page, general.id, 'friend-c', 'Cem')
    await expect(page.getByText(/Cem/).filter({ hasText: 'typing' })).toBeVisible()
  })

  test('shows the other person typing in a direct message', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(3) })
    await installMockCoreApi(page, state)
    await page.goto('/social')
    await page.getByRole('button', { name: /All/ }).click()
    await page.getByRole('button', { name: 'Message Friend 01' }).click()
    const input = page.getByPlaceholder('Message @Friend 01')
    await expect(input).toBeVisible()
    await recordSocketSends(page)

    await input.pressSequentially('hey')
    await expect.poll(async () => (await typingSent(page)).length).toBe(1)
    const [{ channel_id: dmChannelId }] = await typingSent(page)
    await deliverTyping(page, dmChannelId, 'friend-01', 'Friend 01')
    await expect(page.getByText('Friend 01 is typing…')).toBeVisible()
  })
})
