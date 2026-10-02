import { expect, test, type Page } from '@playwright/test'
import { buildCoreChannels, buildCoreMembers, buildCoreServer, buildFriends, createMockCoreState, installMockCoreApi } from './mock-core-api'

async function setup(page: Page, count = 2) {
  const server = buildCoreServer()
  const channels = buildCoreChannels(server.id)
  const voice = channels.find(channel => channel.channel_type === 'voice')!
  const friends = buildFriends(count)
  friends[0].username = 'Very long streaming friend username for truncation'
  const members = [...buildCoreMembers().filter(member => member.user_id === 'user-local'),
    { user_id: 'stranger', username: 'Non-friend streamer', avatar_url: null, role: 'member', status: 'online', role_color: null },
    ...friends.map(friend => ({ user_id: friend.id, username: friend.username, avatar_url: null,
      role: 'member', status: friend.status, role_color: null }))]
  await installMockCoreApi(page, createMockCoreState({ servers: [server], friends,
    channelsByServerId: { [server.id]: channels }, membersByServerId: { [server.id]: members } }))
  await page.goto('/social')
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.locator('.social-activity-empty')).toHaveText('No friends in voice right now.')
  await page.evaluate(async data => {
    const path = '/e2e/social-activity-fixture.ts'
    const { publishActivity } = await import(path)
    publishActivity(data.serverId, data.channelId, data.ids)
    publishActivity(data.serverId, data.channelId, [data.ids[0]], true)
    publishActivity(data.serverId, data.channelId, ['stranger'], true)
  }, { serverId: server.id, channelId: voice.id, ids: friends.map(friend => friend.id) })
  return { server, voice, friends }
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1100, height: 600 }, { width: 1024, height: 768 }]) {
  test(`keeps activity scroll separate from resources at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await setup(page, 24)
    const panel = page.locator('.home-side')
    const activity = panel.locator('.social-activity-body')
    await expect(panel.getByRole('heading', { name: 'Friend Activity', exact: true })).toBeVisible()
    await expect(panel.getByRole('region', { name: 'Server streams' })).toHaveCount(0)
    await expect(panel.getByRole('region', { name: 'Friends in voice' }).getByRole('button')).toHaveCount(24)
    await expect(panel.getByRole('img', { name: 'Screen sharing' })).toHaveCount(1)
    await expect(panel.getByText('Non-friend streamer')).toHaveCount(0)
    const nav = panel.locator('.social-resource-nav')
    const before = (await nav.boundingBox())!
    const box = (await activity.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(before.y)
    await activity.hover()
    await page.mouse.wheel(0, 1500)
    await expect.poll(() => activity.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    expect(await nav.boundingBox()).toEqual(before)
    await expect(panel.getByRole('button', { name: 'Community' })).toBeInViewport()
    await expect(page.getByRole('link', { name: 'Support Voxpery' })).toBeInViewport()
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await activity.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await activity.evaluate(element => { element.scrollTop = 0 })
    const row = panel.getByRole('button', { name: /Open .*Very long/ })
    await page.keyboard.press('Tab')
    await row.focus()
    await expect(row).toHaveCSS('outline-style', 'solid')
    await expect(row).toBeInViewport()
    expect(await nav.boundingBox()).toEqual(before)
    await expect(row).toBeInViewport()
    expect(await nav.boundingBox()).toEqual(before)
    await page.screenshot({ path: `test-results/social-activity-${viewport.width}.png` })
  })
}

for (const existingCall of [null, 'current-room']) {
test(`activity only navigates without joining or watching with existing call ${existingCall}`, async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const rtcRequests: string[] = []
  page.on('request', request => { if (/livekit-token|turn-credentials/.test(request.url())) rtcRequests.push(request.url()) })
  await page.addInitScript(() => {
    Reflect.set(window, '__activityMediaRequests', 0)
    navigator.mediaDevices.getUserMedia = async () => {
      Reflect.set(window, '__activityMediaRequests', Number(Reflect.get(window, '__activityMediaRequests')) + 1)
      throw new Error('Activity must not request media')
    }
  })
  const { server, voice } = await setup(page)
  await page.evaluate(async current => {
    const path = '/e2e/social-activity-fixture.ts'
    const { installNavigationProbe } = await import(path)
    installNavigationProbe(current)
  }, existingCall)
  const row = page.locator('.home-side').getByRole('button', { name: /Open .*Very long/ })
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/servers$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const navigation = await page.evaluate(async () => {
    const path = '/e2e/social-activity-fixture.ts'
    return (await import(path)).readActivityNavigation()
  })
  expect(navigation).toEqual({ joined: existingCall, server: server.id, channel: voice.id })
  expect(await page.evaluate(() => Reflect.get(window, '__activityJoinCalls'))).toEqual([])
  expect(await page.evaluate(() => Reflect.get(window, '__activityMediaRequests'))).toBe(0)
  expect(rtcRequests).toEqual([])
})
}

test('does not show old activity after reconnect until fresh voice events arrive', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const { server, voice } = await setup(page)
  await page.evaluate(async () => {
    const path = '/e2e/social-activity-fixture.ts'
    const { setActivityConnection } = await import(path)
    setActivityConnection(false)
  })
  await expect(page.locator('.home-side').getByRole('status')).toHaveText('Reconnecting to activity...')
  await expect(page.locator('.home-side').locator('.social-activity-row')).toHaveCount(0)
  await page.evaluate(async () => {
    const path = '/e2e/social-activity-fixture.ts'
    const { setActivityConnection } = await import(path)
    setActivityConnection(true, true)
  })
  await expect(page.locator('.social-activity-empty')).toHaveText('No friends in voice right now.')
  await page.evaluate(async data => {
    const path = '/e2e/social-activity-fixture.ts'
    const { publishActivity } = await import(path)
    publishActivity(data.serverId, data.channelId, ['friend-01'], true)
  }, { serverId: server.id, channelId: voice.id })
  await expect(page.locator('.home-side').getByRole('button', { name: /Open .*Very long/ })).toBeVisible()
})

for (const width of [390, 320]) {
  test(`keeps activity dock off the compact chat at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await setup(page)
    await expect(page.locator('.home-side')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

for (const scenario of [
  { width: 1920, theme: 'dark' }, { width: 1024, theme: 'light' },
  { width: 390, theme: 'dark' }, { width: 320, theme: 'light' },
]) {
  test(`keeps modern voice indicators and timer stable at ${scenario.width}px in ${scenario.theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 844 })
    await page.addInitScript(theme => localStorage.setItem('voxpery-settings-theme', theme), scenario.theme)
    const { server, voice } = await setup(page, 4)
    await page.evaluate(async () => {
      const path = '/e2e/social-activity-fixture.ts'
      const { publishControls } = await import(path)
      publishControls('friend-01', { muted: true, deafened: true, camera_on: true, screen_sharing: true })
      publishControls('friend-02', { server_muted: true })
      publishControls('friend-03', { server_deafened: true })
    })
    await page.getByRole('button', { name: server.name, exact: true }).and(page.locator('.server-icon')).click()
    const sidebar = page.locator('.channel-sidebar')
    await expect(sidebar).toBeInViewport()
    if (scenario.width < 1024) {
      const rail = (await page.locator('.unified-sidebar').boundingBox())!
      await expect.poll(() => sidebar.evaluate(el => Math.round(el.getBoundingClientRect().left))).toBe(Math.round(rail.x + rail.width))
    }
    const participants = sidebar.locator('.voice-participant')
    await expect(participants).toHaveCount(5)
    await expect(sidebar.getByRole('img', { name: /Very long.*Muted by self/ })).toBeVisible()
    await expect(sidebar.getByRole('img', { name: /Very long.*Deafened by self/ })).toBeVisible()
    await expect(sidebar.getByRole('img', { name: 'Friend 02: Muted by server' })).toBeVisible()
    await expect(sidebar.getByRole('img', { name: 'Friend 03: Deafened by server' })).toBeVisible()
    await expect(sidebar.locator('.voice-live-badge')).toHaveCount(2)
    await expect(sidebar.locator('.voice-participant-camera')).toHaveCount(1)
    for (const indicator of await sidebar.locator('.voice-participant-icon-badge').all()) {
      await expect(indicator).toHaveCSS('width', '20px')
      await expect(indicator).toHaveCSS('box-shadow', 'none')
      await expect(indicator.locator('svg')).toHaveAttribute('width', '14')
    }
    expect(await participants.evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true)
    const timer = sidebar.getByRole('timer')
    await expect(timer).toHaveCSS('width', '72px')
    await page.clock.install()
    await page.evaluate(async channel => {
      const path = '/e2e/social-activity-fixture.ts'
      ;(await import(path)).setVoiceStartedAt(channel, Date.now() - 3_599_000)
    }, voice.id)
    const before = await timer.boundingBox()
    await page.clock.fastForward(1000)
    await expect(timer).toHaveText('1:00:00')
    expect(await timer.locator('span').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await timer.boundingBox()).toEqual(before)
    await expect(timer).toHaveAttribute('aria-live', 'off')
    expect(await sidebar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`voice-indicators-${scenario.width}-${scenario.theme}.png`) })
  })
}
