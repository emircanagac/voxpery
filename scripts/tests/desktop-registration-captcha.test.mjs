import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'

const { JSDOM } = createRequire(new URL('../../apps/web/package.json', import.meta.url))('jsdom')
const source = readFileSync(new URL('../../apps/server/src/routes/desktop_registration_captcha.js', import.meta.url), 'utf8')
const pages = []

function page() {
  const dom = new JSDOM('<form><div id="registration-captcha" data-sitekey="synthetic-key"></div><p id="registration-captcha-status"></p><button id="registration-captcha-retry" type="button" hidden>Retry</button><button type="submit" disabled>Create account</button></form>', { runScripts: 'outside-only' })
  pages.push(dom)
  let deadline
  dom.window.setTimeout = handler => { deadline = handler; return 1 }
  dom.window.clearTimeout = () => {}
  dom.window.eval(source)
  dom.window.dispatchEvent(new dom.window.Event('DOMContentLoaded'))
  return {
    dom,
    submit: dom.window.document.querySelector('button[type=submit]'),
    retry: dom.window.document.querySelector('#registration-captcha-retry'),
    status: dom.window.document.querySelector('#registration-captcha-status'),
    timeout: () => deadline(),
    script: () => dom.window.document.querySelector('script'),
  }
}

afterEach(() => { for (const dom of pages.splice(0)) dom.window.close() })

test('keeps registration disabled on script timeout and makes a new request on retry', () => {
  const p = page()
  assert.equal(p.script().src, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
  assert.equal(p.submit.disabled, true)
  const initial = p.script()
  p.timeout()
  assert.equal(p.status.getAttribute('role'), 'alert')
  assert.match(p.status.textContent, /timed out/)
  assert.equal(p.retry.hidden, false)
  assert.equal(initial.isConnected, false)
  p.retry.click()
  assert.notEqual(p.script(), initial)
  assert.equal(p.submit.disabled, true)
  p.script().dispatchEvent(new p.dom.window.Event('error'))
  assert.match(p.status.textContent, /could not be loaded/)
  assert.equal(p.submit.disabled, true)
})

test('requires provider success and ignores removed-widget callbacks after recovery', () => {
  const p = page()
  const callbacks = []
  const removed = []
  Object.assign(p.dom.window, { turnstile: {
    render: (_node, options) => { callbacks.push(options); return `widget-${callbacks.length}` },
    remove: widget => removed.push(widget),
  } })
  p.script().dispatchEvent(new p.dom.window.Event('load'))
  assert.equal(p.submit.disabled, true)
  callbacks[0].callback()
  assert.equal(p.submit.disabled, false)
  callbacks[0]['error-callback']()
  assert.equal(p.submit.disabled, true)
  assert.deepEqual(removed, ['widget-1'])
  p.retry.click()
  callbacks[1].callback()
  assert.equal(p.submit.disabled, false)
  for (const name of ['callback', 'expired-callback', 'error-callback', 'timeout-callback', 'unsupported-callback']) callbacks[0][name]()
  assert.equal(p.submit.disabled, false)
  assert.equal(p.retry.hidden, true)
  callbacks[1]['expired-callback']()
  assert.equal(p.submit.disabled, true)
})
