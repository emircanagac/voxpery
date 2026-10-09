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
