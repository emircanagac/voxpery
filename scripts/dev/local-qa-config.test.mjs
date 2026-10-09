import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nativeUrl } from './local-qa-config.mjs'

test('native database and Redis clients use IPv4 WSL forwarding without changing credentials', () => {
  for (const host of ['localhost', 'postgres', 'redis']) {
    const result = new URL(nativeUrl(`postgresql://qa:p%40ss@${host}:5432/qa_tests?sslmode=disable`))
    assert.equal(result.hostname, '127.0.0.1')
    assert.equal(result.password, 'p%40ss')
    assert.equal(result.port, '5432')
    assert.equal(result.pathname, '/qa_tests')
    assert.equal(result.searchParams.get('sslmode'), 'disable')
  }
  assert.equal(nativeUrl('redis://localhost:6379/1'), 'redis://127.0.0.1:6379/1')
})

test('explicit loopback works and remote lookalikes remain forbidden', () => {
  assert.equal(nativeUrl('redis://[::1]:6379/1'), 'redis://[::1]:6379/1')
  for (const host of ['localhost.evil.test', 'postgres.example.com', '10.0.0.1']) {
    assert.throws(() => nativeUrl(`redis://${host}:6379/1`), /requires loopback/)
  }
})
