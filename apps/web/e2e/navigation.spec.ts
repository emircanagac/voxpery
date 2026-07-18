import { test, expect } from '@playwright/test'

test.describe('App Navigation', () => {
  test('should load the public product page', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Voxpery', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: /join voxpery community/i })).toHaveAttribute('href', '/register')
    await expect(page.getByRole('link', { name: /self-host with docker/i })).toBeVisible()
  })

  test('should keep the public product page usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Voxpery', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: /join voxpery community/i })).toBeVisible()
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
    await page.goto('/nonexistent-route-12345')

    // Should redirect to login (authentication gate)
    await expect(page).toHaveURL(/.*\/login/)
  })
})

test.describe('Connection Gate', () => {
  test('should show connection error when backend is down', async ({ page, context }) => {
    // Block API requests to simulate backend down
    await context.route('**/api/**', route => route.abort())

    await page.goto('/login')

    // Should show connection error
    await expect(page.getByText(/unable to connect/i)).toBeVisible({ timeout: 10000 })
  })
})
