import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classify, diffBase } from './ci-changes.mjs'

const none = { backend: false, frontend: false, desktop: false }
const all = { backend: true, frontend: true, desktop: true }

test('documentation-only changes skip build checks', () => {
  assert.deepEqual(classify(['docs/API.md', 'README.md', '.github/PULL_REQUEST_TEMPLATE.md', 'LICENSE']), none)
})

test('the CI workflow runs every check', () => {
  assert.deepEqual(classify(['.github/workflows/ci.yml']), all)
})

test('server changes run backend only unless frontend scripts read the file', () => {
  assert.deepEqual(classify(['apps/server/src/routes/auth.rs']), { ...none, backend: true })
  assert.deepEqual(classify(['apps/server/src/services/privacy.rs']), { ...none, backend: true, frontend: true })
  assert.deepEqual(classify(['apps/server/src/routes/desktop_registration_captcha.js']), { ...none, backend: true, frontend: true })
})

test('desktop changes run desktop, plus frontend for validated config and launchers', () => {
  assert.deepEqual(classify(['apps/desktop/src-tauri/src/main.rs']), { ...none, desktop: true })
  assert.deepEqual(classify(['apps/desktop/src-tauri/tauri.conf.json']), { ...none, desktop: true, frontend: true })
  assert.deepEqual(classify(['apps/desktop/src-tauri/linux/com.voxpery.desktop']), { ...none, desktop: true, frontend: true })
  assert.deepEqual(classify(['.github/scripts/validate-linux-launchers.mjs']), { ...none, desktop: true, frontend: true })
})

test('web and unknown paths run frontend', () => {
  assert.deepEqual(classify(['apps/web/src/App.tsx']), { ...none, frontend: true })
  assert.deepEqual(classify(['docker-compose.yml']), { ...none, frontend: true })
  assert.deepEqual(classify(['.github/workflows/deploy.yml']), { ...none, frontend: true })
})

test('tags, manual runs and new branches have no base and run everything', () => {
  assert.equal(diffBase({ eventName: 'push', ref: 'refs/tags/v0.3.1', pushBefore: 'abc' }), null)
  assert.equal(diffBase({ eventName: 'workflow_dispatch', ref: 'refs/heads/main' }), null)
  assert.equal(diffBase({ eventName: 'push', ref: 'refs/heads/main', pushBefore: '0'.repeat(40) }), null)
  assert.equal(diffBase({ eventName: 'push', ref: 'refs/heads/main', pushBefore: 'abc' }), 'abc')
  assert.equal(diffBase({ eventName: 'pull_request', ref: 'refs/pull/1/merge', pullRequestBase: 'def' }), 'def')
})
