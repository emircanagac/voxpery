import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { nativeUrl } from './local-qa-config.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const env = { ...process.env, ...parseEnv(readFileSync(join(root, '.env'), 'utf8')) }
if (env.APP_ENV !== 'development') throw new Error('Local QA requires APP_ENV=development.')
env.SERVER_HOST = '127.0.0.1'

const database = env.DATABASE_URL || `postgresql://${encodeURIComponent(env.POSTGRES_USER || 'voxpery')}:${encodeURIComponent(env.POSTGRES_PASSWORD || '')}@localhost:5432/${encodeURIComponent(env.POSTGRES_DB || 'voxpery')}`
env.DATABASE_URL = nativeUrl(database)
env.REDIS_URL = nativeUrl(env.REDIS_URL || 'redis://localhost:6379')

const [command = 'init', ...args] = process.argv.slice(2)
let executable = 'cargo'
let cwd = join(root, 'apps/server')
let commandArgs
if (command === 'init') {
  console.log('Root .env loaded; local QA configuration is ready.')
  process.exit(0)
} else if (command === 'backend') {
  commandArgs = ['run', '--locked', ...args]
} else if (command === 'backend-test') {
  const testDb = new URL(env.DATABASE_URL)
  testDb.pathname = `${testDb.pathname}_tests`
  env.TEST_DATABASE_URL = nativeUrl(env.TEST_DATABASE_URL || testDb.toString())
  const testRedis = new URL(env.REDIS_URL)
  testRedis.pathname = '/1'
  env.TEST_REDIS_URL = nativeUrl(env.TEST_REDIS_URL || testRedis.toString())
  if (decodeURIComponent(new URL(env.TEST_DATABASE_URL).pathname) === decodeURIComponent(new URL(env.DATABASE_URL).pathname)) {
    throw new Error('Backend tests must use a separate database.')
  }
  const redisDatabase = value => Number(new URL(value).pathname.slice(1) || '0')
  if (redisDatabase(env.TEST_REDIS_URL) === redisDatabase(env.REDIS_URL)) {
    throw new Error('Backend tests must use a separate Redis database.')
  }
  commandArgs = ['test', '--locked', ...args]
} else if (command === 'frontend') {
  executable = process.execPath
  cwd = join(root, 'apps/web')
  commandArgs = [join(cwd, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', ...args]
} else if (command === 'desktop') {
  cwd = join(root, 'apps/desktop/src-tauri')
  commandArgs = ['tauri', 'dev', '--config', 'tauri.dev.conf.json', ...args]
} else {
  throw new Error('Choose init, backend, backend-test, frontend, or desktop.')
}

const child = spawn(executable, commandArgs, { cwd, env, stdio: 'inherit' })
child.on('error', () => { console.error('Local QA command could not start.'); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
