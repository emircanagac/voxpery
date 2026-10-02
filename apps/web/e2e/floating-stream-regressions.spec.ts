import { expect, test } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

// Exercise the production component and CSS with a generated video, not a real RTC connection.
for (const viewport of [{ width: 1920, height: 1080 }, { width: 1100, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`moves and resizes the stream without replacing video at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await installMockCoreApi(page, createMockCoreState())
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.setViewportSize(viewport)
    await page.goto('/social')
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const fixturePath = '/e2e/floating-stream-fixture.tsx'
      const { mountStreamPreviewFixture } = await import(fixturePath)
      mountStreamPreviewFixture()
    })
    const player = page.locator('.screen-share-mini-player')
    await expect(player).toBeVisible()
    await expect(player.locator('.screen-share-mini-player-label')).toHaveText('Test publisher')
    expect(await player.locator('.screen-share-mini-player-label').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    await player.locator('video').evaluate((video: HTMLVideoElement) => {
      Reflect.set(window, '__previewVideo', video)
      const canvas = document.createElement('canvas')
      Reflect.set(window, '__previewCanvas', canvas)
      canvas.width = 640
      canvas.height = 360
      const context = canvas.getContext('2d')!
      let frame = 0
      const draw = () => {
        context.fillStyle = '#205e48'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = '#ffffff'
        context.fillRect(frame++ % 560, 70, 80, 80)
        context.font = '24px sans-serif'
        context.fillText('Live preview test', 160, 260)
      }
      Reflect.set(window, '__drawPreviewFrame', draw)
      draw()
      setInterval(draw, 80)
      video.srcObject = canvas.captureStream(12)
    })
    await expect.poll(() => player.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.1)
    const initialTime = await player.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)
    const handle = player.getByRole('button', { name: "Return to Test publisher's stream" })
    const resizeHandle = player.getByRole('button', { name: 'Resize stream preview from bottom left' })
    await expect(player.getByRole('button')).toHaveCount(6)
    await expect(player.locator('.screen-share-mini-player-resize svg')).toHaveCount(1)
    await expect(resizeHandle.locator('svg')).toBeVisible()
    const stop = player.getByRole('button', { name: "Stop watching Test publisher's screen share" })
    const playerBox = (await player.boundingBox())!
    const stopBox = (await stop.boundingBox())!
    expect(playerBox.x + playerBox.width - stopBox.x - stopBox.width).toBeCloseTo(7, 0)
    expect(stopBox.y - playerBox.y).toBeCloseTo(7, 0)
    const topRight = player.getByRole('button', { name: 'Resize stream preview from top right' })
    const topRightBox = (await topRight.boundingBox())!
    expect(await stop.evaluate(el => {
      const rect = el.getBoundingClientRect()
      return document.elementFromPoint(rect.left + 2, rect.top + 2)?.closest('button') === el
    })).toBe(true)
    expect(await topRight.evaluate((el, point) => document.elementFromPoint(point.x, point.y)?.closest('button') === el,
      { x: topRightBox.x + 22, y: topRightBox.y + 3 })).toBe(true)
    for (const [x, y] of [[-viewport.width, -viewport.height], [2 * viewport.width, -viewport.height], [-viewport.width, 2 * viewport.height], [2 * viewport.width, 2 * viewport.height]]) {
      const start = (await handle.boundingBox())!
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
      await page.mouse.down()
      await page.mouse.move(x, y, { steps: 12 })
      await page.mouse.up()
      const bounds = (await page.locator('#stream-preview-fixture .chat-messages').boundingBox())!
      const rect = (await player.boundingBox())!
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x + 11)
      expect(rect.y).toBeGreaterThanOrEqual(bounds.y + 11)
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width - 11)
      expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height - 11)
      expect(Math.abs(rect.x - (x < 0 ? bounds.x + 12 : bounds.x + bounds.width - 12 - rect.width))).toBeLessThan(1)
      expect(Math.abs(rect.y - (y < 0 ? bounds.y + 12 : bounds.y + bounds.height - 12 - rect.height))).toBeLessThan(1)
    }
    if (viewport.width === 390 && testInfo.project.name === 'chromium') {
      const cdp = await page.context().newCDPSession(page)
      const start = (await handle.boundingBox())!
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x + start.width / 2, y: start.y + start.height / 2, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 1, y: 1, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      const bounds = (await page.locator('#stream-preview-fixture .chat-messages').boundingBox())!
      await expect.poll(async () => (await player.boundingBox())!.x).toBeCloseTo(bounds.x + 12, 0)
      await expect.poll(async () => (await player.boundingBox())!.y).toBeCloseTo(bounds.y + 12, 0)
      await cdp.detach()
    }
    for (let i = 0; i < 6; i++) await resizeHandle.press('ArrowRight')
    expect(Number(await player.getAttribute('data-preview-width'))).toBeLessThanOrEqual(240)
    if (viewport.width === 390 && testInfo.project.name === 'chromium') {
      const cdp = await page.context().newCDPSession(page)
      const before = (await player.boundingBox())!
      const corner = (await player.getByRole('button', { name: 'Resize stream preview from bottom left' }).boundingBox())!
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: corner.x + 12, y: corner.y + 12, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: corner.x - 28, y: corner.y + 35, id: 1 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect.poll(async () => (await player.boundingBox())!.width - before.width).toBeGreaterThan(30)
      await cdp.detach()
      await resizeHandle.press('Shift+ArrowRight')
    }
    if (viewport.width === 1920) {
      await handle.press('Home')
      for (let i = 0; i < 20; i++) await handle.press('Shift+ArrowRight')
      const corner = (await resizeHandle.boundingBox())!
      await page.mouse.move(corner.x + 12, corner.y + 12)
      await page.mouse.down()
      await page.mouse.move(corner.x - 1000, corner.y + 600, { steps: 12 })
      await page.mouse.up()
      await expect(player).toHaveAttribute('data-preview-width', '960')
      expect((await player.boundingBox())!.width).toBeCloseTo(960, 0)
      for (let i = 0; i < 9; i++) await resizeHandle.press('Shift+ArrowRight')
    }
    if (viewport.width >= 1024) {
      for (const cornerName of ['top left', 'top right', 'bottom left', 'bottom right']) {
        for (let i = 0; i < 12; i++) await resizeHandle.press('Shift+ArrowRight')
        await handle.press('Home')
        const content = (await page.locator('#stream-preview-fixture .chat-messages').boundingBox())!
        const current = (await player.boundingBox())!
        const grip = (await handle.boundingBox())!
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
        await page.mouse.down()
        await page.mouse.move(grip.x + grip.width / 2 + (content.width - current.width - 24) / 2, grip.y + grip.height / 2 + (content.height - current.height - 24) / 2, { steps: 8 })
        await page.mouse.up()
        const before = (await player.boundingBox())!
        const resize = (await player.getByRole('button', { name: `Resize stream preview from ${cornerName}` }).boundingBox())!
        const west = cornerName.endsWith('left')
        const north = cornerName.startsWith('top')
        const startX = resize.x + (cornerName === 'top right' ? 22 : 12)
        const startY = resize.y + (cornerName === 'top right' ? 3 : 12)
        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(startX + (west ? -47 : 47), startY + (north ? -26 : 26), { steps: 8 })
        await page.mouse.up()
        const after = (await player.boundingBox())!
        expect(after.width - before.width).toBeGreaterThan(40)
        expect(after.width - before.width).toBeLessThan(55)
        expect(after.width / after.height).toBeCloseTo(16 / 9, 1)
        expect(Math.abs(after.x + (west ? after.width : 0) - before.x - (west ? before.width : 0))).toBeLessThan(1)
        expect(Math.abs(after.y + (north ? after.height : 0) - before.y - (north ? before.height : 0))).toBeLessThan(1)
      }
    }
    await expect.poll(() => player.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(initialTime)
    expect(await player.locator('video').evaluate(v => v === Reflect.get(window, '__previewVideo'))).toBe(true)
    expect(await page.evaluate(() => Reflect.get(window, '__previewActions'))).toEqual({ returns: 0, stops: 0 })
    await page.screenshot({ path: testInfo.outputPath('stream-preview.png') })
    for (const [sourceWidth, sourceHeight] of [[640, 400], [480, 480], [360, 640], [840, 360]]) {
      await page.evaluate(async ([w, h]) => {
        const canvas = Reflect.get(window, '__previewCanvas') as HTMLCanvasElement
        canvas.width = w
        canvas.height = h
        ;(Reflect.get(window, '__drawPreviewFrame') as () => void)()
        const video = Reflect.get(window, '__previewVideo') as HTMLVideoElement
        await new Promise<void>(resolve => video.requestVideoFrameCallback(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      }, [sourceWidth, sourceHeight])
      await expect.poll(() => player.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth / v.videoHeight)).toBeCloseTo(sourceWidth / sourceHeight, 2)
      await expect.poll(async () => {
        const rect = (await player.boundingBox())!
        return rect.width / rect.height
      }).toBeCloseTo(sourceWidth / sourceHeight, 2)
      const screenshot = await player.screenshot({ path: testInfo.outputPath(`native-${sourceWidth}x${sourceHeight}.png`) })
      const edgeColors = await page.evaluate(async (bytes) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        bitmap.close()
        return [[3, canvas.height / 2], [canvas.width - 4, canvas.height / 2], [canvas.width / 2, 3]]
          .map(([x, y]) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3))
      }, [...screenshot])
      expect(edgeColors).toEqual([[32, 94, 72], [32, 94, 72], [32, 94, 72]])
      expect(await player.locator('video').evaluate(v => v === Reflect.get(window, '__previewVideo'))).toBe(true)
    }
    await page.evaluate(() => {
      const canvas = Reflect.get(window, '__previewCanvas') as HTMLCanvasElement
      canvas.width = 640
      canvas.height = 360
    })
    await expect.poll(() => player.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth / v.videoHeight)).toBeCloseTo(16 / 9, 2)
    await page.locator('#stream-preview-fixture .chat-messages').evaluate(element => {
      element.replaceWith(element.cloneNode(true))
    })
    await page.locator('#stream-preview-fixture .chat-messages').evaluate((element: HTMLElement) => { element.style.bottom = '350px' })
    await expect.poll(async () => {
      const content = (await page.locator('#stream-preview-fixture .chat-messages').boundingBox())!
      const rect = (await player.boundingBox())!
      return rect.y + rect.height <= content.y + content.height - 11
    }).toBe(true)
    await page.setViewportSize({ width: Math.floor(viewport.width * 0.8), height: viewport.height })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const bounds = (await page.locator('#stream-preview-fixture .chat-messages').boundingBox())!
    await expect.poll(async () => {
      const rect = (await player.boundingBox())!
      return rect.x >= bounds.x + 11 && rect.x + rect.width <= bounds.x + bounds.width - 11
    }).toBe(true)
    await handle.press('Enter')
    expect(await page.evaluate(() => Reflect.get(window, '__previewActions'))).toEqual({ returns: 1, stops: 0 })
    const beforeClick = (await player.boundingBox())!
    await page.mouse.move(beforeClick.x + beforeClick.width / 2, beforeClick.y + beforeClick.height / 2)
    await page.mouse.down()
    await page.mouse.move(beforeClick.x + beforeClick.width / 2 + 2, beforeClick.y + beforeClick.height / 2 + 2)
    await page.mouse.up()
    expect((await player.boundingBox())!.x).toBeCloseTo(beforeClick.x, 1)
    expect((await player.boundingBox())!.y).toBeCloseTo(beforeClick.y, 1)
    await player.getByRole('button', { name: "Stop watching Test publisher's screen share" }).click()
    expect(await page.evaluate(() => Reflect.get(window, '__previewActions'))).toEqual({ returns: 2, stops: 1 })
    expect(pageErrors).toEqual([])
  })
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
  test(`keeps Friends preview inside real central content despite retained hidden chat at ${viewport.width}px`, async ({ page }, testInfo) => {
    await installMockCoreApi(page, createMockCoreState())
    await page.setViewportSize(viewport)
    await page.goto('/social')
    await expect(page.locator('.home-main')).toBeVisible()
    await page.evaluate(async () => {
      const hidden = document.createElement('div')
      hidden.className = 'unified-content'
      hidden.setAttribute('aria-hidden', 'true')
      hidden.style.display = 'none'
      const chat = document.createElement('div')
      chat.className = 'chat-messages'
      hidden.append(chat)
      document.querySelector('.shell-content')!.prepend(hidden)
      const fixturePath = '/e2e/floating-stream-fixture.tsx'
      const { mountStreamPreviewFixture } = await import(fixturePath)
      mountStreamPreviewFixture(false)
    })
    const player = page.locator('.screen-share-mini-player')
    await expect(player).toBeVisible()
    const body = player.locator('.screen-share-mini-player-open')
    for (const [x, y] of [[-viewport.width, -viewport.height], [2 * viewport.width, -viewport.height], [-viewport.width, 2 * viewport.height], [2 * viewport.width, 2 * viewport.height]]) {
      const start = (await body.boundingBox())!
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
      await page.mouse.down()
      await page.mouse.move(x, y, { steps: 8 })
      await page.mouse.up()
      const bounds = (await page.locator('.home-main').boundingBox())!
      const rect = (await player.boundingBox())!
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x + 11)
      expect(rect.y).toBeGreaterThanOrEqual(bounds.y + 11)
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width - 11)
      expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height - 11)
      const dock = await page.locator('.callbar-overlay').boundingBox()
      if (dock && dock.height > 0) expect(rect.y + rect.height).toBeLessThanOrEqual(dock.y - 11)
    }
    expect(await page.evaluate(() => Reflect.get(window, '__previewActions'))).toEqual({ returns: 0, stops: 0 })
    await page.screenshot({ path: testInfo.outputPath('friends-preview-bounds.png') })
  })
}
