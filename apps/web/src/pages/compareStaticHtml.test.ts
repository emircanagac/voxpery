import { describe, expect, it } from 'vitest'
import compareHtml from '../../compare.html?raw'
import indexHtml from '../../index.html?raw'
import landingHtml from '../../landing.html?raw'
import appSchema from '../seo/app-schema.json?raw'
import commonHead from '../seo/common-head.html?raw'
import { applySharedHtml, COMMON_HEAD_MARKER } from '../seo/sharedHtml'
import { advantages, comparison, MEASURED_ON } from './compareContent'

const RAW_ENTRIES: Record<string, string> = { 'index.html': indexHtml, 'landing.html': landingHtml, 'compare.html': compareHtml }

// Read each entry the way the build serves it (with the shared head and schema filled in).
function readEntry(name: string) {
  return new DOMParser().parseFromString(applySharedHtml(RAW_ENTRIES[name], { commonHead, appSchema }), 'text/html')
}

describe('static public page HTML', () => {
  it('keeps the compare fallback in step with the compare page content', () => {
    const doc = readEntry('compare.html')
    const rows = Array.from(doc.querySelectorAll('#root tbody tr')).map(row =>
      Array.from(row.children).map(cell => cell.textContent?.trim()),
    )
    expect(rows).toEqual(comparison.map(({ feature, voxpery, discord, element, zulip }) =>
      [feature, voxpery, discord, element, zulip]))

    const text = doc.querySelector('#root')?.textContent ?? ''
    for (const { title, text: body } of advantages) {
      expect(text).toContain(title)
      expect(text).toContain(body)
    }
    expect(text).toContain(MEASURED_ON)
  })

  it.each([
    ['landing.html', 'https://voxpery.com/'],
    ['compare.html', 'https://voxpery.com/compare'],
  ])('%s serves its own canonical address, a large preview and app schema', (name, canonical) => {
    const doc = readEntry(name)
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(canonical)
    expect(doc.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary_large_image')
    expect(doc.querySelector('#root h1')?.textContent).toBe('Voxpery')

    const schema = JSON.parse(doc.querySelector('script[type="application/ld+json"]')?.textContent ?? '')
    expect(schema).toMatchObject({ '@type': 'SoftwareApplication', name: 'Voxpery' })
  })

  it.each(Object.keys(RAW_ENTRIES))('%s gets the shared head from src/seo', (name) => {
    expect(RAW_ENTRIES[name]).toContain(COMMON_HEAD_MARKER)
    const doc = readEntry(name)
    expect(doc.querySelector('meta[charset]')?.getAttribute('charset')).toBe('UTF-8')
    expect(doc.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest')
    expect(doc.querySelector('script[src="/theme-init.js"]')).not.toBeNull()
    expect(doc.documentElement.outerHTML).not.toContain('voxpery:')
  })

  it('hides the landing text in the installed app, which also starts at /', () => {
    const style = readEntry('landing.html').querySelector('style')?.textContent ?? ''
    expect(style).toMatch(/@media \(display-mode:standalone\)[^{]*\{\.static-page\{display:none\}\}/)
  })

  it('hides the landing text for a visitor with a remembered profile (theme-init.js sets the hint)', () => {
    const style = readEntry('landing.html').querySelector('style')?.textContent ?? ''
    expect(style).toContain('html[data-session-hint] .static-page{display:none}')
  })
})
