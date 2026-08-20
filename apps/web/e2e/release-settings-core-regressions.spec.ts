import { expect, test } from '@playwright/test'
import {
  buildCoreChannels,
  buildCoreMembers,
  buildCoreServer,
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

  test('keeps developer diagnostics out of web settings and uses web-specific copy', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.addInitScript(() => localStorage.setItem('voxperyVoiceDiagnostics', '1'))

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()

    const modal = page.locator('.user-settings-modal')
    await expect(modal.locator('.user-settings-subtitle')).toContainText('account, appearance, communication, voice, and privacy')
    await expect(modal.locator('.user-settings-subtitle')).not.toContainText('desktop')
    await page.getByRole('button', { name: 'Communication' }).click()
    await expect(modal.getByText('Browser notifications', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Voice & Audio' }).click()
    await expect(modal.getByText('Benchmark diagnostics', { exact: true })).toHaveCount(0)
  })

  test('switches built-in themes and resets appearance defaults without layout overflow', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()

    const modal = page.locator('.user-settings-modal')
    await expect(modal.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    await modal.locator('.theme-option', { hasText: 'Dark' }).click()
    await page.evaluate(() => {
      const probe = document.createElement('button')
      probe.className = 'chat-jump-to-latest theme-contract-probe'
      probe.textContent = 'Newest'
      document.body.appendChild(probe)
    })
    const darkTheme = await readAppearanceThemeSnapshot(page)

    await modal.locator('.theme-option', { hasText: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    const lightTheme = await readAppearanceThemeSnapshot(page)

    expect(darkTheme.modalSurface).not.toBe(lightTheme.modalSurface)
    expect(darkTheme.activeSettingsNavigation).not.toBe(lightTheme.activeSettingsNavigation)
    expect(darkTheme.serverActions).not.toBe(lightTheme.serverActions)
    expect(darkTheme.releaseBadge).not.toBe(lightTheme.releaseBadge)
    expect(darkTheme.jumpToLatest).not.toBe(lightTheme.jumpToLatest)
    await expect.poll(async () => {
      return page.locator('.server-sidebar-actions').evaluate((element) => getComputedStyle(element).backgroundImage)
    }).toContain('rgb(232, 235, 240)')

    await expectNoHorizontalOverflow(modal)

    await modal.getByRole('button', { name: 'Reset defaults' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'voxpery')
    await expect(modal.getByRole('button', { name: 'Reset defaults' })).toBeDisabled()

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'voxpery')
    await expect(page.locator('html')).not.toHaveAttribute('data-custom-accent', 'true')
  })

  test('persists a generated full theme from one custom color', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()

    const modal = page.locator('.user-settings-modal')
    const themeGroup = modal.getByRole('group', { name: 'Theme' })
    await expect(themeGroup.locator('.theme-option')).toHaveCount(4)
    await expect(themeGroup.locator('.theme-option-label')).toHaveText(['Default', 'Custom', 'Dark', 'Light'])
    await expect(themeGroup.getByRole('button', { name: /Default/ })).toBeVisible()
    await expect(themeGroup.getByRole('button', { name: /Dark/ })).toBeVisible()
    await expect(themeGroup.getByRole('button', { name: /Light/ })).toBeVisible()
    await expect(themeGroup.getByRole('button', { name: /Custom/ })).toBeVisible()
    await expect(modal.locator('.theme-custom-panel')).toHaveCount(0)
    await modal.getByRole('button', { name: /Custom/ }).click()
    await expect(modal.locator('.theme-custom-panel')).toBeVisible()
    const customThemeInput = modal.getByRole('textbox', { name: 'Custom theme hex color' })
    await customThemeInput.fill('#7b3fc6')
    await customThemeInput.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme-mode', 'dark')
    await expect(modal.getByText('Choose your color', { exact: true })).toBeVisible()
    await expect(modal.getByText('Background style', { exact: true })).toHaveCount(0)
    const customAccentInput = modal.getByRole('textbox', { name: 'Custom accent hex color' })
    await expect(customAccentInput).toBeVisible()
    await customAccentInput.fill('#2f9b78')
    await customAccentInput.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-custom-accent', 'true')
    await expect(page.locator('html')).toHaveCSS('--user-accent', '#2f9b78')
    await expectNoHorizontalOverflow(modal)

    const generatedBackground = await page.locator('html').evaluate((element) => (
      getComputedStyle(element).getPropertyValue('--user-theme-bg-primary').trim()
    ))
    expect(generatedBackground).toMatch(/^#[0-9a-f]{6}$/)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme-mode', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-custom-accent', 'true')
    await expect(page.locator('html')).toHaveCSS('--user-accent', '#2f9b78')
    await expect(page.locator('html')).toHaveCSS('--user-theme-bg-primary', generatedBackground)
  })

  test('keeps member, voice, callbar, and image-preview chrome readable across themes', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(2) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.evaluate(() => {
      const fixture = document.createElement('div')
      fixture.id = 'appearance-contract-fixture'
      fixture.style.cssText = 'position:fixed;left:-10000px;top:0;width:480px;'
      fixture.innerHTML = `
        <span class="appearance-primary-reference">Primary</span>
        <span class="appearance-secondary-reference">Secondary</span>
        <aside class="member-sidebar">
          <div class="member-item"><span class="member-name">Readable member</span></div>
        </aside>
        <div class="voice-stage-tile">
          <span class="voice-stage-name">Voice member</span>
          <span class="voice-stage-sub">In voice</span>
        </div>
        <div class="active-call-bar">
          <button class="active-call-title-btn">Voice channel</button>
          <button class="callbar-control-btn">Control</button>
        </div>
        <div class="chat-image-preview-modal">
          <div class="chat-image-preview-toolbar">
            <span class="chat-image-preview-title">Image preview</span>
          </div>
          <div class="chat-image-preview-stage"></div>
        </div>
      `
      fixture.querySelector<HTMLElement>('.appearance-primary-reference')!.style.color = 'var(--text-primary)'
      fixture.querySelector<HTMLElement>('.appearance-secondary-reference')!.style.color = 'var(--text-secondary)'
      document.body.appendChild(fixture)
    })

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()
    const modal = page.locator('.user-settings-modal')

    await modal.locator('.theme-option', { hasText: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const dark = await readSettledSemanticThemeSnapshot(page)

    await modal.locator('.theme-option', { hasText: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    const light = await readSettledSemanticThemeSnapshot(page)

    await modal.getByRole('button', { name: /Custom/ }).click()
    const customInput = modal.getByRole('textbox', { name: 'Custom theme hex color' })
    await customInput.fill('#8d50ca')
    await customInput.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-custom-theme', 'true')
    const custom = await readSettledSemanticThemeSnapshot(page)

    expect(light.memberSurface).not.toBe(dark.memberSurface)
    expect(light.voiceSurface).not.toBe(dark.voiceSurface)
    expect(light.callbarSurface).not.toBe(dark.callbarSurface)
    expect(light.previewSurface).not.toBe(dark.previewSurface)
    expect(custom.voiceSurface).not.toBe(dark.voiceSurface)
  })

  test('keeps the compact feedback dock inside its fixed area on Social and server views', async ({ page }) => {
    const server = buildCoreServer()
    const state = createMockCoreState({
      friends: buildFriends(2),
      servers: [server],
      channelsByServerId: { [server.id]: buildCoreChannels(server.id) },
      membersByServerId: { [server.id]: buildCoreMembers() },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 620 })

    await page.goto('/social')

    const feedbackCard = page.locator('.feedback-dock .feedback-card')
    await expect(feedbackCard.getByRole('heading', { name: 'Share feedback on GitHub' })).toBeVisible()
    await expect(feedbackCard.getByRole('button', { name: 'Report a bug' })).toBeVisible()
    await expect(feedbackCard.getByRole('button', { name: 'Request a feature' })).toBeVisible()
    await expect(page.locator('.home-side .feedback-card')).toHaveCount(0)

    await expectCompactFeedbackDock(page)

    await page.goto('/servers')
    await expect(page.locator('.channel-header-title')).toHaveText('Core Guild')
    await expectCompactFeedbackDock(page)
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

async function expectNoHorizontalOverflow(locator: import('@playwright/test').Locator) {
  await expect.poll(async () => {
    return locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
  }).toBe(true)
}

async function expectCompactFeedbackDock(page: import('@playwright/test').Page) {
  const dock = page.locator('.feedback-dock')
  const card = dock.locator('.feedback-card')
  await expect(dock).toBeVisible()
  await expect(card).toBeVisible()

  const boxes = await Promise.all([dock.boundingBox(), card.boundingBox()])
  const [dockBox, cardBox] = boxes
  expect(dockBox).not.toBeNull()
  expect(cardBox).not.toBeNull()
  if (!dockBox || !cardBox) return

  expect(dockBox.width).toBe(240)
  expect(dockBox.height).toBe(80)
  const insets = [
    cardBox.x - dockBox.x,
    dockBox.x + dockBox.width - cardBox.x - cardBox.width,
    cardBox.y - dockBox.y,
    dockBox.y + dockBox.height - cardBox.y - cardBox.height,
  ]
  expect(Math.min(...insets)).toBeGreaterThanOrEqual(7)
  expect(Math.max(...insets) - Math.min(...insets)).toBeLessThanOrEqual(1)
}

async function readAppearanceThemeSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const backgroundOf = (selector: string) => {
      const target = document.querySelector(selector)
      if (!target) throw new Error(`Missing appearance theme target: ${selector}`)
      return getComputedStyle(target).background
    }

    return {
      modalSurface: backgroundOf('.user-settings-modal'),
      activeSettingsNavigation: backgroundOf('.user-settings-nav__item--active'),
      serverActions: backgroundOf('.server-sidebar-actions'),
      releaseBadge: backgroundOf('.shell-brand-release'),
      jumpToLatest: backgroundOf('.theme-contract-probe'),
    }
  })
}

type SemanticThemeSnapshot = Awaited<ReturnType<typeof readSemanticThemeSnapshot>>

async function readSemanticThemeSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const style = (selector: string) => {
      const target = document.querySelector(selector)
      if (!target) throw new Error(`Missing semantic theme target: ${selector}`)
      return getComputedStyle(target)
    }
    return {
      primary: style('.appearance-primary-reference').color,
      secondary: style('.appearance-secondary-reference').color,
      memberText: style('#appearance-contract-fixture .member-name').color,
      voiceName: style('#appearance-contract-fixture .voice-stage-name').color,
      voiceSub: style('#appearance-contract-fixture .voice-stage-sub').color,
      callbarText: style('#appearance-contract-fixture .active-call-title-btn').color,
      previewText: style('#appearance-contract-fixture .chat-image-preview-title').color,
      memberSurface: style('#appearance-contract-fixture .member-item').background,
      voiceSurface: style('#appearance-contract-fixture .voice-stage-tile').background,
      callbarSurface: style('#appearance-contract-fixture .active-call-bar').background,
      previewSurface: style('#appearance-contract-fixture .chat-image-preview-modal').background,
    }
  })
}

function assertSemanticTextContract(snapshot: SemanticThemeSnapshot) {
  expect(snapshot.memberText).toBe(snapshot.primary)
  expect(snapshot.voiceName).toBe(snapshot.primary)
  expect(snapshot.voiceSub).toBe(snapshot.secondary)
  expect(snapshot.callbarText).toBe(snapshot.secondary)
  expect(snapshot.previewText).toBe(snapshot.secondary)
}

async function readSettledSemanticThemeSnapshot(page: import('@playwright/test').Page) {
  await expect.poll(async () => {
    const snapshot = await readSemanticThemeSnapshot(page)
    return snapshot.memberText === snapshot.primary
      && snapshot.voiceName === snapshot.primary
      && snapshot.voiceSub === snapshot.secondary
      && snapshot.callbarText === snapshot.secondary
      && snapshot.previewText === snapshot.secondary
  }).toBe(true)
  const snapshot = await readSemanticThemeSnapshot(page)
  assertSemanticTextContract(snapshot)
  return snapshot
}
