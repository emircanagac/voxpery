import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'

const repoRoot = process.cwd()
const bundleRoot = resolve(
  repoRoot,
  process.env.DESKTOP_BUNDLE_DIR || 'apps/desktop/src-tauri/target/release/bundle',
)
const platform = normalizePlatform(
  process.argv.find((arg) => arg.startsWith('--platform='))?.split('=')[1] || process.env.RUNNER_OS,
)
const failures = []

function normalizePlatform(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized.includes('windows')) return 'windows'
  if (normalized.includes('mac')) return 'macos'
  if (normalized.includes('linux')) return 'linux'
  return 'unknown'
}

function fail(message) {
  failures.push(message)
}

function walk(dir, entries = []) {
  if (!existsSync(dir)) return entries
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name)
    const stat = statSync(fullPath)
    entries.push({ fullPath, stat })
    if (stat.isDirectory()) walk(fullPath, entries)
  }
  return entries
}

function displayPath(entry) {
  return relative(repoRoot, entry.fullPath).replaceAll('\\', '/')
}

function fileEntries(entries) {
  return entries.filter((entry) => entry.stat.isFile())
}

function findFiles(entries, predicate) {
  return fileEntries(entries).filter((entry) => predicate(entry.fullPath, entry))
}

function requireFiles(label, entries, predicate, minBytes = 1) {
  const matches = findFiles(entries, predicate)
  if (matches.length === 0) {
    fail(`Missing desktop artifact: ${label}`)
    return []
  }
  for (const entry of matches) {
    if (entry.stat.size < minBytes) {
      fail(`Desktop artifact is too small: ${displayPath(entry)} (${entry.stat.size} bytes)`)
    }
  }
  return matches
}

function requireDirectory(label, entries, predicate) {
  const matches = entries.filter((entry) => entry.stat.isDirectory() && predicate(entry.fullPath, entry))
  if (matches.length === 0) {
    fail(`Missing desktop artifact directory: ${label}`)
  }
  return matches
}

function requireUpdaterMetadata(entries) {
  const latestJson = requireFiles(
    'updater latest.json',
    entries,
    (fullPath) => basename(fullPath) === 'latest.json',
    32,
  )
  for (const entry of latestJson) {
    try {
      const metadata = JSON.parse(readFileSync(entry.fullPath, 'utf8').replace(/^\uFEFF/, ''))
      if (!metadata.version || typeof metadata.version !== 'string') {
        fail(`${displayPath(entry)} must include a string version`)
      }
      const platforms = metadata.platforms && typeof metadata.platforms === 'object'
        ? Object.keys(metadata.platforms)
        : []
      if (platforms.length === 0) {
        fail(`${displayPath(entry)} must include updater platforms`)
      }
    } catch (err) {
      fail(`${displayPath(entry)} must be valid updater JSON: ${String(err)}`)
    }
  }
}

if (platform === 'unknown') {
  fail('RUNNER_OS is missing or unsupported for desktop artifact validation')
}

if (!existsSync(bundleRoot)) {
  fail(`Desktop bundle directory does not exist: ${relative(repoRoot, bundleRoot)}`)
} else {
  const entries = walk(bundleRoot)

  if (platform === 'windows') {
    requireFiles('Windows MSI installer', entries, (fullPath) => extname(fullPath).toLowerCase() === '.msi', 1_000_000)
    requireFiles('Windows NSIS installer', entries, (fullPath) => extname(fullPath).toLowerCase() === '.exe', 1_000_000)
  } else if (platform === 'macos') {
    requireDirectory('macOS .app bundle', entries, (fullPath) => fullPath.endsWith('.app'))
    requireFiles('macOS DMG installer', entries, (fullPath) => extname(fullPath).toLowerCase() === '.dmg', 1_000_000)
  } else if (platform === 'linux') {
    requireFiles('Linux DEB package', entries, (fullPath) => extname(fullPath).toLowerCase() === '.deb', 1_000_000)
    requireFiles('Linux RPM package', entries, (fullPath) => extname(fullPath).toLowerCase() === '.rpm', 1_000_000)
  }

  requireUpdaterMetadata(entries)
  requireFiles('updater signature files', entries, (fullPath) => fullPath.endsWith('.sig'), 16)
}

if (failures.length > 0) {
  console.error('Desktop artifact validation failed:')
  for (const entry of failures) {
    console.error(`- ${entry}`)
  }
  process.exit(1)
}

console.log(`Desktop artifact validation passed for ${platform}.`)
