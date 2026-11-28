import { expect, test, type Page } from '@playwright/test'
import type { CSSProperties } from 'react'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'
import { fitStageGrid, stageGridStyle, type StageBox } from '../src/components/voiceStageLayout'

type Box = { top: number; bottom: number; left: number; right: number }
type Kind = 'stream' | 'camera'

// Builds the voice stage with the app's real stage CSS, the way VoiceStage renders it: a
// "Stream available" (optionally with its "Watching" row) or hidden-camera tile followed by
// participant tiles. Before the stage is measured the grid uses equal cells; returns the box the
// app would measure.
async function buildStage(page: Page, kind: Kind, watching: boolean, participants: number): Promise<StageBox> {
  return page.evaluate(({ kind, watching, participants }) => {
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
      kind === 'stream' && watching
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

    // Same measurement as useStageBox.
    const style = getComputedStyle(stage)
    const px = (value: string) => parseFloat(value) || 0
    return {
      width: stage.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
      height: stage.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
      gap: px(style.columnGap),
    }
  }, { kind, watching, participants })
}

// Applies the inline grid style the app sets once the stage is measured (or keeps the fallback)
// and reports where the media tile, its content and the next tile ended up.
async function layoutStage(page: Page, style: CSSProperties | null) {
  return page.evaluate((style) => {
    const stage = document.querySelector<HTMLElement>('#stage-fixture')!
    // React sets custom properties (--stage-row-min) with setProperty; so does this.
    for (const [key, value] of Object.entries(style ?? {})) {
      if (key.startsWith('--')) stage.style.setProperty(key, String(value))
      else (stage.style as unknown as Record<string, string>)[key] = String(value)
    }
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
    }
    const media = stage.children[0]
    return {
      tile: box(media),
      children: [...media.children].map(box),
      next: stage.children[1] ? box(stage.children[1]) : null,
    }
  }, style as Record<string, string> | null)
}

const inside = (inner: Box, outer: Box) => (
  inner.top >= outer.top - 0.5
  && inner.bottom <= outer.bottom + 0.5
  && inner.left >= outer.left - 0.5
  && inner.right <= outer.right + 0.5
)

const cases: Array<{ kind: Kind, watching: boolean }> = [
  { kind: 'stream', watching: true },
  { kind: 'stream', watching: false },
  { kind: 'camera', watching: false },
]

test.describe('voice stage media tiles on phones', () => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 320, height: 568 }]) {
    for (const { kind, watching } of cases) {
      for (const participants of [2, 5]) {
        for (const measured of [false, true]) {
          const label = `${kind}${watching ? ' with watchers' : ''}, ${measured ? 'measured' : 'unmeasured'} stage`
          test(`keeps the ${label} tile content inside at ${viewport.width}x${viewport.height} with ${participants} others`, async ({ page }) => {
            await page.setViewportSize(viewport)
            await installMockCoreApi(page, createMockCoreState())
            await page.goto('/social')
            await expect(page.locator('body')).toBeVisible()

            const box = await buildStage(page, kind, watching, participants)
            // The phone stage as ActiveCallBar sizes it: 140px minimum tile width.
            const fit = measured ? fitStageGrid(1 + participants, box, 140) : null
            if (measured) expect(fit, JSON.stringify(box)).not.toBeNull()
            const layout = await layoutStage(page, fit ? stageGridStyle(fit, true) : null)
            for (const child of layout.children) {
              expect(inside(child, layout.tile), JSON.stringify({ child, tile: layout.tile })).toBe(true)
            }
            // The next tile sits beside or below this one, never under its button.
            const next = layout.next!
            expect(
              next.left >= layout.tile.right - 0.5 || next.top >= layout.tile.bottom - 0.5,
              JSON.stringify({ next, tile: layout.tile }),
            ).toBe(true)
          })
        }
      }
    }
  }
})
