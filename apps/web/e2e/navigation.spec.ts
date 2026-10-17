import { test, expect } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

test.describe('App Navigation', () => {
  test('should load the public product page', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Voxpery', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login')
    await expect(page.getByRole('link', { name: /use voxpery in browser/i })).toHaveAttribute('href', '/register')
    await expect(page.getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery',
    )
    await expect(page.getByRole('link', { name: /self-host with docker/i })).toBeVisible()
  })

  test('should keep the public product page usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Voxpery', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: /use voxpery in browser/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /self-host with docker/i })).toBeVisible()
    await expect(page.getByRole('img', { name: /voxpery voice channel interface/i })).toBeVisible()

    const hasHorizontalOverflow = await page.locator('.about-page').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('should display Voxpery branding', async ({ page }) => {
    await page.goto('/login')

    // Check for logo
    await expect(page.getByAltText(/voxpery/i)).toBeVisible()
  })

  test('should have proper page title', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle(/voxpery/i)
  })

  test('should handle 404 routes', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState({ authenticated: false }))
    await page.goto('/nonexistent-route-12345')

    // Unknown addresses show a not-found page instead of redirecting
    await expect(page).toHaveURL(/\/nonexistent-route-12345$/)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  })
})
