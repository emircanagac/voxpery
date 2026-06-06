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

test.describe('mocked server settings UI regressions', () => {
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
