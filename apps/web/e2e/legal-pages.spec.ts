import { expect, test } from '@playwright/test'

const legalPages = [
  { path: '/privacy', lastHeading: 'Changes and incidents' },
  { path: '/terms', lastHeading: 'Contact' },
  { path: '/kvkk', lastHeading: 'Saklama, mesaj gizliliği ve haklar' },
]

test.describe('hosted legal pages', () => {
  for (const legalPage of legalPages) {
    test(`keeps ${legalPage.path} scrollable at a desktop and Tauri-sized viewport`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 640 })
      await page.goto(legalPage.path)

      const scrollRegion = page.locator('.legal-page')
      await expect(scrollRegion).toBeVisible()
      await expect.poll(async () => scrollRegion.evaluate((element) => (
        element.scrollHeight > element.clientHeight
      ))).toBe(true)

      await scrollRegion.focus()
      await page.keyboard.press('End')

      await expect.poll(async () => scrollRegion.evaluate((element) => element.scrollTop > 0)).toBe(true)
      await expect(page.getByRole('heading', { name: legalPage.lastHeading })).toBeInViewport()
    })
  }
})
