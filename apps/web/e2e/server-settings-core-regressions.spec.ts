import { expect, test, type Page } from '@playwright/test'
import {
  buildCoreAuditLog,
  buildCoreBans,
  buildCoreChannels,
  buildCoreMembers,
  buildCoreOnboardingGuide,
  buildCoreReports,
  buildCoreRoles,
  buildCoreRules,
  buildCoreServer,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

const server = buildCoreServer({
  id: 'server-settings-core',
  name: 'Settings Guild',
  invite_code: 'settings-guild',
})
const channels = buildCoreChannels(server.id)

function createServerSettingsState() {
  return createMockCoreState({
    servers: [server],
    channelsByServerId: { [server.id]: channels },
    membersByServerId: { [server.id]: buildCoreMembers() },
    serverRolesByServerId: { [server.id]: buildCoreRoles() },
    serverRulesByServerId: { [server.id]: buildCoreRules(server.id) },
    onboardingGuideByServerId: { [server.id]: buildCoreOnboardingGuide(server.id) },
    auditLogByServerId: { [server.id]: buildCoreAuditLog(server.id) },
    reportEntriesByServerId: { [server.id]: buildCoreReports(server.id) },
    banEntriesByServerId: { [server.id]: buildCoreBans() },
  })
}

async function openServerSettings(page: Page) {
  await page.goto('/servers')
  await page.getByTitle('Open server settings').click()
  await expect(page.getByRole('heading', { name: 'Server Settings' })).toBeVisible()
}

async function expectFlatSettings(modal: import('@playwright/test').Locator) {
  expect(await modal.evaluate(element => [element, ...element.querySelectorAll('*')].flatMap(node => {
    return ['', '::before', '::after'].map(pseudo => getComputedStyle(node, pseudo || null))
      .filter(style => /gradient\(/.test(style.backgroundImage) || style.backdropFilter !== 'none' || style.filter !== 'none')
      .map(() => node.className)
  }))).toEqual([])
}

test.describe('mocked server settings UI regressions', () => {
  test('contains server and channel dialog focus and restores the opener through nested confirmation', async ({ page }) => {
    await installMockCoreApi(page, createServerSettingsState())
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openServerSettings(page)
    const settings = page.getByRole('dialog', { name: 'Server Settings', exact: true })
    const close = settings.getByRole('button', { name: 'Close', exact: true })
    await expect(close).toBeFocused()
    await close.press('Shift+Tab')
    expect(await settings.evaluate(el => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    await expect(page.locator('#root')).toHaveAttribute('inert', '')
    await settings.getByPlaceholder('Server name').fill('Unsaved test name')
    await close.click()
    const confirm = page.getByRole('dialog', { name: 'Discard changes?', exact: true })
    await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await expect(settings.locator('..')).toHaveAttribute('inert', '')
    await page.keyboard.press('Escape')
    await expect(close).toBeFocused()
    await expect(settings.locator('..')).not.toHaveAttribute('inert')
    await close.click()
    await confirm.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page.getByTitle('Open server settings')).toBeFocused()
    await expect(page.locator('#root')).not.toHaveAttribute('inert')

    const create = page.getByRole('button', { name: 'Create channel in GENERAL', exact: true })
    await create.click()
    const dialog = page.getByRole('dialog', { name: 'Create Channel', exact: true })
    await expect(dialog.getByPlaceholder('e.g. general')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Create Channel', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(create).toBeFocused()
    const channel = page.locator('.channel-item', { hasText: channels[0].name }).first()
    await channel.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit Channel', exact: true })
    await expect(edit.getByPlaceholder('new-channel-name')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(edit.getByRole('button', { name: 'Save', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    expect(await page.locator('body').evaluate(el => document.activeElement !== el)).toBe(true)
    await expect(page.locator('#root')).not.toHaveAttribute('inert')
  })

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1024, height: 600 }]) {
    test(`keeps every server settings panel scrollable with long raid history at ${viewport.width}px`, async ({ page }, testInfo) => {
      const state = createServerSettingsState()
      state.raidEventEntriesByServerId[server.id] = Array.from({ length: 24 }, (_, index) => ({
        id: `raid-${index}`, server_id: server.id, event_type: 'message_burst', user_id: 'user-local', username: 'localuser',
        channel_id: channels[0].id, channel_name: channels[0].name, created_at: '2026-10-02T00:34:31Z', metadata: { message_count: 12 + index, window_seconds: 10, detail: 'Long metadata '.repeat(20) },
      }))
      await installMockCoreApi(page, state)
      await page.setViewportSize(viewport)
      await openServerSettings(page)
      const content = page.locator('.server-settings-content')
      const modal = page.locator('.modal-server-settings')
      const rect = (await modal.boundingBox())!
      for (const label of ['Overview', 'Roles', 'Community', 'Audit Log', 'Safety', 'Danger Zone']) {
        await page.locator('.server-settings-nav').getByRole('button', { name: label, exact: true }).click()
        await expect(content).toBeInViewport()
        await expectFlatSettings(modal)
        expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        expect((await modal.boundingBox())!.height).toBeCloseTo(rect.height, 2)
        for (const card of await content.locator(':scope > .server-settings-card').all()) {
          expect(await card.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
        }
      }
      await page.getByRole('button', { name: 'Safety', exact: true }).click()
      await expect(content.getByText('Loading reports...', { exact: true })).toHaveCount(0)
      await expect(content.locator('.server-report-row').filter({ hasText: 'Long metadata' })).toHaveCount(24)
      const last = content.locator('.server-report-row').last()
      await expect(last).toContainText('Long metadata')
      await expect.poll(() => content.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
      await content.hover()
      await page.mouse.wheel(0, 20000)
      await expect(last).toBeInViewport()
      expect(await last.evaluate(el => {
        const parent = el.closest('.server-settings-content')!.getBoundingClientRect()
        const rect = el.getBoundingClientRect()
        return rect.bottom <= parent.bottom && rect.top >= parent.top
      })).toBe(true)
      await page.screenshot({ path: testInfo.outputPath('raid-history-scroll.png') })
      for (const label of ['AutoMod', 'Bans', 'Reports']) {
        await page.getByRole('button', { name: label, exact: true }).click()
        expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await expectFlatSettings(modal)
      }
    })
  }

  test('does not report an unloaded role list as zero to a regular member', async ({ page }) => {
    const memberServer = buildCoreServer({ id: 'member-server', owner_id: 'someone-else' })
    const state = createMockCoreState({
      servers: [memberServer],
      channelsByServerId: { [memberServer.id]: buildCoreChannels(memberServer.id) },
      membersByServerId: { [memberServer.id]: buildCoreMembers() },
      serverPermissionsByServerId: { [memberServer.id]: 0 },
    })
    await installMockCoreApi(page, state)
    await page.goto('/servers')
    await page.getByTitle('Open server settings').click()
    await expect(page.getByRole('heading', { name: 'Server information' })).toBeVisible()
    await expect(page.getByText('Server roles are managed by the owner')).toBeVisible()
    await expect(page.getByText('0 roles configured')).toHaveCount(0)
  })

  test('keeps the member profile dialog aligned with the active theme', async ({ page }) => {
    const state = createServerSettingsState()
    const friend = state.membersByServerId[server.id]?.find((member) => member.user_id === 'friend-01')
    if (!friend) throw new Error('Missing profile fixture member')
    friend.about_me = 'Testing the profile theme surface.'
    friend.roles = ['Community member']
    await installMockCoreApi(page, state)
    await page.addInitScript(() => localStorage.setItem('voxpery-settings-theme', 'dark'))

    await page.goto('/servers')
    await page.locator('.member-item', { hasText: 'Friend 01' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'View profile (@Friend 01)' }).click()
    const profileDialog = page.getByRole('dialog', { name: 'Friend 01' })
    await expect(profileDialog).toBeVisible()

    const dark = await readMemberProfileThemeSnapshot(profileDialog)
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    const light = await readMemberProfileThemeSnapshot(profileDialog)

    expect(dark.popoutBackground).not.toBe(light.popoutBackground)
    expect(dark.sectionColor).not.toBe(light.sectionColor)
    expect(dark.sectionBorder).not.toBe(light.sectionBorder)
    expect(dark.badgeBackground).not.toBe(light.badgeBackground)
    expect(dark.popoutBorder).not.toBe(light.popoutBorder)
  })

  test('keeps server settings surfaces aligned with the active theme', async ({ page }) => {
    const state = createServerSettingsState()
    await installMockCoreApi(page, state)
    await page.addInitScript(() => localStorage.setItem('voxpery-settings-theme', 'dark'))

    await openServerSettings(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    const modal = page.locator('.modal-server-settings')
    const dark = await readSettingsThemeSnapshot(modal)
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    const light = await readSettingsThemeSnapshot(modal)

    expect(dark.overlayBackground).not.toBe(light.overlayBackground)
    expect(dark.modalBackground).not.toBe(light.modalBackground)
    expect(dark.navigationBackground).not.toBe(light.navigationBackground)
    expect(dark.activeNavigationBackground).not.toBe(light.activeNavigationBackground)
    expect(dark.inputBackground).not.toBe(light.inputBackground)
  })

  test('opens server settings and saves overview profile changes', async ({ page }) => {
    const state = createServerSettingsState()
    await installMockCoreApi(page, state)

    await openServerSettings(page)
    await page.getByPlaceholder('Server name').fill('Renamed Guild')
    await page.getByPlaceholder("What's this server about?").fill('A tested settings surface.')
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.locator('.server-settings-header__server-name')).toHaveText('Renamed Guild')
    expect(state.serverUpdateCount).toBe(1)
    expect(state.servers.find((item) => item.id === server.id)?.name).toBe('Renamed Guild')
    expect(state.servers.find((item) => item.id === server.id)?.description).toBe('A tested settings surface.')
  })

  test('creates, edits, and deletes roles from the Roles tab', async ({ page }) => {
    const state = createServerSettingsState()
    await installMockCoreApi(page, state)

    await openServerSettings(page)
    await page.getByRole('button', { name: 'Roles' }).click()
    await expect(page.getByText('2 roles')).toBeVisible()

    await page.getByRole('button', { name: 'Create role' }).first().click()
    await page.getByPlaceholder('Role name').fill('Event Host')
    await page.getByLabel('Manage messages').check()
    await page.locator('.server-role-btn-save').click()

    await expect(page.getByRole('button', { name: 'Event Host' })).toBeVisible()
    expect(state.serverRolesByServerId[server.id].some((role) => role.name === 'Event Host')).toBe(true)

    await page.getByRole('button', { name: 'Event Host' }).click()
    await page.getByPlaceholder('Role name').fill('Event Lead')
    await page.getByRole('button', { name: 'Save role' }).click()
    await expect(page.getByRole('button', { name: 'Event Lead' })).toBeVisible()

    await page.getByRole('button', { name: 'Event Lead' }).click()
    await page.getByRole('button', { name: 'Delete role' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByRole('button', { name: 'Event Lead' })).toBeHidden()
    expect(state.serverRolesByServerId[server.id].some((role) => role.name === 'Event Lead')).toBe(false)
  })

  test('keeps community, audit, and safety settings tabs wired to data', async ({ page }) => {
    const state = createServerSettingsState()
    state.auditLogByServerId[server.id].unshift({
      id: 'audit-voice-move',
      at: new Date(Date.UTC(2026, 0, 5, 10)).toISOString(),
      actor_id: 'user-local',
      server_id: server.id,
      action: 'voice_member_move',
      resource_type: 'member',
      resource_id: 'friend-01',
      channel_id: `${server.id}-voice-support`,
      reason: 'Moved after a warning',
      details: {
        source_channel_name: 'General',
        destination_channel_name: 'Support',
      },
      actor_username: 'localuser',
      resource_username: 'Friend 01',
      channel_name: 'Support',
    })
    await installMockCoreApi(page, state)

    await openServerSettings(page)
    await page.getByRole('button', { name: 'Community' }).click()
    await expect(page.getByRole('heading', { name: 'Welcome guide' })).toBeVisible()
    await expect(page.getByText('1 rules')).toBeVisible()

    await page.getByPlaceholder('Welcome to the community').fill('Welcome, testers')
    await page.getByPlaceholder('Tell new members where to start and what this server is for.').fill('Start in general.')
    await page.getByRole('button', { name: 'Save guide' }).click()
    expect(state.onboardingUpdateCount).toBe(1)
    expect(state.onboardingGuideByServerId[server.id].title).toBe('Welcome, testers')

    await page.getByPlaceholder('Add a new rule...').fill('Keep channels readable.')
    await page.getByRole('button', { name: 'Add rule' }).click()
    await expect(page.getByText('Keep channels readable.')).toBeVisible()
    expect(state.serverRulesByServerId[server.id].some((rule) => rule.rule_text === 'Keep channels readable.')).toBe(true)

    await page.getByRole('button', { name: 'Audit Log' }).click()
    await expect(page.getByText('Updated server settings')).toBeVisible()
    await expect(page.getByText('from General to Support')).toBeVisible()
    await expect(page.getByText('Moved after a warning')).toBeVisible()
    await page.getByLabel('Filter audit log by action').selectOption('voice_member_move')
    await expect(page.getByText('Updated server settings')).toBeHidden()
    await expect(page.getByText('from General to Support')).toBeVisible()
    await page.getByLabel('Filter audit log by action').selectOption('')
    await expect(page.getByText('Updated server settings')).toBeVisible()

    await page.getByRole('button', { name: 'Safety' }).click()
    await expect(page.getByText('Message report: Friend 01')).toBeVisible()
    await page.getByRole('button', { name: 'Resolve' }).click()
    await expect(page.getByText('Resolved', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Bans' }).click()
    await expect(page.getByText('Banned User', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Unban' }).click()
    await expect(page.getByText('Banned User', { exact: true })).toBeHidden()
  })
})

async function readSettingsThemeSnapshot(modal: import('@playwright/test').Locator) {
  return modal.evaluate((element) => {
    const styleOf = (selector: string) => {
      const target = element.querySelector(selector)
      if (!target) throw new Error(`Missing settings theme target: ${selector}`)
      return getComputedStyle(target)
    }

    return {
      overlayBackground: getComputedStyle(element.parentElement ?? element).backgroundColor,
      modalBackground: getComputedStyle(element).backgroundColor,
      navigationBackground: styleOf('.server-settings-nav').background,
      activeNavigationBackground: styleOf('.server-settings-nav__item--active').background,
      inputBackground: styleOf('input:not([type="checkbox"]):not([type="color"])').backgroundColor,
    }
  })
}

async function readMemberProfileThemeSnapshot(popout: import('@playwright/test').Locator) {
  return popout.evaluate((element) => {
    const section = element.querySelector('.member-profile-section')
    const badge = element.querySelector('.member-profile-badge')
    if (!section || !badge) throw new Error('Missing member profile theme target')

    const popoutStyle = getComputedStyle(element)
    return {
      popoutBackground: popoutStyle.background,
      popoutBorder: popoutStyle.borderColor,
      sectionColor: getComputedStyle(section).color,
      sectionBorder: getComputedStyle(section).borderTopColor,
      badgeBackground: getComputedStyle(badge).background,
    }
  })
}
