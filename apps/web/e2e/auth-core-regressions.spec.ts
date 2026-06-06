import { expect, test } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

const AUTH_FEATURES = {
  google_oauth_enabled: false,
  email_delivery_enabled: true,
  email_verification_enabled: true,
  email_verification_required: false,
  password_reset_enabled: true,
}

test.describe('mocked auth and account regressions', () => {
  test('disables email verification resend while the request is in flight', async ({ page }) => {
    const state = createMockCoreState({
      features: AUTH_FEATURES,
      emailVerificationRequestDelayMs: 400,
      user: {
        ...createMockCoreState().user,
        email: 'localuser@example.test',
        email_verified: false,
      },
    })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByText(/localuser@example\.test/)).toBeVisible()
    await expect(page.getByText(/Not verified/)).toBeVisible()

    await page.getByRole('button', { name: 'Verify' }).click()
    const sendingButton = page.getByRole('button', { name: 'Sending...' })
    await expect(sendingButton).toBeVisible()
    await expect(sendingButton).toBeDisabled()
    expect(state.emailVerificationRequestCount).toBe(1)

    await expect(page.locator('.toast-item', { hasText: 'Verification email sent' })).toBeVisible()
    expect(state.emailVerificationRequestCount).toBe(1)
  })

  test('confirms an email verification token once and keeps the success state', async ({ page }) => {
    const state = createMockCoreState({
      features: AUTH_FEATURES,
      user: {
        ...createMockCoreState().user,
        email_verified: false,
      },
    })
    await installMockCoreApi(page, state)

    await page.goto('/verify-email?token=valid-email-token')

    await expect.poll(() => state.emailVerificationConfirmCountByToken['valid-email-token'] ?? 0).toBe(1)
    await expect(page.getByText('Your email address has been verified.')).toBeVisible()
    expect(state.user.email_verified).toBe(true)
  })

  test('shows success when a consumed verification token belongs to an already verified session', async ({ page }) => {
    const state = createMockCoreState({
      features: AUTH_FEATURES,
      validEmailVerificationTokens: [],
      user: {
        ...createMockCoreState().user,
        email_verified: true,
      },
    })
    await installMockCoreApi(page, state)

    await page.goto('/verify-email?token=consumed-email-token')

    await expect.poll(() => state.emailVerificationConfirmCountByToken['consumed-email-token'] ?? 0).toBe(1)
    await expect(page.getByText('Your email address has already been verified.')).toBeVisible()
    await expect(page.getByText('Invalid email verification token')).toBeHidden()
  })

  test('keeps forgot-password and reset-password flows wired to the API', async ({ page }) => {
    const state = createMockCoreState({ authenticated: false, features: AUTH_FEATURES })
    await installMockCoreApi(page, state)

    await page.goto('/forgot-password')
    await expect(page.getByRole('heading', { name: 'Reset Password' })).toBeVisible()
    await page.getByPlaceholder('user@example.com').fill('localuser@example.test')
    await page.getByRole('button', { name: 'Send Reset Link' }).click()
    await expect(page.getByText('If that email exists, a reset link has been sent.')).toBeVisible()
    expect(state.forgotPasswordRequestCount).toBe(1)

    await page.goto('/reset-password?token=valid-reset-token')
    const passwordInputs = page.locator('input[type="password"]')
    await passwordInputs.nth(0).fill('new-password-123')
    await passwordInputs.nth(1).fill('different-password')
    await page.getByRole('button', { name: 'Reset Password' }).click()
    await expect(page.getByRole('alert')).toContainText('Passwords do not match')
    expect(state.resetPasswordRequestCount).toBe(0)

    await passwordInputs.nth(1).fill('new-password-123')
    await page.getByRole('button', { name: 'Reset Password' }).click()
    await expect(page.getByText('Password reset successful. You can now sign in.')).toBeVisible()
    expect(state.resetPasswordRequestCount).toBe(1)
  })
})
