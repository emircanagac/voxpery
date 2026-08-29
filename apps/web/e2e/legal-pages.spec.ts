import { expect, test } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

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

test.describe('versioned legal consent gate', () => {
  test('blocks app data until all documents are acknowledged and preserves logout', async ({ page }) => {
    const state = createMockCoreState({ legalConsentRequired: true })
    await installMockCoreApi(page, state)
    await page.goto('/social')

    const heading = page.getByRole('heading', { name: "Review Voxpery's legal documents" })
    await expect(heading).toBeFocused()
    await expect(page.getByText('Protected application')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeDisabled()
    await expect(page.getByRole('link', { name: /Terms of Service/ })).toHaveAttribute('href', '/terms')
    await expect(page.getByRole('link', { name: /Privacy Notice/ })).toHaveAttribute('href', '/privacy')
    await expect(page.getByRole('link', { name: /KVKK Aydinlatma Metni/ })).toHaveAttribute('href', '/kvkk')

    await page.getByLabel(/I accept the/).check()
    await page.getByLabel(/I have read the Privacy Notice/).check()
    await page.getByLabel(/I have read the KVKK/).check()
    await page.getByRole('button', { name: 'Accept and continue' }).click()

    await expect(heading).toHaveCount(0)
    expect(state.legalConsentAcknowledgementCount).toBe(1)

    state.legalConsentRequired = true
    await page.reload()
    await expect(page.getByRole('heading', { name: "Review Voxpery's legal documents" })).toBeVisible()
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Voxpery' })).toBeVisible()
    await expect.poll(() => state.logoutRequestCount).toBe(1)
  })

  test('fits the blocking review on a mobile viewport', async ({ page }) => {
    const state = createMockCoreState({ legalConsentRequired: true })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/social')

    await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
