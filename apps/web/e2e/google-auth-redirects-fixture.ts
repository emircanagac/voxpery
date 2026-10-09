import { expect, type Page } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

export async function verifyGoogleLoginReturns(page: Page) {
  const state = createMockCoreState({ authenticated: false,
    features: { google_oauth_enabled: true, observability_enabled: false,
      email_delivery_enabled: false, email_verification_enabled: false,
      email_verification_required: false, password_reset_enabled: false },
  })
  await installMockCoreApi(page, state)
  await page.goto('/login')
  const googleLink = page.getByRole('link', { name: 'Continue with Google' })
  const defaultUrl = new URL((await googleLink.getAttribute('href'))!)
  expect(defaultUrl.searchParams.get('redirect')).toBe('/servers')
  expect(defaultUrl.searchParams.get('origin')).toBe(new URL(page.url()).origin)

  const redirect = '/social/dm?room=1#latest'
  for (const [error, message] of [
    ['oauth_cancelled', 'Google sign-in was cancelled.'],
    ['oauth_failed_csrf', 'could not be verified'],
    ['oauth_unverified_email', 'Google did not verify your email'],
    ['oauth_failed', 'Sign in with Google failed.'],
  ]) {
    await page.goto(`/login?error=${error}&redirect=${encodeURIComponent(redirect)}`)
    await expect(page.getByRole('alert')).toContainText(message)
    await expect(page.getByRole('alert')).toBeInViewport()
    const retryUrl = new URL((await googleLink.getAttribute('href'))!)
    expect(retryUrl.searchParams.get('redirect')).toBe(redirect)
  }

  // Model the session established by a successful web callback, then verify
  // the actual app router keeps the selected default destination.
  state.authenticated = true
  await page.goto(defaultUrl.searchParams.get('redirect')!)
  await expect(page).toHaveURL(/\/servers$/)
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0)
  await expect(page.locator('.shell-topbar')).toBeVisible()
}
