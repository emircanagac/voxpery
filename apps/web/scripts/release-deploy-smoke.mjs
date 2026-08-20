import { assertSecurityHeaders } from './security-headers.mjs'

const API_BASE = requiredUrl('SMOKE_API_URL')
const WEB_BASE = requiredUrl('SMOKE_WEB_URL')
const RAW_EXPECTED_VERSION = process.env.SMOKE_EXPECTED_VERSION?.trim()
const EXPECTED_VERSION = RAW_EXPECTED_VERSION
  ? normalizeVersion(RAW_EXPECTED_VERSION)
  : normalizeVersion(process.env.npm_package_version)
const EXPECTED_IMAGE_TAG = (process.env.SMOKE_EXPECTED_IMAGE_TAG || `v${EXPECTED_VERSION}`).trim()
const EXPECTED_BADGE = formatAppVersionBadge(EXPECTED_IMAGE_TAG)
const SKIP_API_HEALTH = process.env.SMOKE_SKIP_API_HEALTH?.trim().toLowerCase() === 'true'

function requiredUrl(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value.replace(/\/+$/, '')
}

function normalizeVersion(rawVersion) {
  const version = rawVersion?.trim().replace(/^v/, '')
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${rawVersion || '<empty>'}`)
  }
  return version
}

function formatAppVersionBadge(rawVersion) {
  const version = rawVersion?.trim()
  if (!version) return null
  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return `v${version}`
  const shortSha = version.match(/^sha-([0-9a-f]{7})[0-9a-f]+$/i)
  if (shortSha?.[1]) return `sha-${shortSha[1]}`
  return version
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function validateImmutableImageTag(tag) {
  assert(tag, 'Expected image tag is required')
  assert(tag !== 'latest', 'Expected image tag must not be latest')
  assert(/^[A-Za-z0-9_.-]+$/.test(tag), `Expected image tag contains unsupported characters: ${tag}`)
  assert(
    /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag) || /^sha-[0-9a-f]{7,40}$/i.test(tag),
    `Expected image tag must be a release tag or sha tag: ${tag}`
  )
}

async function getOk(url, label) {
  const res = await fetch(url, { redirect: 'manual' })
  if (!res.ok) {
    const server = res.headers.get('server') || '<missing>'
    const cfRay = res.headers.get('cf-ray') || '<missing>'
    const body = (await res.clone().text().catch(() => ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240)
    throw new Error(
      `${label} failed (${res.status}) at ${url}; server=${server}; cf-ray=${cfRay}; body=${body || '<empty>'}`
    )
  }
  return res
}

function cacheControl(response) {
  return response.headers.get('cache-control')?.toLowerCase() || ''
}

function assertRevalidated(response, label) {
  const value = cacheControl(response)
  assert(
    value.includes('no-cache') || value.includes('no-store') || /(?:^|,)\s*max-age=0(?:\s*,|$)/.test(value),
    `${label} must be revalidated on normal reload; received Cache-Control: ${value || '<missing>'}`
  )
}

async function checkDeployedVersion() {
  const rootRes = await getOk(`${WEB_BASE}/`, 'web root')
  assertRevalidated(rootRes, 'web root')

  const serviceWorkerRes = await getOk(`${WEB_BASE}/sw.js`, 'service worker')
  assertRevalidated(serviceWorkerRes, 'service worker')

  const versionRes = await getOk(`${WEB_BASE}/version.json`, 'version metadata')
  assertRevalidated(versionRes, 'version metadata')
  const metadata = await versionRes.json().catch(() => null)
  assert(metadata && typeof metadata === 'object', 'Version metadata must be valid JSON')
  assert(
    metadata.imageTag === EXPECTED_IMAGE_TAG,
    `Expected deployed image tag ${EXPECTED_IMAGE_TAG}; received ${metadata.imageTag || '<missing>'}`
  )
}

async function main() {
  console.log(`[release-smoke] API: ${API_BASE}`)
  console.log(`[release-smoke] Web: ${WEB_BASE}`)
  console.log(`[release-smoke] Expected version badge: ${EXPECTED_BADGE}`)
  console.log(`[release-smoke] Expected image tag: ${EXPECTED_IMAGE_TAG}`)

  validateImmutableImageTag(EXPECTED_IMAGE_TAG)

  if (SKIP_API_HEALTH) {
    console.log('[release-smoke] API edge health already verified from the deploy host')
  } else {
    const apiHealth = await getOk(`${API_BASE}/health`, 'API health')
    assertSecurityHeaders(apiHealth, { surface: 'api', url: `${API_BASE}/health` })
    const apiHealthJson = await apiHealth.json().catch(() => null)
    assert(apiHealthJson?.status === 'ok', 'API health response must be {"status":"ok"}')
    console.log('[release-smoke] API health and security headers OK')
  }

  const webHealth = await getOk(`${WEB_BASE}/healthz`, 'web health')
  assertSecurityHeaders(webHealth, { surface: 'web', url: `${WEB_BASE}/healthz` })
  console.log('[release-smoke] web health and security headers OK')

  await checkDeployedVersion()
  console.log('[release-smoke] deployed version metadata OK')
  console.log('[release-smoke] deploy guardrails OK')
}

main().catch((err) => {
  console.error('[release-smoke] FAILED')
  console.error(err)
  process.exit(1)
})
