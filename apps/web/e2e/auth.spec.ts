import { test, expect } from '@playwright/test'

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('should redirect to login page when not authenticated', async ({ page }) => {
    await expect(page).toHaveURL(/.*\/login/)
    await expect(page.getByRole('heading', { name: /voxpery/i })).toBeVisible()
  })

  test('should show login form', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByPlaceholder(/email or username/i)).toBeVisible()
    await expect(page.getByPlaceholder(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('should navigate to register page', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: /sign up/i }).click()

    await expect(page).toHaveURL(/.*\/register/)
    await expect(page.getByRole('heading', { name: /voxpery/i })).toBeVisible()
  })

  test('should show validation error for empty login', async ({ page }) => {
    await page.goto('/login')

    // Try to submit empty form
    await page.getByRole('button', { name: /sign in/i }).click()

    // HTML5 validation should prevent submission
    const identifierInput = page.getByPlaceholder(/email or username/i)
    await expect(identifierInput).toHaveAttribute('required', '')
  })

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login')

    await page.getByPlaceholder(/email or username/i).fill('nonexistent@user.com')
    await page.getByPlaceholder(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Should show error message
    await expect(page.getByRole('alert')).toBeVisible()
  })

  test('should show register form with all fields', async ({ page }) => {
    await page.goto('/register')

    await expect(page.getByPlaceholder(/username/i)).toBeVisible()
    await expect(page.getByPlaceholder(/email/i)).toBeVisible()
    await expect(page.getByPlaceholder(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible()
  })
})
