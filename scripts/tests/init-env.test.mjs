import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = path.join(rootDir, 'scripts', 'ops', 'init_env.sh')

function runInitEnv(args) {
  const dir = mkdtempSync(path.join(tmpdir(), 'voxpery-init-env-'))
  const output = path.join(dir, 'generated.env')
  const result = spawnSync('bash', [script, '--output', output, ...args], { encoding: 'utf8' })
  return {
    dir,
    output,
    result,
    read: () => readFileSync(output, 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function activeValues(text) {
  const values = new Map()
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (match) values.set(match[1], match[2])
  }
  return values
}

const SECRET_KEYS = ['POSTGRES_PASSWORD', 'POSTGRES_APP_PASSWORD', 'LIVEKIT_API_SECRET', 'JWT_SECRET']

test('fills every active placeholder with its own secret and keeps local defaults', () => {
  const run = runInitEnv([])
  try {
    assert.equal(run.result.status, 0, run.result.stderr)
    const text = run.read()
    const values = activeValues(text)
    const secrets = SECRET_KEYS.map((key) => values.get(key))
    for (const secret of secrets) assert.match(secret, /^[0-9a-f]{64}$/)
    assert.equal(new Set(secrets).size, SECRET_KEYS.length, 'secrets must differ')
    for (const [key, value] of values) {
      assert.ok(!value.includes('CHANGE_ME'), `${key} still has a placeholder`)
    }
    assert.equal(values.get('VITE_API_URL'), 'http://localhost:3001')
    assert.equal(values.get('COOKIE_SECURE'), '0')
    assert.ok(!values.has('PROXY_WEB_DOMAIN'))
    assert.ok(!text.includes('\r'), 'the generated file uses LF line endings')
  } finally {
    run.cleanup()
  }
})

test('writes the production values for the bundled HTTPS proxy', () => {
  const run = runInitEnv([
    '--web-domain', 'chat.example.com',
    '--api-domain', 'api.example.com',
    '--livekit-domain', 'livekit.example.com',
    '--node-ip', '203.0.113.10',
    '--image-tag', 'v9.9.9',
  ])
  try {
    assert.equal(run.result.status, 0, run.result.stderr)
    const values = activeValues(run.read())
    assert.equal(values.get('APP_ENV'), 'production')
    assert.match(values.get('LIVEKIT_API_KEY'), /^voxpery[0-9a-f]{12}$/)
    assert.equal(values.get('PUBLIC_API_URL'), 'https://api.example.com')
    assert.equal(values.get('VITE_API_URL'), 'https://api.example.com')
    assert.equal(values.get('WEB_API_URL'), 'https://api.example.com')
    assert.equal(values.get('ATTACHMENTS_PUBLIC_BASE_URL'), 'https://api.example.com')
    assert.equal(values.get('FRONTEND_URL'), 'https://chat.example.com')
    assert.equal(values.get('CORS_ORIGINS'), 'https://chat.example.com,tauri://localhost,voxpery://auth')
    assert.equal(values.get('COOKIE_SECURE'), '1')
    assert.equal(values.get('LIVEKIT_WS_URL'), 'wss://livekit.example.com')
    assert.equal(values.get('WEB_LIVEKIT_URL'), 'wss://livekit.example.com')
    assert.equal(values.get('PROXY_WEB_DOMAIN'), 'chat.example.com')
    assert.equal(values.get('PROXY_API_DOMAIN'), 'api.example.com')
    assert.equal(values.get('PROXY_LIVEKIT_DOMAIN'), 'livekit.example.com')
    assert.equal(values.get('LIVEKIT_NODE_IP'), '203.0.113.10')
    assert.equal(values.get('VOXPERY_SERVER_IMAGE'), 'voxpery/voxpery-server:v9.9.9')
    assert.equal(values.get('VOXPERY_WEB_IMAGE'), 'voxpery/voxpery-web:v9.9.9')
    assert.match(run.result.stdout, /docker-compose\.proxy\.yml up -d --no-build/)
  } finally {
    run.cleanup()
  }
})

test('defaults the image tag to the version of this checkout', () => {
  const version = JSON.parse(readFileSync(path.join(rootDir, 'apps', 'web', 'package.json'), 'utf8')).version
  const run = runInitEnv([
    '--web-domain', 'chat.example.com',
    '--api-domain', 'api.example.com',
    '--livekit-domain', 'livekit.example.com',
  ])
  try {
    assert.equal(run.result.status, 0, run.result.stderr)
    assert.equal(activeValues(run.read()).get('VOXPERY_SERVER_IMAGE'), `voxpery/voxpery-server:v${version}`)
  } finally {
    run.cleanup()
  }
})

test('never changes an existing file', () => {
  const run = runInitEnv([])
  try {
    writeFileSync(run.output, 'JWT_SECRET=keep-me\n')
    const second = spawnSync('bash', [script, '--output', run.output], { encoding: 'utf8' })
    assert.notEqual(second.status, 0)
    assert.match(second.stderr, /already exists/)
    assert.equal(run.read(), 'JWT_SECRET=keep-me\n')
  } finally {
    run.cleanup()
  }
})

test('rejects incomplete or malformed domains', () => {
  for (const args of [
    ['--web-domain', 'chat.example.com'],
    ['--web-domain', 'https://chat.example.com', '--api-domain', 'api.example.com', '--livekit-domain', 'livekit.example.com'],
    ['--web-domain', 'example.com', '--api-domain', 'example.com', '--livekit-domain', 'livekit.example.com'],
    ['--web-domain', 'chat.example.com', '--api-domain', 'api.example.com', '--livekit-domain', 'livekit.example.com', '--node-ip', 'not-an-ip'],
  ]) {
    const run = runInitEnv(args)
    try {
      assert.notEqual(run.result.status, 0, args.join(' '))
      assert.throws(() => run.read(), undefined, 'no file is written on a rejected run')
    } finally {
      run.cleanup()
    }
  }
})
