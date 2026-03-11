import { test, expect } from '@playwright/test'

/**
 * Friend request and DM flow tests.
 * Requires backend running: docker-compose up -d
 */
test.describe('Friend & DM Flows', () => {
  const user1 = {
    email: `user1_${Date.now()}@example.com`,
    username: `user1_${Date.now()}`,
    password: 'TestPassword123!',
  }

  const user2 = {
    email: `user2_${Date.now()}@example.com`,
    username: `user2_${Date.now()}`,
    password: 'TestPassword123!',
  }

  test('should send and accept friend request', async ({ browser }) => {
    // Create two separate browser contexts for two users
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Register user 1
    await page1.goto('/register')
    await page1.getByPlaceholder(/username/i).fill(user1.username)
    await page1.getByPlaceholder(/email/i).fill(user1.email)
    await page1.getByPlaceholder(/password/i).fill(user1.password)
    await page1.getByRole('button', { name: /sign up/i }).click()
    await expect(page1).toHaveURL(/\//, { timeout: 10000 })

    // Register user 2
    await page2.goto('/register')
    await page2.getByPlaceholder(/username/i).fill(user2.username)
    await page2.getByPlaceholder(/email/i).fill(user2.email)
    await page2.getByPlaceholder(/password/i).fill(user2.password)
    await page2.getByRole('button', { name: /sign up/i }).click()
    await expect(page2).toHaveURL(/\//, { timeout: 10000 })

    // User 1 sends friend request to user 2
    await page1.getByRole('button', { name: /add friend/i }).click()
    await page1.getByPlaceholder(/username|email/i).fill(user2.username)
    await page1.getByRole('button', { name: /send|add/i }).click()

    // Should show pending request
    await expect(page1.getByText(/pending|sent/i)).toBeVisible({ timeout: 5000 })

    // User 2 should see incoming friend request
    await page2.reload()
    await expect(page2.getByText(user1.username)).toBeVisible({ timeout: 5000 })

    // User 2 accepts friend request
    await page2.getByText(user1.username).click()
    await page2.getByRole('button', { name: /accept/i }).click()

    // Both users should now see each other as friends
    await expect(page2.getByText(user1.username)).toBeVisible()

    await page1.reload()
    await expect(page1.getByText(user2.username)).toBeVisible({ timeout: 5000 })

    await page1.close()
    await page2.close()
    await context1.close()
    await context2.close()
  })

  test('should send direct messages between friends', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Register and add as friends (abbreviated)
    await page1.goto('/register')
    await page1.getByPlaceholder(/username/i).fill(user1.username)
    await page1.getByPlaceholder(/email/i).fill(user1.email)
    await page1.getByPlaceholder(/password/i).fill(user1.password)
    await page1.getByRole('button', { name: /sign up/i }).click()
    await expect(page1).toHaveURL(/\//, { timeout: 10000 })

    await page2.goto('/register')
    await page2.getByPlaceholder(/username/i).fill(user2.username)
    await page2.getByPlaceholder(/email/i).fill(user2.email)
    await page2.getByPlaceholder(/password/i).fill(user2.password)
    await page2.getByRole('button', { name: /sign up/i }).click()
    await expect(page2).toHaveURL(/\//, { timeout: 10000 })

    // Send friend request
    await page1.getByRole('button', { name: /add friend/i }).click()
    await page1.getByPlaceholder(/username|email/i).fill(user2.username)
    await page1.getByRole('button', { name: /send|add/i }).click()

    await page2.waitForTimeout(2000)
    await page2.reload()
    await page2.getByText(user1.username).click()
    await page2.getByRole('button', { name: /accept/i }).click()

    await page1.waitForTimeout(2000)

    // User 1 opens DM with user 2
    await page1.reload()
    await page1.getByText(user2.username).click()
    await page1.getByRole('button', { name: /message|dm/i }).click()

    // Send message
    const dmMessage = `Hello from user1 ${Date.now()}`
    const messageInput = page1.getByPlaceholder(/message|type/i)
    await messageInput.fill(dmMessage)
    await messageInput.press('Enter')

    await expect(page1.getByText(dmMessage)).toBeVisible({ timeout: 5000 })

    // User 2 should receive the message
    await page2.waitForTimeout(2000)
    await page2.reload()

    // Click on DM with user1
    await page2.getByText(user1.username).click()
    await expect(page2.getByText(dmMessage)).toBeVisible({ timeout: 5000 })

    // User 2 replies
    const replyMessage = `Reply from user2 ${Date.now()}`
    const replyInput = page2.getByPlaceholder(/message|type/i)
    await replyInput.fill(replyMessage)
    await replyInput.press('Enter')

    // User 1 should see the reply
    await page1.waitForTimeout(2000)
    await expect(page1.getByText(replyMessage)).toBeVisible({ timeout: 5000 })

    await page1.close()
    await page2.close()
    await context1.close()
    await context2.close()
  })

  test('should reject friend request', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Register users
    await page1.goto('/register')
    await page1.getByPlaceholder(/username/i).fill(user1.username)
    await page1.getByPlaceholder(/email/i).fill(user1.email)
    await page1.getByPlaceholder(/password/i).fill(user1.password)
    await page1.getByRole('button', { name: /sign up/i }).click()
    await expect(page1).toHaveURL(/\//, { timeout: 10000 })

    await page2.goto('/register')
    await page2.getByPlaceholder(/username/i).fill(user2.username)
    await page2.getByPlaceholder(/email/i).fill(user2.email)
    await page2.getByPlaceholder(/password/i).fill(user2.password)
    await page2.getByRole('button', { name: /sign up/i }).click()
    await expect(page2).toHaveURL(/\//, { timeout: 10000 })

    // User 1 sends friend request
    await page1.getByRole('button', { name: /add friend/i }).click()
    await page1.getByPlaceholder(/username|email/i).fill(user2.username)
    await page1.getByRole('button', { name: /send|add/i }).click()

    // User 2 rejects friend request
    await page2.waitForTimeout(2000)
    await page2.reload()
    await page2.getByText(user1.username).click()
    await page2.getByRole('button', { name: /reject|decline/i }).click()

    // Request should disappear
    await expect(page2.getByText(user1.username)).not.toBeVisible({ timeout: 5000 })

    // User 1 should see request was rejected
    await page1.reload()
    await expect(page1.getByText(/pending|sent/i)).not.toBeVisible({ timeout: 5000 })

    await page1.close()
    await page2.close()
    await context1.close()
    await context2.close()
  })

  test('should remove friend', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Register and become friends (abbreviated)
    await page1.goto('/register')
    await page1.getByPlaceholder(/username/i).fill(user1.username)
    await page1.getByPlaceholder(/email/i).fill(user1.email)
    await page1.getByPlaceholder(/password/i).fill(user1.password)
    await page1.getByRole('button', { name: /sign up/i }).click()
    await expect(page1).toHaveURL(/\//, { timeout: 10000 })

    await page2.goto('/register')
    await page2.getByPlaceholder(/username/i).fill(user2.username)
    await page2.getByPlaceholder(/email/i).fill(user2.email)
    await page2.getByPlaceholder(/password/i).fill(user2.password)
    await page2.getByRole('button', { name: /sign up/i }).click()
    await expect(page2).toHaveURL(/\//, { timeout: 10000 })

    // Send and accept friend request
    await page1.getByRole('button', { name: /add friend/i }).click()
    await page1.getByPlaceholder(/username|email/i).fill(user2.username)
    await page1.getByRole('button', { name: /send|add/i }).click()

    await page2.waitForTimeout(2000)
    await page2.reload()
    await page2.getByText(user1.username).click()
    await page2.getByRole('button', { name: /accept/i }).click()

    await page1.waitForTimeout(2000)
    await page1.reload()

    // User 1 removes user 2 as friend
    await page1.getByText(user2.username).click({ button: 'right' })
    await page1.getByRole('menuitem', { name: /remove|unfriend/i }).click()
    await page1.getByRole('button', { name: /confirm|remove/i }).click()

    // User 2 should disappear from friends list
    await expect(page1.getByText(user2.username)).not.toBeVisible({ timeout: 5000 })

    await page1.close()
    await page2.close()
    await context1.close()
    await context2.close()
  })
})
