import { test, expect } from '@playwright/test'

/**
 * Integration tests that require a real backend server running.
 * Run with: docker-compose up -d && npm run test:e2e
 *
 * These tests verify complete authentication flows with database persistence.
 */
test.describe('Auth Integration with Real Backend', () => {
  const testUser = {
    username: `testuser_${Date.now()}`,
    email: `test_${Date.now()}@example.com`,
    password: 'TestPassword123!',
  }

  test('should complete full registration and login flow', async ({ page }) => {
    // 1. Register new user
    await page.goto('/register')

    await page.getByPlaceholder(/username/i).fill(testUser.username)
    await page.getByPlaceholder(/email/i).fill(testUser.email)
    await page.getByPlaceholder(/password/i).fill(testUser.password)

    await page.getByRole('button', { name: /sign up/i }).click()

    // Should redirect to app after successful registration
    await expect(page).toHaveURL(/.*\/app/, { timeout: 10000 })

    // Should see app layout (e.g., Friends sidebar)
    await expect(page.getByText(/friends/i)).toBeVisible({ timeout: 5000 })

    // 2. Logout
    await page.getByRole('button', { name: /logout|sign out/i }).click()
    await expect(page).toHaveURL(/.*\/login/)

    // 3. Login with same credentials
    await page.getByPlaceholder(/email or username/i).fill(testUser.email)
    await page.getByPlaceholder(/password/i).fill(testUser.password)
    await page.getByRole('button', { name: /sign in/i }).click()

    // Should redirect to app after successful login
    await expect(page).toHaveURL(/.*\/app/, { timeout: 10000 })
    await expect(page.getByText(/friends/i)).toBeVisible({ timeout: 5000 })
  })

  test('should persist session on page reload', async ({ page }) => {
    // Login first
    await page.goto('/login')
    await page.getByPlaceholder(/email or username/i).fill(testUser.email)
    await page.getByPlaceholder(/password/i).fill(testUser.password)
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page).toHaveURL(/.*\/app/, { timeout: 10000 })

    // Reload page
    await page.reload()

    // Should still be logged in
    await expect(page).toHaveURL(/.*\/app/)
    await expect(page.getByText(/friends/i)).toBeVisible({ timeout: 5000 })
  })

  test('should persist session across browser restarts', async ({ browser }) => {
    // Create a new context with persistence
    const context = await browser.newContext({ storageState: undefined })
    const page = await context.newPage()

    // Login
    await page.goto('/login')
    await page.getByPlaceholder(/email or username/i).fill(testUser.email)
    await page.getByPlaceholder(/password/i).fill(testUser.password)
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page).toHaveURL(/.*\/app/, { timeout: 10000 })

    // Save storage state
    const storageState = await context.storageState()

    // Close everything
    await page.close()
    await context.close()

    // Create new context with saved storage
    const newContext = await browser.newContext({ storageState })
    const newPage = await newContext.newPage()

    // Should be logged in automatically
    await newPage.goto('/')
    await expect(newPage).toHaveURL(/.*\/app/, { timeout: 10000 })
    await expect(newPage.getByText(/friends/i)).toBeVisible({ timeout: 5000 })

    await newPage.close()
    await newContext.close()
  })

  test('should handle invalid login credentials', async ({ page }) => {
    await page.goto('/login')

    await page.getByPlaceholder(/email or username/i).fill('invalid@user.com')
    await page.getByPlaceholder(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Should show error message
    await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible({ timeout: 5000 })

    // Should remain on login page
    await expect(page).toHaveURL(/.*\/login/)
  })

  test('should handle duplicate registration', async ({ page }) => {
    await page.goto('/register')

    // Try to register with existing email
    await page.getByPlaceholder(/username/i).fill(`newuser_${Date.now()}`)
    await page.getByPlaceholder(/email/i).fill(testUser.email) // Duplicate
    await page.getByPlaceholder(/password/i).fill('NewPassword123!')

    await page.getByRole('button', { name: /sign up/i }).click()

    // Should show error about duplicate email
    await expect(
      page.getByText(/already exists|already taken|already registered/i)
    ).toBeVisible({ timeout: 5000 })

    // Should remain on register page
    await expect(page).toHaveURL(/.*\/register/)
  })

  test('should navigate between login and register', async ({ page }) => {
    await page.goto('/login')

    // Navigate to register
    await page.getByRole('link', { name: /sign up|create account/i }).click()
    await expect(page).toHaveURL(/.*\/register/)

    // Navigate back to login
    await page.getByRole('link', { name: /sign in|log in/i }).click()
    await expect(page).toHaveURL(/.*\/login/)
  })

  test('should validate password requirements on register', async ({ page }) => {
    await page.goto('/register')

    await page.getByPlaceholder(/username/i).fill('validuser')
    await page.getByPlaceholder(/email/i).fill('valid@email.com')
    await page.getByPlaceholder(/password/i).fill('weak') // Weak password

    await page.getByRole('button', { name: /sign up/i }).click()

    // Should show password validation error
    const passwordInput = page.getByPlaceholder(/password/i)
    await expect(passwordInput).toHaveAttribute('minlength', /\d+/)
  })

  test('should connect to WebSocket after login', async ({ page }) => {
    await page.goto('/login')

    await page.getByPlaceholder(/email or username/i).fill(testUser.email)
    await page.getByPlaceholder(/password/i).fill(testUser.password)
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page).toHaveURL(/.*\/app/, { timeout: 10000 })

    // Wait a bit for WebSocket to connect
    await page.waitForTimeout(2000)

    // Check for connection indicator or status
    // (Adjust selector based on your UI)
    const statusIndicator = page.locator('[data-status="online"]').or(page.getByText(/connected/i))
    await expect(statusIndicator).toBeVisible({ timeout: 10000 })
  })
})
