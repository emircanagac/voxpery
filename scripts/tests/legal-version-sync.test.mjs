import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('published legal pages show the version the server enforces', () => {
  const server = read('apps/server/src/services/privacy.rs')
  const web = read('apps/web/src/legal.ts')
  const published = web.match(/PUBLISHED_LEGAL_VERSION = '([^']+)'/)?.[1]
  assert.ok(published, 'PUBLISHED_LEGAL_VERSION is missing')
  for (const name of ['CURRENT_TERMS_VERSION', 'CURRENT_PRIVACY_NOTICE_VERSION', 'CURRENT_KVKK_NOTICE_VERSION']) {
    const version = server.match(new RegExp(`${name}: &str = "([^"]+)"`))?.[1]
    assert.equal(version, published, `${name} must match the published legal pages`)
  }
})

// The docs copies are what reviewers and self-hosters read; they must say exactly what the page says.
test('docs copies of the legal pages match the published text', () => {
  const page = read('apps/web/src/pages/LegalPage.tsx')
  const contact = page.match(/const CONTACT = '([^']+)'/)?.[1]
  const plain = text => text
    .replace(/<a href=\{`mailto:\$\{CONTACT\}`\}>\{CONTACT\}<\/a>/g, contact)
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [fn, doc] of [
    ['EnglishPrivacyNotice', 'docs/PRIVACY_NOTICE.md'],
    ['TermsOfService', 'docs/TERMS_OF_SERVICE.md'],
    ['KvkkNotice', 'docs/KVKK_AYDINLATMA_METNI.md'],
  ]) {
    const start = page.indexOf(`function ${fn}() {`)
    const body = start >= 0 ? page.slice(start, page.indexOf('\n}\n', start)) : ''
    assert.ok(body, `${fn} is missing`)
    const docText = plain(read(doc))
    const blocks = [...body.matchAll(/<(h1|h2|p|li)>([\s\S]*?)<\/\1>/g)]
      .map(match => plain(match[2]))
      .filter(text => !text.includes('PUBLISHED_LEGAL_VERSION'))
    assert.ok(blocks.length > 5, `${fn} has no text blocks`)
    for (const block of blocks) assert.ok(docText.includes(block), `${doc} is missing: ${block.slice(0, 80)}`)
  }
})
