import { expect, test, type Page } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

type Box = { top: number; bottom: number; left: number; right: number }

// Builds the voice stage with the app's real stage CSS, the way VoiceStage renders it: a
// "Stream available" or hidden-camera tile followed by participant tiles.
async function mountStage(page: Page, kind: 'stream' | 'camera', participants: number) {
  return page.evaluate(({ kind, participants }) => {
    document.querySelector('#stage-fixture')?.remove()
    const stage = document.createElement('div')
    stage.id = 'stage-fixture'
    stage.className = 'screen-share-stage'
    stage.style.gridTemplateColumns = 'repeat(1, minmax(0, 1fr))'
    const media = document.createElement('div')
    media.className = `voice-stage-hidden-media-tile${kind === 'stream' ? ' voice-stage-share-tile' : ''}`
    media.innerHTML = [
      '<span class="voice-stage-media-avatar"><span>S</span></span>',
      `<div class="voice-stage-hidden-media-title">${kind === 'stream' ? 'Stream available' : 'Camera hidden'}</div>`,
      '<div class="voice-stage-hidden-media-sub">semody</div>',
      kind === 'stream'
        ? '<div class="screen-share-viewers"><span class="screen-share-viewers-label">Watching</span><div class="screen-share-viewers-avatars"><span>C</span></div></div>'
        : '',
      `<button type="button" class="voice-stage-hidden-media-show">${kind === 'stream' ? 'Watch stream' : 'Show camera'}</button>`,
    ].join('')
    stage.append(media)
    for (let index = 0; index < participants; index += 1) {
      const tile = document.createElement('div')
      tile.className = 'voice-stage-tile'
      tile.innerHTML = `<div class="voice-stage-avatar">U</div><div class="voice-stage-name">User ${index + 1}</div><div class="voice-stage-sub">In voice</div>`
      stage.append(tile)
    }
    document.body.append(stage)

    const box = (element: Element): { top: number; bottom: number; left: number; right: number } => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
    }
    return {
      tile: box(media),
      children: [...media.children].map(box),
      next: stage.children[1] ? box(stage.children[1]) : null,
    }
  }, { kind, participants })
}

const inside = (inner: Box, outer: Box) => (
  inner.top >= outer.top - 0.5
  && inner.bottom <= outer.bottom + 0.5
  && inner.left >= outer.left - 0.5
  && inner.right <= outer.right + 0.5
)

test.describe('voice stage media tiles on phones', () => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 320, height: 568 }]) {
    for (const kind of ['stream', 'camera'] as const) {
      for (const participants of [2, 5]) {
        test(`keeps the ${kind} tile content inside at ${viewport.width}x${viewport.height} with ${participants} others`, async ({ page }) => {
          await page.setViewportSize(viewport)
          await installMockCoreApi(page, createMockCoreState())
          await page.goto('/social')
          await expect(page.locator('body')).toBeVisible()

          const layout = await mountStage(page, kind, participants)
          for (const child of layout.children) {
            expect(inside(child, layout.tile), JSON.stringify({ child, tile: layout.tile })).toBe(true)
          }
          // The next tile starts below this one instead of under its button.
          expect(layout.next!.top).toBeGreaterThanOrEqual(layout.tile.bottom - 0.5)
        })
      }
    }
  }
})
