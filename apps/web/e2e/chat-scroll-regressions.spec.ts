import { expect, test, type Locator } from '@playwright/test'
import { buildCoreChannels, buildCoreMembers, buildCoreServer, buildServerMessage, createMockCoreState, installMockCoreApi } from './mock-core-api'

test.use({ viewport: { width: 1920, height: 1080 } })

test('keeps signed photos stable across reactions and channel changes without empty frame space', async ({ page }, testInfo) => {
  const server = buildCoreServer()
  const channels = buildCoreChannels(server.id)
  const attachment = { id: 'qa-banner', sha256: 'qa-immutable-banner', url: '/api/attachments/content/qa-banner?exp=1&sig=old', name: 'banner.svg', type: 'image/svg+xml' }
  const row = buildServerMessage(channels[0].id, 'Photo', { id: 'qa-photo', attachments: [attachment] })
  const state = createMockCoreState({ servers: [server], channelsByServerId: { [server.id]: channels }, membersByServerId: { [server.id]: buildCoreMembers() }, messagesByChannelId: {
    [channels[0].id]: [row], [channels[1].id]: [buildServerMessage(channels[1].id, 'Other channel')],
  } })
  await installMockCoreApi(page, state)
  let authenticatedFetches = 0
  await page.route('**/api/attachments/content/qa-banner?*', route => {
    if (route.request().resourceType() === 'image') return route.fulfill({ status: 403, body: 'Authentication required' })
    authenticatedFetches++
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180"><rect width="480" height="180" fill="#328b6f"/></svg>' })
  })
  await page.goto('/servers')
  const photo = page.getByRole('button', { name: 'Preview banner.svg' })
  await expect(photo).toBeVisible()
  const image = photo.locator('img')
  const src = await image.getAttribute('src')
  expect(src).toMatch(/^blob:/)
  const frame = (await photo.boundingBox())!
  const pixels = (await image.boundingBox())!
  expect(frame.width - pixels.width).toBeLessThanOrEqual(2)
  expect(pixels.width / pixels.height).toBeCloseTo(480 / 180, 2)
  await image.evaluate(el => Reflect.set(window, '__originalPhotoNode', el))
  state.messagesByChannelId[channels[0].id][0].attachments![0].url = attachment.url.replace('exp=1&sig=old', 'exp=2&sig=new')
  await page.locator('[data-message-id="qa-photo"]').getByRole('button', { name: 'Add reaction' }).click()
  await page.getByRole('button', { name: 'thumbs up', exact: true }).click()
  await expect(page.locator('[data-message-id="qa-photo"] .message-reactions')).toContainText('1')
  expect(await image.evaluate(el => el === Reflect.get(window, '__originalPhotoNode'))).toBe(true)
  await expect(image).toHaveAttribute('src', src!)
  expect(authenticatedFetches).toBe(1)
  for (let repeat = 0; repeat < 3; repeat++) {
    await page.getByRole('button', { name: 'Text channel announcements', exact: true }).click()
    await expect(page.getByText('Other channel', { exact: true })).toBeVisible()
    state.messagesByChannelId[channels[0].id][0].attachments![0].url = attachment.url.replace('exp=1&sig=old', `exp=${repeat + 3}&sig=renewed`)
    await page.getByRole('button', { name: 'Text channel general', exact: true }).click()
    await expect(photo).toBeVisible()
    await expect(image).toHaveAttribute('src', src!)
    await expectLatest(page.locator('.chat-messages'))
  }
  expect(authenticatedFetches).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('stable-photo-frame.png') })
})

async function expectLatest(scroller: Locator) {
  await expect.poll(() => scroller.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThanOrEqual(4)
  // Check beyond the first successful frame: deferred measurements must not unlock latest.
  const distances = await scroller.evaluate(async (el) => {
    const samples: number[] = []
    for (let frame = 0; frame < 24; frame += 1) {
      await new Promise(requestAnimationFrame)
      samples.push(Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))
    }
    return samples
  })
  expect(Math.max(...distances)).toBeLessThanOrEqual(4)
}

test('keeps latest through delayed media, cached channel changes, and composer resize', async ({ page }, testInfo) => {
  const server = buildCoreServer()
  const channels = buildCoreChannels()
  const rows = Array.from({ length: 70 }, (_, index) => buildServerMessage(channels[0].id,
    index === 68 ? '![gif](https://media.giphy.com/scroll-delayed/preview.gif)' : `General line ${index}`, {
      id: `general-${index}`, created_at: new Date(Date.UTC(2026, 0, 15, 10, index)).toISOString(),
    }))
  const state = createMockCoreState({ servers: [server], channelsByServerId: { [server.id]: channels },
    membersByServerId: { [server.id]: buildCoreMembers() }, messagesByChannelId: {
      [channels[0].id]: rows, [channels[1].id]: [buildServerMessage(channels[1].id, 'Another channel')],
    } })
  await installMockCoreApi(page, state)
  let releaseImage!: () => void
  const imageGate = new Promise<void>((resolve) => { releaseImage = resolve })
  let imageRequested = false
  await page.route('https://media.giphy.com/scroll-delayed/**', async (route) => {
    imageRequested = true
    await imageGate
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="#28a9ad"/></svg>' })
  })
  await page.goto('/servers')
  const scroller = page.locator('.chat-messages:visible')
  await expect.poll(() => imageRequested).toBe(true)
  await expectLatest(scroller)
  releaseImage()
  await expect.poll(() => page.getByAltText('GIF preview').evaluate((el) => (el as HTMLImageElement).naturalHeight)).toBe(480)
  await expectLatest(scroller)
  for (let repeat = 0; repeat < 3; repeat += 1) {
    await page.getByRole('button', { name: 'Text channel announcements', exact: true }).click()
    await expect(page.getByText('Another channel', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Text channel general', exact: true }).click()
    await expect(scroller.getByText('General line 69', { exact: true })).toBeVisible()
    await expectLatest(scroller)
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toHaveCount(0)
  }
  await page.getByPlaceholder('Message #general').fill('A draft\nwith several\nlines\nto resize\nthe composer')
  await expectLatest(scroller)
  await page.getByPlaceholder('Message #general').fill('')
  const chatHeightBefore = await scroller.evaluate(el => el.clientHeight)
  const composerHeightBefore = await page.locator('.message-input-container:visible').evaluate(el => el.clientHeight)
  await scroller.hover()
  await page.mouse.wheel(0, -100)
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThanOrEqual(90)
  await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toHaveCount(0)
  await page.mouse.wheel(0, -500)
  const newest = page.getByRole('button', { name: 'Jump to latest messages' })
  await expect(newest).toBeVisible()
  const bounds = await newest.evaluate((button) => {
    const r = button.getBoundingClientRect()
    const composer = button.closest('.message-input-container')!.getBoundingClientRect()
    const chat = document.querySelector('.chat-messages:has(.virtual-list-spacer)')!.getBoundingClientRect()
    return { rightInset: composer.right - r.right, aboveComposer: r.bottom <= composer.top,
      smallOverlay: r.width <= 40 && r.height <= 40 && r.top >= chat.top,
      scrollbarGap: chat.right - r.right,
      text: button.textContent }
  })
  expect(bounds.rightInset).toBeGreaterThanOrEqual(12)
  expect(bounds.rightInset).toBeLessThanOrEqual(40)
  expect(bounds.scrollbarGap).toBeGreaterThanOrEqual(12)
  expect(bounds.aboveComposer).toBe(true)
  expect(bounds.smallOverlay).toBe(true)
  expect(bounds.text).toBe('')
  expect(await scroller.evaluate(el => el.clientHeight)).toBe(chatHeightBefore)
  expect(await page.locator('.message-input-container:visible').evaluate(el => el.clientHeight)).toBe(composerHeightBefore)
  await page.screenshot({ path: testInfo.outputPath('newest-1920x1080.png') })
  const position = await scroller.evaluate((el) => el.scrollTop)
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(position)
  await newest.click()
  await expectLatest(scroller)
  await expect(newest).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('latest-1920x1080.png') })
})

test('uses fresh same-count content and ignores a late response from another channel', async ({ page }) => {
  const server = buildCoreServer()
  const channels = buildCoreChannels()
  const rows = Array.from({ length: 50 }, (_, index) => buildServerMessage(channels[0].id, `Cached line ${index}`, { id: `row-${index}` }))
  await installMockCoreApi(page, createMockCoreState({ servers: [server], channelsByServerId: { [server.id]: channels },
    membersByServerId: { [server.id]: buildCoreMembers() }, messagesByChannelId: { [channels[0].id]: rows } }))
  let generalRequests = 0
  let releaseRefresh!: () => void
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve })
  await page.route(`**/api/messages/${channels[0].id}?*`, async (route) => {
    generalRequests += 1
    if (generalRequests > 1) await refreshGate
    await route.fulfill({ json: rows.map((row, index) => ({ ...row, content: generalRequests > 1
      ? `Refreshed line ${index}\n${'More content\n'.repeat(8)}` : row.content })) })
  })
  await page.goto('/servers')
  const scroller = page.locator('.chat-messages:visible')
  await expect(scroller.getByText('Cached line 49', { exact: true })).toBeVisible()
  await expectLatest(scroller)
  await page.getByRole('button', { name: 'Text channel announcements', exact: true }).click()
  await page.getByRole('button', { name: 'Text channel general', exact: true }).click()
  await expect.poll(() => generalRequests).toBe(2)
  await expectLatest(scroller)
  releaseRefresh()
  await expect(scroller.getByText(/Refreshed line 49/)).toBeVisible()
  await expectLatest(scroller)
  let releaseOld!: () => void
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve })
  let requestedOld = false
  await page.route(`**/api/messages/${channels[1].id}?*`, async (route) => {
    requestedOld = true
    await oldGate
    await route.fulfill({ json: [buildServerMessage(channels[1].id, 'Stale other-channel response')] })
  })
  await page.getByRole('button', { name: 'Text channel announcements', exact: true }).click()
  await expect.poll(() => requestedOld).toBe(true)
  await page.getByRole('button', { name: 'Text channel general', exact: true }).click()
  releaseOld()
  await expect(scroller.getByText(/Refreshed line 49/)).toBeVisible()
  await expect(scroller.getByText('Stale other-channel response')).toHaveCount(0)
  await expectLatest(scroller)
})
