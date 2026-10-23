import { expect, test, type Page } from '@playwright/test'
import { createMockCoreState, installMockCoreApi } from './mock-core-api'

type Rect = { left: number; top: number; right: number; bottom: number }

// Builds the focus view with the app's real stage CSS and layout helpers, the same way
// ActiveCallBar does: a focused 1920x1080 stream, the participant strip, "+N" and the toggle.
async function mountFocusView(page: Page, tiles: number, stripVisible: boolean, mobile: boolean) {
  return page.evaluate(async ({ tiles, stripVisible, mobile }) => {
    const path = '/src/components/voiceStageLayout.ts'
    const layout = await import(path)
    document.querySelector('#focus-view-fixture')?.remove()
    const stage = document.createElement('div')
    stage.id = 'focus-view-fixture'
    stage.className = `screen-share-stage screen-share-stage--theater${stripVisible ? ' screen-share-stage--strip' : ''}`
    document.body.append(stage)

    const style = getComputedStyle(stage)
    const px = (value: string) => parseFloat(value) || 0
    const box = {
      width: stage.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
      height: stage.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
      gap: px(style.columnGap),
    }
    const strip = mobile ? layout.THEATER_STRIP_TILE_MOBILE : layout.THEATER_STRIP_TILE
    const fit = layout.fitStageGrid(1, stripVisible ? { ...box, height: box.height - strip.height - box.gap } : box, mobile ? 140 : 180, 1920 / 1080)
    stage.style.setProperty('--stage-tile-width', `${fit.tileWidth}px`)
    stage.style.setProperty('--stage-tile-height', `${fit.tileHeight}px`)
    stage.style.setProperty('--stage-tile-aspect', `${fit.tileWidth} / ${fit.tileHeight}`)

    const focused = document.createElement('div')
    focused.className = 'screen-share-preview voice-stage-share-tile is-theater-focused'
    focused.innerHTML = '<div class="screen-share-controls-bar"><div class="screen-share-controls-right"><button type="button" class="screen-share-controls-btn" aria-label="Enter fullscreen">F</button></div></div>'
    stage.append(focused)
    const shown = stripVisible ? layout.stripVisibleCount(tiles, box.width, strip.width, box.gap) : tiles
    for (let index = 0; index < tiles; index += 1) {
      const tile = document.createElement('div')
      tile.className = 'voice-stage-tile'
      tile.textContent = `User ${index + 1}`
      if (stripVisible && index >= shown) tile.setAttribute('data-strip-overflow', '')
      stage.append(tile)
    }
    if (stripVisible && shown < tiles) {
      const more = document.createElement('button')
      more.className = 'screen-share-strip-more'
      more.textContent = `+${tiles - shown}`
      stage.append(more)
    }
    const toggle = document.createElement('button')
    toggle.className = 'screen-share-strip-toggle'
    toggle.setAttribute('aria-label', stripVisible ? 'Hide participants' : 'Show participants')
    stage.append(toggle)

    const rect = (element: Element) => {
      const r = element.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }
    const visible = Array.from(stage.querySelectorAll('.voice-stage-tile:not([data-strip-overflow]), .screen-share-strip-more'))
    return {
      gap: box.gap,
      scrolls: stage.scrollHeight > stage.clientHeight + 1,
      stage: rect(stage),
      focused: rect(focused),
      fullscreen: rect(focused.querySelector('.screen-share-controls-btn')!),
      toggle: rect(toggle),
      strip: visible.map(rect),
      more: stage.querySelector('.screen-share-strip-more')?.textContent ?? null,
    }
  }, { tiles, stripVisible, mobile })
}

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

test.describe('voice focus view', () => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1784, height: 1000 }, { width: 1366, height: 768 }, { width: 960, height: 720 }, { width: 390, height: 844 }]) {
    test(`fits the focused stream, one strip line and the toggle at ${viewport.width}x${viewport.height}`, { tag: '@core' }, async ({ page }) => {
      await installMockCoreApi(page, createMockCoreState())
      await page.setViewportSize(viewport)
      await page.goto('/social')
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
      const mobile = viewport.width < 960

      for (const tiles of [3, 30]) {
        const view = await mountFocusView(page, tiles, true, mobile)
        expect(view.scrolls, `${tiles} tiles must not scroll`).toBe(false)
        const tops = new Set(view.strip.map((tile) => Math.round(tile.top)))
        expect(tops.size, 'the strip is a single line').toBe(1)
        expect(Math.round(view.strip[0].top - view.focused.bottom)).toBe(Math.round(view.gap))
        expect(view.strip.every((tile) => tile.bottom <= view.stage.bottom)).toBe(true)
        for (const tile of view.strip) expect(overlaps(view.toggle, tile)).toBe(false)
        expect(overlaps(view.toggle, view.focused)).toBe(false)
        // Every participant is either a visible tile or counted in "+N".
        const hiddenCount = view.more ? Number(view.more.slice(1)) : 0
        expect(view.strip.length - (view.more ? 1 : 0) + hiddenCount).toBe(tiles)
        if (tiles === 30) expect(view.more).toMatch(/^\+\d+$/)
      }

      const hidden = await mountFocusView(page, 3, false, mobile)
      expect(hidden.scrolls).toBe(false)
      expect(overlaps(hidden.toggle, hidden.focused)).toBe(false)
      expect(overlaps(hidden.toggle, hidden.fullscreen)).toBe(false)
    })
  }
})
