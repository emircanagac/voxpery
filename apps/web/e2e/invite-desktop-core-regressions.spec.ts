import { expect, test, type Page } from '@playwright/test'
import {
  buildCoreChannels,
  buildCoreMembers,
  buildCoreRules,
  buildCoreServer,
  buildServerMessage,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

async function installMockTauriRuntime(page: Page) {
  await page.addInitScript(() => {
    const openedUrls: string[] = []
    Object.assign(window, { __testOpenedUrls: openedUrls })
    const tauriInternals = {
      invoke: async (cmd: string, args?: { payload?: { prefixedKey?: string }; url?: string }) => {
        if (cmd === 'plugin:opener|open_url' && args?.url) {
          openedUrls.push(args.url)
          return null
        }
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
  test('keeps the desktop root on login when signed out', { tag: '@core' }, async ({ page }) => {
    await installMockTauriRuntime(page)
    await installMockCoreApi(page, createMockCoreState({ authenticated: false }))
    await page.goto('/')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Voxpery' })).toBeVisible()
  })

  test('keeps the desktop root in the app and public pages available separately', async ({ page }) => {
    await installMockTauriRuntime(page)
    await installMockCoreApi(page, createMockCoreState())
    await page.goto('/')

    await expect(page).toHaveURL(/\/social$/)
    await page.goto('/about')
    await expect(page.getByRole('heading', { name: 'Voxpery', level: 1 })).toBeVisible()
    await page.goto('/compare')
    await expect(page.getByRole('heading', { name: 'Voxpery', level: 1, exact: true })).toBeVisible()
  })

  test('opens About Voxpery from Settings without leaving the web app', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState())
    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()

    const [aboutTab] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: 'About Voxpery' }).click(),
    ])
    await expect(aboutTab).toHaveURL(/\/about$/)
    await expect(aboutTab.getByRole('heading', { name: 'Voxpery', level: 1 })).toBeVisible()
    await expect(page).toHaveURL(/\/social$/)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await aboutTab.close()
  })

  test('redirects unauthenticated invite visitors to login with the invite return path', { tag: '@core' }, async ({ page }) => {
    const state = createMockCoreState({ authenticated: false })
    await installMockCoreApi(page, state)

    await page.goto('/invite/core-invite')

    await expect(page).toHaveURL(/\/login\?redirect=%2Finvite%2Fcore-invite/)
  })

  test('requires server rules acceptance before joining from an invite', { tag: '@core' }, async ({ page }) => {
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

  test('offers a way out of an invalid invite and opens servers the user already joined', { tag: '@core' }, async ({ page }) => {
    const memberServer = buildCoreServer({ id: 'server-member', name: 'Home Guild', invite_code: 'home-invite' })
    const state = createMockCoreState({
      servers: [memberServer],
      inviteServersByCode: { [memberServer.invite_code]: memberServer },
      channelsByServerId: { [memberServer.id]: buildCoreChannels(memberServer.id) },
      membersByServerId: { [memberServer.id]: buildCoreMembers() },
    })
    await installMockCoreApi(page, state)

    await page.goto('/invite/doesnotexist')
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Invite unavailable' })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Invalid invite code')
    await page.getByRole('button', { name: 'Back to Voxpery' }).click()
    await expect(page).not.toHaveURL(/\/invite\//)

    await page.goto('/invite/home-invite')
    await expect(page.getByRole('heading', { name: 'You’re already a member' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Join server' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Open server' }).click()
    await expect(page).toHaveURL(/\/servers/)
    expect(state.serverJoinCount).toBe(0)
  })

  test('opens an invite link from chat inside the desktop app without a browser', { tag: '@core' }, async ({ page }) => {
    const homeServer = buildCoreServer()
    const homeChannels = buildCoreChannels(homeServer.id)
    const general = homeChannels.find((channel) => channel.name === 'general')!
    const inviteServer = buildCoreServer({ id: 'server-invite-chat', name: 'Linked Guild', invite_code: 'core-invite' })
    const state = createMockCoreState({
      servers: [homeServer],
      channelsByServerId: { [homeServer.id]: homeChannels, [inviteServer.id]: buildCoreChannels(inviteServer.id) },
      membersByServerId: { [homeServer.id]: buildCoreMembers(), [inviteServer.id]: buildCoreMembers() },
      inviteServersByCode: { [inviteServer.invite_code]: inviteServer },
    })
    await installMockTauriRuntime(page)
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    // Use the public invite origin this desktop build shares, as shown in Invite People.
    await page.goto('/servers')
    await page.getByTitle('Server menu').click()
    await page.getByRole('menuitem', { name: 'Invite People' }).click()
    const shared = await page.getByRole('textbox', { name: 'Invite link' }).inputValue()
    const inviteLink = `${new URL(shared).origin}/invite/core-invite`
    state.messagesByChannelId[general.id] = [buildServerMessage(general.id, `Come hang out: ${inviteLink}`)]
    await page.reload()
    await page.locator('.chat-messages').getByText(inviteLink).click()

    await expect(page).toHaveURL(/\/invite\/core-invite$/)
    await expect(page.getByRole('dialog', { name: 'External Link Warning' })).toHaveCount(0)
    await page.getByLabel('I have read and agree to the server rules').check()
    await page.getByRole('button', { name: 'Join server', exact: true }).click()
    await expect(page).toHaveURL(/\/servers/)
    expect(state.joinedInviteCodes).toEqual(['core-invite'])
    expect(await page.evaluate(() => (window as unknown as { __testOpenedUrls: string[] }).__testOpenedUrls)).toEqual([])
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

    await settingsModal.getByRole('button', { name: 'Desktop', exact: true }).click()
    await expect(settingsModal).toContainText('App updates')
    await expect(settingsModal).toContainText('Installed version: 0.2.0-desktop-test.')
    await expect(settingsModal).toContainText('Launch on startup')
    await expect(settingsModal).toContainText('Keep running in tray on close')

    await settingsModal.getByRole('button', { name: 'About Voxpery' }).click()
    await expect.poll(() => page.evaluate(() => (
      window as Window & { __testOpenedUrls: string[] }
    ).__testOpenedUrls)).toContain('https://voxpery.com/about')
    await expect(page).toHaveURL(/\/social$/)
  })
})
