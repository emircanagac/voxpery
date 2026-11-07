import { describe, expect, it } from 'vitest'
import compareHtml from '../../compare.html?raw'
import landingHtml from '../../landing.html?raw'
import { advantages, comparison, MEASURED_ON } from './compareContent'

const ENTRIES: Record<string, string> = { 'landing.html': landingHtml, 'compare.html': compareHtml }

function readEntry(name: string) {
  return new DOMParser().parseFromString(ENTRIES[name], 'text/html')
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

  it('hides the landing text in the installed app, which also starts at /', () => {
    const style = readEntry('landing.html').querySelector('style')?.textContent ?? ''
    expect(style).toMatch(/@media \(display-mode:standalone\)[^{]*\{\.static-page\{display:none\}\}/)
  })
})
