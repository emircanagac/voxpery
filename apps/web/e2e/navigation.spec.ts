import { test, expect } from '@playwright/test'

test.describe('App Navigation', () => {
  test('should load home page', async ({ page }) => {
    await page.goto('/')

    // Should redirect to login if not authenticated
    await expect(page).toHaveURL(/.*\/login/)
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
