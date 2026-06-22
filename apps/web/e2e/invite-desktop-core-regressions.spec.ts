import { expect, test, type Page } from '@playwright/test'
import {
  buildCoreChannels,
  buildCoreMembers,
  buildCoreRules,
  buildCoreServer,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

async function installMockTauriRuntime(page: Page) {
  await page.addInitScript(() => {
    const tauriInternals = {
      invoke: async (cmd: string, args?: { payload?: { prefixedKey?: string } }) => {
        if (cmd === 'plugin:app|version') return '0.2.0-desktop-test'
        if (cmd === 'plugin:updater|check') return null
        if (cmd === 'plugin:autostart|is_enabled') return true
        if (cmd === 'plugin:secure-storage|get_item' && args?.payload?.prefixedKey === 'voxpery-auth-token') {
          return 'mock-token'
        }
        return null
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      convertFileSrc: (filePath: string) => filePath,
    }
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: tauriInternals,
      configurable: true,
    })
    Object.defineProperty(navigator, 'userAgent', {
      value: `${navigator.userAgent} Tauri Windows`,
      configurable: true,
    })
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    })
  })
}

test.describe('mocked invite and desktop runtime regressions', () => {
  test('redirects unauthenticated invite visitors to login with the invite return path', async ({ page }) => {
    const state = createMockCoreState({ authenticated: false })
    await installMockCoreApi(page, state)

    await page.goto('/invite/core-invite')

    await expect(page).toHaveURL(/\/login\?redirect=%2Finvite%2Fcore-invite/)
  })

  test('requires server rules acceptance before joining from an invite', async ({ page }) => {
    const inviteServer = buildCoreServer({
      id: 'server-invite-core',
      name: 'Invite Guild',
      description: 'A joinable community for release smoke coverage.',
      invite_code: 'core-invite',
    })
    const channels = buildCoreChannels(inviteServer.id)
    const state = createMockCoreState({
      servers: [],
      inviteServersByCode: { [inviteServer.invite_code]: inviteServer },
      channelsByServerId: { [inviteServer.id]: channels },
      membersByServerId: { [inviteServer.id]: buildCoreMembers() },
      serverRulesByServerId: { [inviteServer.id]: buildCoreRules(inviteServer.id) },
    })
    await installMockCoreApi(page, state)

    await page.goto('/invite/core-invite')

    await expect(page.getByRole('heading', { name: 'Join server' })).toBeVisible()
    await expect(page.getByText('Invite Guild')).toBeVisible()
    await expect(page.getByText('A joinable community for release smoke coverage.')).toBeVisible()
    await expect(page.getByText('Server Rules', { exact: true })).toBeVisible()
    await expect(page.getByText('Be respectful to other members.')).toBeVisible()

    const joinButton = page.getByRole('button', { name: 'Join server' })
    await expect(joinButton).toBeDisabled()

    await page.getByLabel('I have read and agree to the server rules').check()
    await expect(joinButton).toBeEnabled()
    await joinButton.click()

    await expect(page).toHaveURL(/\/servers/)
    await expect(page.getByText('Invite Guild').first()).toBeVisible()
    expect(state.serverJoinCount).toBe(1)
    expect(state.joinedInviteCodes).toEqual(['core-invite'])
    expect(state.servers.some((server) => server.id === inviteServer.id)).toBe(true)
  })

  test('keeps desktop-only settings visible when the web shell runs inside Tauri', async ({ page }) => {
    const state = createMockCoreState()
    await installMockTauriRuntime(page)
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    const settingsModal = page.locator('.user-settings-modal')
    await expect(settingsModal.locator('.user-settings-subtitle')).toContainText('voice, desktop, and privacy')
    await page.getByRole('button', { name: 'Communication' }).click()
    await expect(settingsModal.getByText('Desktop notifications', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Desktop' }).click()
    await expect(settingsModal).toContainText('App updates')
    await expect(settingsModal).toContainText('Installed version: 0.2.0-desktop-test.')
    await expect(settingsModal).toContainText('Launch on startup')
    await expect(settingsModal).toContainText('Keep running in tray on close')
  })
})
