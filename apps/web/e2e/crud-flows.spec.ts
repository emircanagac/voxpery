import { test, expect } from '@playwright/test'

/**
 * Critical CRUD flow tests for servers, channels, and messages.
 * Requires backend running: docker-compose up -d
 */
test.describe('Critical CRUD Flows', () => {
  const testUser = {
    email: `crud_test_${Date.now()}@example.com`,
    username: `cruduser_${Date.now()}`,
    password: 'TestPassword123!',
  }

  const testServer = {
    name: `Test Server ${Date.now()}`,
  }

  const testChannel = {
    name: `test-channel-${Date.now()}`,
  }

  test.beforeEach(async ({ page }) => {
    // Register and login for each test
    await page.goto('/register')
    await page.getByPlaceholder(/username/i).fill(testUser.username)
    await page.getByPlaceholder(/email/i).fill(testUser.email)
    await page.getByPlaceholder(/password/i).fill(testUser.password)
    await page.getByRole('button', { name: /sign up/i }).click()

    // Wait for redirect to app
    await expect(page).toHaveURL(/.*\/app/, { timeout: 10000 })
  })

  test('should create a new server', async ({ page }) => {
    // Click create server button
    await page.getByRole('button', { name: /create server|new server|\+/i }).click()

    // Fill server name
    await page.getByPlaceholder(/server name/i).fill(testServer.name)

    // Submit form
    await page.getByRole('button', { name: /create/i }).click()

    // Should see new server in sidebar
    await expect(page.getByText(testServer.name)).toBeVisible({ timeout: 5000 })
  })

  test('should create a channel in a server', async ({ page }) => {
    // First create a server
    await page.getByRole('button', { name: /create server|new server|\+/i }).click()
    await page.getByPlaceholder(/server name/i).fill(testServer.name)
    await page.getByRole('button', { name: /create/i }).click()

    await page.waitForTimeout(1000)

    // Click on the server to select it
    await page.getByText(testServer.name).click()

    // Create channel
    await page.getByRole('button', { name: /create channel|new channel|\+/i }).click()
    await page.getByPlaceholder(/channel name/i).fill(testChannel.name)
    await page.getByRole('button', { name: /create/i }).click()

    // Should see new channel in channel list
    await expect(page.getByText(testChannel.name)).toBeVisible({ timeout: 5000 })
  })

  test('should send and receive messages in a channel', async ({ page }) => {
    const testMessage = `Test message ${Date.now()}`

    // Create server and channel
    await page.getByRole('button', { name: /create server|new server|\+/i }).click()
    await page.getByPlaceholder(/server name/i).fill(testServer.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    await page.getByText(testServer.name).click()
    await page.getByRole('button', { name: /create channel|new channel|\+/i }).click()
    await page.getByPlaceholder(/channel name/i).fill(testChannel.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    // Click on the channel
    await page.getByText(testChannel.name).click()

    // Type and send message
    const messageInput = page.getByPlaceholder(/message|type/i)
    await messageInput.fill(testMessage)
    await messageInput.press('Enter')

    // Should see the message in chat
    await expect(page.getByText(testMessage)).toBeVisible({ timeout: 5000 })
  })

  test('should delete a channel', async ({ page }) => {
    // Create server and channel
    await page.getByRole('button', { name: /create server|new server|\+/i }).click()
    await page.getByPlaceholder(/server name/i).fill(testServer.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    await page.getByText(testServer.name).click()
    await page.getByRole('button', { name: /create channel|new channel|\+/i }).click()
    await page.getByPlaceholder(/channel name/i).fill(testChannel.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    // Right-click on channel or click settings
    await page.getByText(testChannel.name).click({ button: 'right' })

    // Click delete option
    await page.getByRole('menuitem', { name: /delete/i }).click()

    // Confirm deletion
    await page.getByRole('button', { name: /confirm|delete/i }).click()

    // Channel should disappear
    await expect(page.getByText(testChannel.name)).not.toBeVisible({ timeout: 5000 })
  })

  test('should edit a message', async ({ page }) => {
    const originalMessage = `Original message ${Date.now()}`
    const editedMessage = `Edited message ${Date.now()}`

    // Create server, channel, and send message
    await page.getByRole('button', { name: /create server|new server|\+/i }).click()
    await page.getByPlaceholder(/server name/i).fill(testServer.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    await page.getByText(testServer.name).click()
    await page.getByRole('button', { name: /create channel|new channel|\+/i }).click()
    await page.getByPlaceholder(/channel name/i).fill(testChannel.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    await page.getByText(testChannel.name).click()

    const messageInput = page.getByPlaceholder(/message|type/i)
    await messageInput.fill(originalMessage)
    await messageInput.press('Enter')

    await expect(page.getByText(originalMessage)).toBeVisible({ timeout: 5000 })

    // Hover over message and click edit
    await page.getByText(originalMessage).hover()
    await page.getByRole('button', { name: /edit/i }).click()

    // Edit the message
    const editInput = page.getByRole('textbox', { name: /edit/i })
    await editInput.clear()
    await editInput.fill(editedMessage)
    await editInput.press('Enter')

    // Should see edited message
    await expect(page.getByText(editedMessage)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(originalMessage)).not.toBeVisible()
  })

  test('should delete a message', async ({ page }) => {
    const testMessage = `Message to delete ${Date.now()}`

    // Create server, channel, and send message
    await page.getByRole('button', { name: /create server|new server|\+/i }).click()
    await page.getByPlaceholder(/server name/i).fill(testServer.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    await page.getByText(testServer.name).click()
    await page.getByRole('button', { name: /create channel|new channel|\+/i }).click()
    await page.getByPlaceholder(/channel name/i).fill(testChannel.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    await page.getByText(testChannel.name).click()

    const messageInput = page.getByPlaceholder(/message|type/i)
    await messageInput.fill(testMessage)
    await messageInput.press('Enter')

    await expect(page.getByText(testMessage)).toBeVisible({ timeout: 5000 })

    // Hover over message and click delete
    await page.getByText(testMessage).hover()
    await page.getByRole('button', { name: /delete/i }).click()

    // Confirm deletion
    await page.getByRole('button', { name: /confirm|delete/i }).click()

    // Message should disappear
    await expect(page.getByText(testMessage)).not.toBeVisible({ timeout: 5000 })
  })

  test('should handle message pagination/scrolling', async ({ page }) => {
    // Create server and channel
    await page.getByRole('button', { name: /create server|new server|\+/i }).click()
    await page.getByPlaceholder(/server name/i).fill(testServer.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    await page.getByText(testServer.name).click()
    await page.getByRole('button', { name: /create channel|new channel|\+/i }).click()
    await page.getByPlaceholder(/channel name/i).fill(testChannel.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    await page.getByText(testChannel.name).click()

    // Send multiple messages
    const messageInput = page.getByPlaceholder(/message|type/i)
    for (let i = 0; i < 5; i++) {
      await messageInput.fill(`Test message ${i}`)
      await messageInput.press('Enter')
      await page.waitForTimeout(300)
    }

    // Should see all messages
    await expect(page.getByText('Test message 0')).toBeVisible()
    await expect(page.getByText('Test message 4')).toBeVisible()
  })

  test('should switch between channels', async ({ page }) => {
    const channel1 = `channel1-${Date.now()}`
    const channel2 = `channel2-${Date.now()}`

    // Create server
    await page.getByRole('button', { name: /create server|new server|\+/i }).click()
    await page.getByPlaceholder(/server name/i).fill(testServer.name)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    await page.getByText(testServer.name).click()

    // Create two channels
    await page.getByRole('button', { name: /create channel|new channel|\+/i }).click()
    await page.getByPlaceholder(/channel name/i).fill(channel1)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: /create channel|new channel|\+/i }).click()
    await page.getByPlaceholder(/channel name/i).fill(channel2)
    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForTimeout(1000)

    // Send message in channel1
    await page.getByText(channel1).click()
    const messageInput = page.getByPlaceholder(/message|type/i)
    await messageInput.fill('Message in channel 1')
    await messageInput.press('Enter')

    // Switch to channel2
    await page.getByText(channel2).click()
    await messageInput.fill('Message in channel 2')
    await messageInput.press('Enter')

    // Should see channel 2 message
    await expect(page.getByText('Message in channel 2')).toBeVisible()

    // Switch back to channel1
    await page.getByText(channel1).click()
    await expect(page.getByText('Message in channel 1')).toBeVisible()
  })
})
