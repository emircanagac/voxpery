const API_BASE = requiredUrl('SMOKE_API_URL')
const WEB_BASE = requiredUrl('SMOKE_WEB_URL')
const RAW_EXPECTED_VERSION = process.env.SMOKE_EXPECTED_VERSION?.trim()
const EXPECTED_VERSION = RAW_EXPECTED_VERSION
  ? normalizeVersion(RAW_EXPECTED_VERSION)
  : normalizeVersion(process.env.npm_package_version)
const EXPECTED_IMAGE_TAG = (process.env.SMOKE_EXPECTED_IMAGE_TAG || `v${EXPECTED_VERSION}`).trim()
const EXPECTED_BADGE = formatAppVersionBadge(EXPECTED_IMAGE_TAG)

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
  assert(res.ok, `${label} failed (${res.status}) at ${url}`)
  return res
}

function assetUrls(html, webBase) {
  const urls = new Set()
  const pattern = /<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g
  for (const match of html.matchAll(pattern)) {
    const raw = match[1]
    if (!/\.(?:js|css)(?:\?|$)/.test(raw)) continue
    urls.add(new URL(raw, `${webBase}/`).toString())
  }
  return [...urls]
}

async function checkVersionInDeployedAssets() {
  const rootRes = await getOk(`${WEB_BASE}/`, 'web root')
  const html = await rootRes.text()
  const assets = assetUrls(html, WEB_BASE)
  assert(assets.length > 0, 'No JS/CSS assets found in deployed web root')

  const needles = [EXPECTED_BADGE, EXPECTED_IMAGE_TAG].filter(Boolean)
  const seen = new Set()

  for (const asset of assets) {
    const res = await getOk(asset, `asset ${asset}`)
    const text = await res.text()
    for (const needle of needles) {
      if (text.includes(needle)) seen.add(needle)
    }
  }

  for (const needle of needles) {
    assert(seen.has(needle), `Expected deployed web assets to contain ${needle}`)
  }
}

async function main() {
  console.log(`[release-smoke] API: ${API_BASE}`)
  console.log(`[release-smoke] Web: ${WEB_BASE}`)
  console.log(`[release-smoke] Expected version badge: ${EXPECTED_BADGE}`)
  console.log(`[release-smoke] Expected image tag: ${EXPECTED_IMAGE_TAG}`)

  validateImmutableImageTag(EXPECTED_IMAGE_TAG)

  const apiHealth = await getOk(`${API_BASE}/health`, 'API health')
  const apiHealthJson = await apiHealth.json().catch(() => null)
  assert(apiHealthJson?.status === 'ok', 'API health response must be {"status":"ok"}')
  console.log('[release-smoke] API health OK')

  await getOk(`${WEB_BASE}/healthz`, 'web health')
  console.log('[release-smoke] web health OK')

  await checkVersionInDeployedAssets()
  console.log('[release-smoke] deployed version assets OK')
  console.log('[release-smoke] deploy guardrails OK')
}

main().catch((err) => {
  console.error('[release-smoke] FAILED')
  console.error(err)
  process.exit(1)
})
