import { expect, test } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

test('uses the animated fox on the landing brand and auth screens', async ({ page }) => {
  await installMockCoreApi(page, createMockCoreState({ authenticated: false }))

  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'Voxpery', level: 1 }).locator('img')).toHaveCount(0)
  await expect(page.locator('.about-brand img')).toHaveAttribute('src', '/fox-animated.svg')
  await expect(page.locator('.about-brand img')).toHaveJSProperty('width', 44)
  await expect(page.locator('.about-brand img')).toHaveJSProperty('naturalWidth', 1200)

  await page.goto('/compare')
  await expect(page.locator('.about-brand img')).toHaveAttribute('src', '/1024.png')

  for (const path of ['/login', '/register']) {
    await page.goto(path)
    await expect(page.locator('.auth-logo')).toHaveAttribute('src', '/fox-animated.svg')
    await expect(page.locator('.auth-logo')).toHaveJSProperty('naturalWidth', 1200)
  }
})

test('stops the fox animation when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/fox-animated.svg')

  await expect.poll(() => page.locator('.vp-fox').evaluate((fox) => getComputedStyle(fox).animationName)).toBe('none')
  await expect.poll(() => page.locator('.vp-wave').first().evaluate((wave) => getComputedStyle(wave).opacity)).toBe('0')
})
