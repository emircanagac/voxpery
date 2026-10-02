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
  for (const width of [1920, 390]) {
    test(`previews attachment drafts and exposes honest upload/retry states at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 1920 ? 1080 : 844 })
      const server = buildCoreServer()
      await installMockCoreApi(page, createMockCoreState({ servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) } }))
      const photo = await readFile(new URL('../public/pwa-192.png', import.meta.url))
      const archive = Buffer.concat([Buffer.from('PK\x05\x06'), Buffer.alloc(18)])
      let releaseUpload!: () => void
      const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve })
      let attempts = 0
      await page.route('**/api/attachments/upload', async route => {
        attempts += 1
        if (attempts === 1) {
          await uploadGate
          await route.fulfill({ json: [
            { id: 'photo-draft', name: 'photo.png', type: 'image/png', size: photo.length, url: '/draft-photo.png' },
            { id: 'zip-draft', name: 'notes.zip', type: 'application/zip', size: archive.length, url: '/draft-notes.zip' },
          ] })
        } else if (attempts === 2) {
          await route.fulfill({ status: 500, json: { error: 'Temporary upload failure' } })
        } else {
          await route.fulfill({ json: [{ id: 'zip-retry', name: 'notes.zip', type: 'application/zip', size: archive.length, url: '/draft-notes.zip' }] })
        }
      })
      // Unsent uploads may reject reads; the local preview must survive upload completion.
      await page.route('**/draft-photo.png', route => route.fulfill({ status: 403 }))
      await page.goto('/servers')
      const files = page.locator('.message-input-wrapper input[type="file"]')
      await files.setInputFiles([
        { name: 'photo.png', mimeType: 'image/png', buffer: photo },
        { name: 'notes.zip', mimeType: 'application/zip', buffer: archive },
      ])
      const image = page.getByAltText('Preview of photo.png')
      await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(192)
      await expect(page.getByRole('progressbar')).toHaveCount(2)
      await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
      await expect(page.getByRole('progressbar', { name: 'Uploading photo.png' })).not.toHaveAttribute('aria-valuenow')
      const previewHeight = await page.getByRole('group', { name: 'Attachment photo.png', exact: true }).evaluate(el => el.clientHeight)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(page.locator('.dm-draft-attachment-progress span').first()).toHaveCSS('animation-name', 'none')
      expect(await page.locator('.shell-layout').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`attachment-upload-${width}.png`) })
      releaseUpload()
      await expect(page.getByRole('progressbar')).toHaveCount(0)
      await expect(page.getByText('Ready to send', { exact: true })).toHaveCount(2)
      expect(await page.getByRole('group', { name: 'Attachment photo.png', exact: true }).evaluate(el => el.clientHeight)).toBe(previewHeight)
      await expect(image).toBeVisible()
      await expect(image).toHaveAttribute('src', /^blob:/)
      await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(192)
      await page.getByRole('button', { name: 'Remove attachment photo.png', exact: true }).click()
      await page.getByRole('button', { name: 'Remove attachment notes.zip', exact: true }).click()
      await files.setInputFiles({ name: 'notes.zip', mimeType: 'application/zip', buffer: archive })
      const retry = page.getByRole('button', { name: 'Retry upload of notes.zip', exact: true })
      await expect(retry).toBeVisible()
      await expect(page.getByRole('group', { name: 'Attachment notes.zip', exact: true }).getByText('Upload failed', { exact: true }).first()).toBeVisible()
      await retry.click()
      await expect(page.getByText('Ready to send', { exact: true })).toBeVisible()
      await expect(retry).toHaveCount(0)
      await page.getByRole('button', { name: 'Remove attachment notes.zip', exact: true }).click()
      await expect(page.locator('.dm-draft-attachment')).toHaveCount(0)
    })
  }

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
    await expect(page.getByRole('status').filter({ hasText: 'Download started' })).toBeVisible()
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
