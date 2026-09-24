import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  buildCoreChannels,
  buildCoreServer,
  buildServerMessage,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

test.describe('attachment and server-switch release regressions', () => {
  test('downloads a ZIP attachment when its chat link is clicked', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const archive = Buffer.concat([Buffer.from('PK\x05\x06'), Buffer.alloc(18)])
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      messagesByChannelId: {
        [channels[0].id]: [buildServerMessage(channels[0].id, 'Archive attached', {
          attachments: [{
            url: 'http://localhost:3001/api/attachments/content/archive?exp=4102444800&sig=test',
            name: 'notes.zip',
            type: 'application/zip',
          }],
        })],
      },
    })
    await installMockCoreApi(page, state)
    await page.route(/\/api\/attachments\/content\/archive(?:\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/zip',
        headers: { 'content-disposition': 'attachment; filename="notes.zip"' },
        body: archive,
      })
    })

    await page.goto('/servers')
    const link = page.getByRole('link', { name: 'notes.zip' })
    await expect(link).toHaveAttribute('download', 'notes.zip')
    await expect(link).toHaveAttribute('href', /\/api\/attachments\/content\/archive\?/)
    const downloadPromise = page.waitForEvent('download')
    await link.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('notes.zip')
    expect(Buffer.compare(await readFile(await download.path()), archive)).toBe(0)
  })

  test('never paints the previous server categories after a switch', async ({ page }) => {
    const first = buildCoreServer({ id: 'server-a', name: 'First Guild' })
    const second = buildCoreServer({ id: 'server-b', name: 'Second Guild' })
    const firstChannels = buildCoreChannels(first.id).map((channel) => ({ ...channel, category: 'ALPHA ONLY' }))
    const secondChannels = buildCoreChannels(second.id).map((channel) => ({ ...channel, category: 'BETA ONLY' }))
    const state = createMockCoreState({
      servers: [first, second],
      channelsByServerId: {
        [first.id]: firstChannels,
        [second.id]: secondChannels,
      },
    })
    await installMockCoreApi(page, state)
    await page.route('**/api/channels/server/server-b/categories', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      await route.fallback()
    })

    await page.goto('/servers')
    await expect(page.locator('.channel-header-title')).toHaveText('First Guild')
    await expect(page.getByRole('button', { name: 'ALPHA ONLY', exact: true })).toBeVisible()
    await page.evaluate(() => {
      const sidebar = document.querySelector('.channel-sidebar')
      const samples: string[] = []
      if (!sidebar) throw new Error('Channel sidebar was not mounted')
      const observer = new MutationObserver(() => {
        if (sidebar.querySelector('.channel-header-title')?.textContent === 'Second Guild') {
          samples.push(sidebar.querySelector('.channel-list')?.textContent ?? '')
        }
      })
      observer.observe(sidebar, { childList: true, subtree: true, characterData: true })
      Object.assign(window, { __serverSwitchSamples: samples })
    })

    await page.getByRole('button', { name: 'Second Guild' }).click()
    await expect(page.locator('.channel-header-title')).toHaveText('Second Guild')
    await expect(page.getByRole('button', { name: 'BETA ONLY', exact: true })).toBeVisible()
    const samples = await page.evaluate(() => (window as Window & { __serverSwitchSamples: string[] }).__serverSwitchSamples)
    expect(samples.some((sample) => sample.includes('ALPHA ONLY'))).toBe(false)
    await expect(page.locator('.channel-list')).not.toContainText('ALPHA ONLY')

    await page.evaluate(() => {
      const sidebar = document.querySelector('.channel-sidebar')
      const samples: string[] = []
      if (!sidebar) throw new Error('Channel sidebar was not mounted')
      const observer = new MutationObserver(() => {
        if (sidebar.querySelector('.channel-header-title')?.textContent === 'First Guild') {
          samples.push(sidebar.querySelector('.channel-list')?.textContent ?? '')
        }
      })
      observer.observe(sidebar, { childList: true, subtree: true, characterData: true })
      Object.assign(window, { __serverReturnSamples: samples })
    })
    await page.getByRole('button', { name: 'First Guild' }).click()
    await expect(page.locator('.channel-header-title')).toHaveText('First Guild')
    await expect(page.getByRole('button', { name: 'ALPHA ONLY', exact: true })).toBeVisible()
    const returnSamples = await page.evaluate(() => (window as Window & { __serverReturnSamples: string[] }).__serverReturnSamples)
    expect(returnSamples.some((sample) => sample.includes('BETA ONLY'))).toBe(false)
  })
})
