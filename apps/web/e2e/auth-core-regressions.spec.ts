import { expect, test } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

const AUTH_FEATURES = {
  google_oauth_enabled: false,
  observability_enabled: false,
  email_delivery_enabled: true,
  email_verification_enabled: true,
  email_verification_required: false,
  password_reset_enabled: true,
}

test.describe('mocked auth and account regressions', () => {
  test('restores each reload with one session snapshot and no separate consent check', { tag: '@core' }, async ({ page }) => {
    await installMockCoreApi(page)
    const calls: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (request.method() === 'GET' && path.startsWith('/api/auth/')) calls.push(path)
    })
    await page.goto('/social')
    for (let reload = 0; reload < 3; reload++) {
      await expect(page.getByRole('group', { name: 'Voice preferences' })).toBeVisible()
      await expect(page.getByText('Checking legal documents...')).toHaveCount(0)
      expect(calls.filter(path => path === '/api/auth/session')).toHaveLength(reload + 1)
      expect(calls.filter(path => ['/api/auth/me', '/api/auth/legal-consent'].includes(path))).toHaveLength(0)
      if (reload < 2) await page.reload()
    }
  })

  test('uses required consent from the session snapshot and saves it only on explicit acceptance', { tag: '@core' }, async ({ page }) => {
    const state = createMockCoreState({ legalConsentRequired: true })
    await installMockCoreApi(page, state)
    await page.goto('/social')
    await expect(page.getByRole('dialog')).toContainText("Review Voxpery's legal documents")
    expect(state.legalConsentAcknowledgementCount).toBe(0)
    await expect(page.getByRole('group', { name: 'Voice preferences' })).toHaveCount(0)
    for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check()
    await page.getByRole('button', { name: 'Accept and continue' }).click()
    await expect(page.getByRole('group', { name: 'Voice preferences' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('group', { name: 'Voice preferences' })).toBeVisible()
    expect(state.legalConsentAcknowledgementCount).toBe(1)
  })

  test('separates session outages from missing consent and allows explicit retry', { tag: '@core' }, async ({ page }) => {
    await installMockCoreApi(page)
    let unavailable = true
    await page.route('**/api/auth/session', route => unavailable
      ? route.fulfill({ status: 503, json: { error: 'Service temporarily unavailable' } })
      : route.fallback())
    await page.goto('/social')
    await expect(page.getByRole('heading', { name: 'Your session could not be checked' })).toBeVisible()
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Voice preferences' })).toHaveCount(0)
    unavailable = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('group', { name: 'Voice preferences' })).toBeVisible()
    unavailable = true
    await page.goto('/terms')
    await expect(page.getByRole('heading', { name: 'Terms of Service', exact: true })).toBeVisible()
  })

  test('never trusts stored profile hints when the cookie has expired', { tag: '@core' }, async ({ page }) => {
    await installMockCoreApi(page)
    await page.route('**/api/auth/session', route => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }))
    await page.goto('/social')
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Voice preferences' })).toHaveCount(0)
  })

  test('associates auth labels, supports keyboard navigation, and preserves redirect targets', { tag: '@core' }, async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState({ authenticated: false, features: AUTH_FEATURES }))
    await page.goto('/login?redirect=%2Fsocial%2Fdm')
    await page.getByText('Email or Username', { exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Email or Username' })).toBeFocused()
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
    const signUp = page.getByRole('link', { name: 'Sign Up', exact: true })
    await signUp.focus()
    await signUp.press('Enter')
    await expect(page).toHaveURL(/\/register\?redirect=%2Fsocial%2Fdm/)
    for (const label of ['Username', 'Email', 'Password', 'Confirm password']) {
      await page.getByText(label, { exact: true }).click()
      await expect(page.getByLabel(label, { exact: true })).toBeFocused()
      expect(await page.getByLabel(label, { exact: true }).evaluate((el: HTMLInputElement) => el.labels?.length)).toBe(1)
    }
    await expect(page.getByLabel('Username', { exact: true })).toHaveAttribute('autocomplete', 'username')
    await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('autocomplete', 'email')
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password')
    await expect(page.getByLabel('Confirm password', { exact: true })).toHaveAttribute('autocomplete', 'new-password')
    await expect(page.getByRole('checkbox')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Sign Up', exact: true })).toBeDisabled()
    await page.getByRole('link', { name: 'Sign In', exact: true }).press('Enter')
    await expect(page).toHaveURL(/\/login\?redirect=%2Fsocial%2Fdm/)
  })

  test('keeps auth actions reachable in short desktop and mobile viewports', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState({
      authenticated: false,
      features: { ...AUTH_FEATURES, google_oauth_enabled: true },
    }))

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1366, height: 768 },
      { width: 800, height: 600 },
      { width: 390, height: 667 },
      { width: 320, height: 568 },
      { width: 960, height: 600 },
    ]) {
      await page.setViewportSize(viewport)
      for (const path of ['/login', '/register']) {
        await page.goto(path)
        const scroller = page.locator('.auth-page')
        const card = page.locator('.auth-card')
        const submit = card.getByRole('button', { name: path === '/login' ? 'Sign In' : 'Sign Up' })
        const footer = card.locator('.auth-footer')

        await expect(card).toBeVisible()
        await expect.poll(async () => scroller.evaluate((element) => {
          const cardTop = element.querySelector('.auth-card')?.getBoundingClientRect().top ?? -1
          return cardTop >= -1 && element.scrollWidth <= element.clientWidth + 1
        })).toBe(true)

        await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
        await expect(footer).toBeInViewport()
        await expect(submit).toBeInViewport()
        await expect(card.getByRole(path === '/register' ? 'button' : 'link', { name: 'Continue with Google' })).toBeInViewport()
      }
    }
  })

  test('keeps the public header identical across landing and comparison routes', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState({ authenticated: false, features: AUTH_FEATURES }))

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 800, height: 600 },
      { width: 390, height: 667 },
    ]) {
      await page.setViewportSize(viewport)
      let baseline: unknown

      for (const path of ['/', '/about', '/compare']) {
        await page.goto(path)
        const header = page.locator('.about-topbar')
        await expect(header.getByRole('link', { name: 'Voxpery' })).toBeVisible()
        await expect(header.getByRole('link', { name: 'Login' })).toBeVisible()
        const geometry = await header.evaluate((element) => {
          const rect = (selector: string) => {
            const bounds = element.querySelector(selector)?.getBoundingClientRect()
            return bounds && [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round)
          }
          const logo = element.querySelector<HTMLImageElement>('.about-brand img')
          return {
            header: [element.getBoundingClientRect().height],
            brand: rect('.about-brand'),
            logo: rect('.about-brand img'),
            logoSource: logo?.getAttribute('src'),
            navigation: rect('.about-topbar-nav'),
            action: rect('.about-topbar-actions'),
          }
        })
        if (baseline === undefined) baseline = geometry
        else expect(geometry).toEqual(baseline)
      }
    }
  })

  test('requires separate current legal acknowledgements before registration', { tag: '@core' }, async ({ page }) => {
    const state = createMockCoreState({
      authenticated: false,
      features: { ...AUTH_FEATURES, google_oauth_enabled: true },
    })
    await installMockCoreApi(page, state)

    await page.goto('/register')

    const googleButton = page.getByRole('button', { name: 'Continue with Google' })
    await expect(googleButton).toBeDisabled()
    await expect(page.getByRole('checkbox')).toHaveCount(2)
    await page.getByRole('checkbox').nth(0).check()
    await page.getByRole('checkbox').nth(1).check()

    await expect(googleButton).toBeEnabled()
    // Google registration must not require the unrelated email/password fields.
    await page.route('**/api/auth/google?**', async (route) => { await route.fulfill({ contentType: 'text/html', body: '<h1>Google redirect</h1>' }) })
    const request = page.waitForRequest('**/api/auth/google?**')
    await googleButton.click()
    const oauthUrl = new URL((await request).url())
    expect(oauthUrl.searchParams.get('intent')).toBe('register')
    expect(oauthUrl.searchParams.get('terms_accepted')).toBe('true')
    expect(oauthUrl.searchParams.get('privacy_notice_acknowledged')).toBe('true')
    expect(oauthUrl.searchParams.get('terms_version')).toBe('2026-08-23')
    expect(oauthUrl.searchParams.get('privacy_notice_version')).toBe('2026-08-23')
  })

  test('keeps configured Google sign-in visible and preserves the post-auth route', { tag: '@core' }, async ({ page }) => {
    const state = createMockCoreState({
      authenticated: false,
      features: { ...AUTH_FEATURES, google_oauth_enabled: true },
    })
    await installMockCoreApi(page, state)

    await page.goto('/login?redirect=%2Fsocial%2Fdm')

    const googleLink = page.getByRole('link', { name: 'Continue with Google' })
    await expect(googleLink).toBeVisible()
    const href = await googleLink.getAttribute('href')
    expect(href).toBeTruthy()

    const oauthUrl = new URL(href!)
    expect(oauthUrl.pathname).toBe('/api/auth/google')
    expect(oauthUrl.searchParams.get('origin')).toBe(page.url().split('/login')[0])
    expect(oauthUrl.searchParams.get('redirect')).toBe('/social/dm')
  })

  test('disables email verification resend while the request is in flight', { tag: '@core' }, async ({ page }) => {
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

  test('confirms an email verification token once and keeps the success state', { tag: '@core' }, async ({ page }) => {
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

  test('shows success when a consumed verification token belongs to an already verified session', { tag: '@core' }, async ({ page }) => {
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

  test('keeps forgot-password and reset-password flows wired to the API', { tag: '@core' }, async ({ page }) => {
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
