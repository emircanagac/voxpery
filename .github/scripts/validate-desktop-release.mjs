import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = process.cwd()

const failures = []

function fail(message) {
  failures.push(message)
}

function loadJson(relativePath) {
  const full = resolve(repoRoot, relativePath)
  if (!existsSync(full)) {
    fail(`Missing required file: ${relativePath}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(full, 'utf8'))
  } catch (err) {
    fail(`Invalid JSON in ${relativePath}: ${String(err)}`)
    return null
  }
}

function requireFile(relativePath, minBytes = 1) {
  const full = resolve(repoRoot, relativePath)
  if (!existsSync(full)) {
    fail(`Missing required file: ${relativePath}`)
    return
  }
  const size = statSync(full).size
  if (size < minBytes) {
    fail(`File too small: ${relativePath} (${size} bytes, expected >= ${minBytes})`)
  }
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out)
  }
  return out
}

function includesLocalBackendTarget(value) {
  return /(^|[^a-z0-9.-])(localhost|127\.0\.0\.1)(?::|\/|\*|$)/i.test(value)
}

function requireNoLocalTargets(label, value) {
  const offenders = collectStrings(value).filter(includesLocalBackendTarget)
  for (const offender of offenders) {
    fail(`${label} must not include local backend target in release config: ${offender}`)
  }
}

function requireCspSource(csp, directive, source) {
  const value = csp?.[directive]
  const sources = typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
  if (!sources.includes(source)) {
    fail(`tauri.conf.json app.security.csp ${directive} must include ${source}`)
  }
}

const tauri = loadJson('apps/desktop/src-tauri/tauri.conf.json')
const cargoToml = existsSync(resolve(repoRoot, 'apps/desktop/src-tauri/Cargo.toml'))
  ? readFileSync(resolve(repoRoot, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8')
  : ''
const cargoVersionMatch = cargoToml.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)
const cargoVersion = cargoVersionMatch?.[1] ?? null
if (tauri) {
  if (tauri.productName !== 'Voxpery') {
    fail(`tauri.conf.json productName must be "Voxpery" (found: ${String(tauri.productName)})`)
  }
  if (tauri.identifier !== 'com.voxpery') {
    fail(`tauri.conf.json identifier must be "com.voxpery" (found: ${String(tauri.identifier)})`)
  }
  if (!cargoVersion) {
    fail('Cargo.toml package version could not be read for desktop release validation')
  } else if (tauri.version !== cargoVersion) {
    fail(
      `Desktop version mismatch: tauri.conf.json has ${String(tauri.version)} but Cargo.toml has ${cargoVersion}`
    )
  }

  const icons = tauri.bundle?.icon
  if (!Array.isArray(icons) || icons.length === 0) {
    fail('tauri.conf.json bundle.icon must include desktop icon paths')
  } else {
    const mustInclude = ['icons/icon.ico', 'icons/icon.icns', 'icons/128x128.png']
    for (const iconPath of mustInclude) {
      if (!icons.includes(iconPath)) {
        fail(`tauri.conf.json bundle.icon missing ${iconPath}`)
      }
    }
  }

  const schemes = tauri.plugins?.['deep-link']?.desktop?.schemes
  if (!Array.isArray(schemes) || !schemes.includes('voxpery')) {
    fail('tauri.conf.json deep-link schemes must include "voxpery"')
  }

  const createUpdaterArtifacts = tauri.bundle?.createUpdaterArtifacts === true
  const updaterPubkey = tauri.plugins?.updater?.pubkey
  const hasPlaceholderUpdaterKey =
    typeof updaterPubkey === 'string' && updaterPubkey.includes('PLACEHOLDER')
  if (createUpdaterArtifacts && (!updaterPubkey || hasPlaceholderUpdaterKey)) {
    fail('Updater artifacts are enabled but updater pubkey is missing or placeholder')
  }

  const updaterEndpoints = tauri.plugins?.updater?.endpoints
  const expectedUpdaterEndpoint =
    'https://github.com/emircanagac/voxpery/releases/latest/download/latest.json'
  if (!Array.isArray(updaterEndpoints) || updaterEndpoints.length !== 1) {
    fail('tauri.conf.json plugins.updater.endpoints must contain exactly one release metadata endpoint')
  } else if (updaterEndpoints[0] !== expectedUpdaterEndpoint) {
    fail(`Unexpected desktop updater endpoint: ${String(updaterEndpoints[0])}`)
  }

  requireNoLocalTargets('tauri.conf.json app.security.csp', tauri.app?.security?.csp)
  requireCspSource(tauri.app?.security?.csp, 'connect-src', 'https://challenges.cloudflare.com')
  requireCspSource(tauri.app?.security?.csp, 'script-src', 'https://challenges.cloudflare.com')
  requireCspSource(tauri.app?.security?.csp, 'frame-src', 'https://challenges.cloudflare.com')

  const installerIcon = tauri.bundle?.windows?.nsis?.installerIcon
  if (installerIcon !== 'icons/icon.ico') {
    fail(
      `tauri.conf.json bundle.windows.nsis.installerIcon must be "icons/icon.ico" (found: ${String(installerIcon)})`,
    )
  }

  const signingPrivateKey = process.env.TAURI_SIGNING_PRIVATE_KEY
  if (createUpdaterArtifacts && !signingPrivateKey) {
    fail('Updater artifacts are enabled but TAURI_SIGNING_PRIVATE_KEY is not configured')
  }
}

requireFile('apps/desktop/src-tauri/icons/icon.ico', 16_000)
requireFile('apps/desktop/src-tauri/icons/icon.icns', 64_000)
requireFile('apps/desktop/src-tauri/icons/icon.png', 8_000)

const capability = loadJson('apps/desktop/src-tauri/capabilities/default.json')
if (capability) {
  const capabilityEntries = Array.isArray(capability.capabilities)
    ? capability.capabilities
    : [capability]
  const releaseCapability = capabilityEntries.find((entry) => entry?.identifier === 'default')
  const permissions = Array.isArray(releaseCapability?.permissions)
    ? releaseCapability.permissions
    : []
  const httpPermission = permissions.find(
    (entry) => typeof entry === 'object' && entry?.identifier === 'http:default'
  )
  if (!httpPermission) {
    fail('Release desktop capability must include http:default permission block')
  } else {
    const allowedUrls = Array.isArray(httpPermission.allow)
      ? httpPermission.allow.map((entry) => entry?.url).filter(Boolean)
      : []
    if (allowedUrls.length !== 1 || allowedUrls[0] !== 'https://api.voxpery.com/**') {
      fail(
        `Release desktop capability http scope must be limited to https://api.voxpery.com/** (found: ${allowedUrls.join(', ')})`
      )
    }
    requireNoLocalTargets('release desktop capability http scope', allowedUrls)
  }
}

const envExample = readFileSync(resolve(repoRoot, '.env.example'), 'utf8')
if (!envExample.includes('voxpery://auth')) {
  fail('.env.example CORS_ORIGINS must include voxpery://auth for desktop OAuth callback')
}

const webApiAuth = readFileSync(resolve(repoRoot, 'apps/web/src/api/auth.ts'), 'utf8')
if (!webApiAuth.includes("isTauri() ? 'voxpery://auth'")) {
  fail('apps/web/src/api/auth.ts must send origin=voxpery://auth for desktop Google OAuth')
}

if (failures.length > 0) {
  console.error('Desktop release validation failed:')
  for (const entry of failures) {
    console.error(`- ${entry}`)
  }
  process.exit(1)
}

console.log('Desktop release validation passed.')
