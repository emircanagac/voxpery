import { expect, test } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

const legalPages = [
  { path: '/privacy', lastHeading: 'Changes and incidents' },
  { path: '/terms', lastHeading: 'Contact' },
  { path: '/kvkk', lastHeading: 'Saklama, mesaj gizliliği ve haklar' },
]

test.describe('public landing and comparison', () => {
  for (const authenticated of [false, true]) {
    test(`keeps the complete landing in a desktop viewport (signed in: ${authenticated})`, async ({ page }) => {
      await installMockCoreApi(page, createMockCoreState({ authenticated }))
      for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }]) {
        await page.setViewportSize(viewport)
        await page.goto('/about')
        const host = page.locator('.about-page')
        const image = page.getByRole('img', { name: 'Voxpery voice channel interface' })
        await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
        await expect.poll(() => host.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
        await expect(page.getByRole('link', { name: 'Terms of Service', exact: true })).toBeInViewport()
        await expect(page.getByRole('link', { name: /Download/ })).toBeInViewport()
        await expect(image).toBeInViewport()
        expect(await host.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await page.getByRole('link', { name: 'Compare', exact: true }).click()
        await expect(page.getByRole('region', { name: 'Voxpery advantages' })).toBeVisible()
        await expect.poll(() => host.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
        await expect(page.getByRole('link', { name: 'Terms of Service', exact: true })).toBeInViewport()
        await expect(page.getByRole('table')).toBeInViewport()
      }
    })
  }

  test('switches public actions at the shared compact breakpoint without losing navigation', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState({ authenticated: false }))
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/about')
    await expect(page.getByRole('link', { name: /Download/ })).toBeVisible()
    for (const viewport of [{ width: 1023, height: 768 }, { width: 800, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport)
      await expect(page.getByRole('link', { name: /Download/ })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Releases', exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: /Use Voxpery in browser/ })).toBeVisible()
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await expect(page.getByRole('link', { name: 'Source', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Security', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      const host = page.locator('.about-page')
      expect(await host.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await page.getByRole('link', { name: 'Terms of Service', exact: true }).scrollIntoViewIfNeeded()
      await expect(page.getByRole('link', { name: 'Terms of Service', exact: true })).toBeInViewport()
    }
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(page.getByRole('link', { name: /Download/ })).toBeVisible()
  })

  test('keeps public pages navigable and metadata distinct at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await installMockCoreApi(page, createMockCoreState({ authenticated: false }))
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Voxpery', level: 1 })).toBeVisible()
    await page.goto('/about')

    await expect(page.getByRole('heading', { name: 'Voxpery', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Contribute' })).toHaveAttribute(
      'href', 'https://github.com/emircanagac/voxpery/blob/main/docs/CONTRIBUTING.md',
    )
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://voxpery.com/')
    const header = page.locator('.about-topbar')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav).toBeVisible()
    expect(await nav.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(
      await header.evaluate((element) => element.getBoundingClientRect().right),
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.getByRole('link', { name: 'Compare' }).click()
    await expect(page).toHaveURL(/\/compare$/)
    await expect(page.getByRole('heading', { name: 'Voxpery', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Voxpery advantages' })).toBeVisible()
    await expect(page.getByText(/Open-source community chat/)).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Element' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Zulip' })).toBeVisible()
    await expect(page).toHaveTitle('Compare Voxpery with Community Chat Platforms')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://voxpery.com/compare')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Voxpery', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Voxpery', exact: true })).toHaveAttribute('href', '/about')
  })

  test('keeps the app gated while signed-in visitors read public pages', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState({ legalConsentRequired: true }))
    await page.goto('/')

    await expect(page.getByRole('heading', { name: "Review Voxpery's legal documents" })).toBeVisible()
    await expect(page).toHaveURL(/\/$/)

    await page.goto('/about')
    await expect(page.getByRole('heading', { name: 'Voxpery', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Voxpery' })).toHaveAttribute('href', '/social')

    await page.goto('/compare')
    await expect(page.getByRole('heading', { name: 'Voxpery', exact: true, level: 1 })).toBeVisible()
    await page.getByRole('link', { name: 'Voxpery', exact: true }).click()
    await page.getByRole('link', { name: 'Open Voxpery' }).click()
    await expect(page.getByRole('heading', { name: "Review Voxpery's legal documents" })).toBeVisible()
  })

  test('keeps comparison readable without page overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await installMockCoreApi(page, createMockCoreState({ authenticated: false }))
    await page.goto('/compare')

    const comparison = page.getByRole('region', { name: 'Platform comparison table' })
    await expect(page.getByRole('heading', { name: 'Voxpery', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await comparison.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await comparison.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => comparison.evaluate((element) => element.scrollLeft > 0)).toBe(true)

    await page.getByText('Sources and last check').click()
    await expect(page.getByRole('link', { name: 'Tauri desktop architecture' })).toBeVisible()
  })

  test('clears comparison metadata when returning to the signed-in app', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState())
    await page.goto('/compare')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://voxpery.com/compare')

    await page.getByRole('link', { name: 'Go to app' }).click()
    await expect(page).toHaveURL(/\/social$/)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://voxpery.com/')
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://voxpery.com/')
  })
})

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
