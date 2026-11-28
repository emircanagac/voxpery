import { expect, test, type Page } from '@playwright/test'
import { buildCoreChannels, buildCoreMembers, buildCoreServer, createMockCoreState, installMockCoreApi } from './mock-core-api'

// A moderator moves this member from one voice channel to another. The real move rejoins through
// LiveKit, which the mocked environment has none of, so the join is stubbed to succeed.
async function setup(page: Page) {
  const server = buildCoreServer()
  const channels = buildCoreChannels(server.id)
  const source = channels.find((channel) => channel.channel_type === 'voice')!
  const destination = { ...source, id: `${server.id}-voice-2`, name: 'Quiet Room', position: source.position + 1 }
  const text = channels.find((channel) => channel.channel_type === 'text')!
  await installMockCoreApi(page, createMockCoreState({
    servers: [server],
    channelsByServerId: { [server.id]: [...channels, destination] },
    membersByServerId: { [server.id]: buildCoreMembers() },
  }))
  await page.goto('/servers')
  await expect(page.locator('.shell-topbar')).toBeVisible()
  return { source, destination, text }
}

async function moveWhileViewing(page: Page, viewing: string, from: string, to: string) {
  await page.evaluate(async ({ viewing, from, to }) => {
    const { useAppStore } = await import('/src/stores/app.ts')
    const { useSocketStore } = await import('/src/stores/socket.ts')
    useAppStore.setState({ joinedVoiceChannelId: from })
    useAppStore.getState().setActiveChannel(viewing)
    Reflect.set(window, '__voxperyJoinVoice', async (channelId: string) => {
      useAppStore.setState({ joinedVoiceChannelId: channelId })
    })
    const socket = useSocketStore.getState().socket
    if (!socket?.onmessage) throw new Error('Application socket is not ready')
    socket.onmessage.call(socket, new MessageEvent('message', {
      data: JSON.stringify({
        type: 'VoiceMemberMoveRequested',
        data: { request_id: 'move-1', source_channel_id: from, channel_id: to },
      }),
    }))
  }, { viewing, from, to })
}

async function activeChannel(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const { useAppStore } = await import('/src/stores/app.ts')
    return useAppStore.getState().activeChannelId
  })
}

test.describe('moved voice members', () => {
  test('follows the move when the old voice channel is open and says where it went', async ({ page }) => {
    const { source, destination } = await setup(page)
    await moveWhileViewing(page, source.id, source.id, destination.id)
    await expect.poll(() => activeChannel(page)).toBe(destination.id)
    await expect(page.getByText('A moderator moved you to Quiet Room.')).toBeVisible()
  })

  test('keeps a member who reads a text channel where they are', async ({ page }) => {
    const { source, destination, text } = await setup(page)
    await moveWhileViewing(page, text.id, source.id, destination.id)
    await expect(page.getByText('A moderator moved you to Quiet Room.')).toBeVisible()
    expect(await activeChannel(page)).toBe(text.id)
  })
})
