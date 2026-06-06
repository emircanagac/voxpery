import { expect, test } from '@playwright/test'
import {
  buildFriends,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

test.describe('mocked release and settings regressions', () => {
  test('shows the beta channel and build version in a single brand badge', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(3) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')

    const releaseBadge = page.locator('.shell-brand-release')
    await expect(releaseBadge).toBeVisible()
    await expect(releaseBadge).toContainText('Beta')
    await expect(releaseBadge).toContainText('v0.2.0-test')
    await expect(releaseBadge).toHaveAttribute('title', 'Beta channel, running build v0.2.0-test')

    const hasHorizontalOverflow = await page.locator('.shell-topbar').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('keeps profile password modal validation and submission wired', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.locator('.user-setting-row', { hasText: 'Password' }).getByRole('button', { name: 'Change' }).click()
    const passwordModal = page.locator('.pw-modal', { hasText: 'Change password' })
    await expect(passwordModal).toBeVisible()

    const currentPassword = passwordModal.locator('#pw-old')
    const newPassword = passwordModal.locator('#pw-new')
    const confirmPassword = passwordModal.locator('#pw-confirm')
    const confirmButton = passwordModal.getByRole('button', { name: 'Confirm' })

    await expect(confirmButton).toBeDisabled()
    await currentPassword.fill('old-password-123')
    await newPassword.fill('new-password-123')
    await confirmPassword.fill('different-password')
    await expect(passwordModal.getByText('Passwords do not match')).toBeVisible()
    await expect(confirmButton).toBeDisabled()

    await confirmPassword.fill('new-password-123')
    await expect(confirmButton).toBeEnabled()
    await confirmButton.click()

    await expect(passwordModal.getByText(/Password changed! Redirecting to login/)).toBeVisible()
    expect(state.changePasswordRequestCount).toBe(1)
  })

  test('keeps Privacy & Data export and delete-account guardrails reachable', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Privacy & Data' }).click()

    const modal = page.locator('.user-settings-modal')
    await expect(modal).toContainText('Data export')
    await expect(modal).toContainText('Delete account')

    const downloadPromise = page.waitForEvent('download')
    await modal.locator('.user-setting-row', { hasText: 'Data export' }).getByRole('button', { name: /Export/ }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^voxpery-data-export-\d{4}-\d{2}-\d{2}\.json$/)
    await expect(page.locator('.toast-item', { hasText: 'Data export ready' })).toBeVisible()
    expect(state.dataExportRequestCount).toBe(1)

    await modal.locator('.user-setting-row', { hasText: 'Delete account' }).getByRole('button', { name: 'Manage' }).click()
    const deleteModal = page.locator('.delete-account-modal')
    await expect(deleteModal).toBeVisible()
    const deleteButton = deleteModal.getByRole('button', { name: 'Delete account' })
    await expect(deleteButton).toBeDisabled()

    await deleteModal.locator('#delete-password').fill('current-password-123')
    await deleteModal.locator('#delete-confirm').fill('DELETE')
    await expect(deleteModal.getByText('Confirmation text is valid.')).toBeVisible()
    await expect(deleteButton).toBeEnabled()
    await deleteButton.click()

    await expect(page).toHaveURL(/\/login/)
    expect(state.deleteAccountRequestCount).toBe(1)
    expect(state.lastDeleteAccountConfirm).toBe('DELETE')
  })
})
