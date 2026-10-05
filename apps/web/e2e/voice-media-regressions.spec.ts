import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

const require = createRequire(import.meta.url)
const { PNG } = require('playwright-core/lib/utilsBundle') as {
  PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Uint8Array } } }
}

for (const viewport of [{ width: 960, height: 720 }, { width: 390, height: 844 }]) {
  for (const source of [{ width: 1280, height: 720 }, { width: 640, height: 480 }, { width: 1260, height: 540 }, { width: 720, height: 1280 }]) {
    test(`preserves all screen edges ${source.width}x${source.height} at ${viewport.width}px`, async ({ page }, testInfo) => {
      await installMockCoreApi(page, createMockCoreState())
      await page.setViewportSize(viewport)
      await page.goto('/social')
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
      await page.evaluate(async (size) => {
        const path = '/e2e/voice-media-fixture.tsx'
        const { mountVoiceMediaFixture } = await import(path)
        mountVoiceMediaFixture(size.width, size.height)
      }, source)
      const tile = page.locator('#voice-media-fixture .screen-share-preview')
      const video = tile.locator('video')
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.1)
      const original = await video.elementHandle()
      for (const mode of ['normal', 'focus', 'fullscreen'] as const) {
        if (mode === 'focus') await tile.evaluate((element) => {
          element.parentElement!.classList.add('screen-share-stage--theater')
          element.classList.add('is-theater-focused')
          element.style.width = 'min(560px, calc(100vw - 40px))'
          element.style.height = '400px'
        })
        if (mode === 'fullscreen') {
          await tile.getByRole('button', { name: 'Enter fullscreen' }).click()
          await expect.poll(() => tile.evaluate((element) => document.fullscreenElement === element)).toBe(true)
        }
        expect(await video.evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain')
        expect(await original!.evaluate((element) => element.isConnected)).toBe(true)
        const screenshot = await video.screenshot()
        await testInfo.attach(`${mode}-${source.width}x${source.height}`, { body: screenshot, contentType: 'image/png' })
        const pixels = PNG.sync.read(screenshot)
        const scale = Math.min(pixels.width / source.width, pixels.height / source.height)
        const left = (pixels.width - source.width * scale) / 2
        const top = (pixels.height - source.height * scale) / 2
        for (const [x, y, color] of [
          [left + 3, pixels.height / 2, [240, 32, 32]],
          [pixels.width - left - 4, pixels.height / 2, [32, 240, 32]],
          [pixels.width / 2, top + 3, [32, 32, 240]],
          [pixels.width / 2, pixels.height - top - 4, [240, 240, 32]],
        ] as const) {
          const offset = (Math.floor(y) * pixels.width + Math.floor(x)) * 4
          color.forEach((channel, index) => expect(Math.abs(pixels.data[offset + index] - channel)).toBeLessThan(25))
        }
      }
    })
  }
}

test('keeps camera previews filled instead of applying screen letterboxing', async ({ page }) => {
  await installMockCoreApi(page, createMockCoreState())
  await page.goto('/social')
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const path = '/e2e/voice-media-fixture.tsx'
    const { mountVoiceMediaFixture } = await import(path)
    mountVoiceMediaFixture(1280, 720, 'camera')
  })
  const video = page.locator('#voice-media-fixture video')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.1)
  expect(await video.evaluate((element) => getComputedStyle(element).objectFit)).toBe('cover')
})
