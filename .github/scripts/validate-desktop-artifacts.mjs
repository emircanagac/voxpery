import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = process.cwd()
const targetRoot = resolve(repoRoot, 'apps/desktop/src-tauri/target')
const configuredBundleRoot = process.env.DESKTOP_BUNDLE_DIR
  ? resolve(repoRoot, process.env.DESKTOP_BUNDLE_DIR)
  : null
const platform = normalizePlatform(
  process.argv.find((arg) => arg.startsWith('--platform='))?.split('=')[1] || process.env.RUNNER_OS,
)
const failures = []
const warnings = []

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

function warn(message) {
  warnings.push(message)
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

function findBundleRoots() {
  if (configuredBundleRoot) {
    return existsSync(configuredBundleRoot) ? [configuredBundleRoot] : []
  }

  const candidates = []

  function visit(dir) {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const fullPath = join(dir, name)
      const stat = statSync(fullPath)
      if (!stat.isDirectory()) continue

      if (name === 'bundle' && fullPath.split(/[\\/]/).includes('release')) {
        candidates.push(fullPath)
        continue
      }

      visit(fullPath)
    }
  }

  visit(targetRoot)
  return candidates
}

function displayRelativePath(fullPath) {
  return relative(repoRoot, fullPath).replaceAll('\\', '/')
}

function displayPath(entry) {
  return displayRelativePath(entry.fullPath)
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
  const latestJson = findFiles(entries, (fullPath) => basename(fullPath) === 'latest.json')
  if (latestJson.length === 0) {
    warn(
      'No local updater latest.json was found. This file can be produced/uploaded by tauri-action release handling; preflight validates updater config and signing secrets.',
    )
    return
  }

  for (const entry of latestJson) {
    if (entry.stat.size < 32) {
      fail(`Desktop artifact is too small: ${displayPath(entry)} (${entry.stat.size} bytes)`)
      continue
    }
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

function validateMacBundlePrivacyMetadata(entries, appBundles) {
  const requiredInfoKeys = [
    'NSMicrophoneUsageDescription',
    'NSCameraUsageDescription',
    'NSScreenCaptureUsageDescription',
    'NSAudioCaptureUsageDescription',
  ]
  const infoPlists = requireFiles(
    'macOS merged Info.plist',
    entries,
    (fullPath) => fullPath.endsWith(join('.app', 'Contents', 'Info.plist')),
    200,
  )
  for (const entry of infoPlists) {
    const contents = readFileSync(entry.fullPath)
    for (const key of requiredInfoKeys) {
      if (!contents.includes(Buffer.from(key))) {
        fail(`${displayPath(entry)} must include ${key}`)
      }
    }
  }

  const requiredEntitlements = [
    'com.apple.security.device.audio-input',
    'com.apple.security.device.camera',
  ]
  for (const appBundle of appBundles) {
    const result = spawnSync(
      '/usr/bin/codesign',
      ['-d', '--entitlements', ':-', appBundle.fullPath],
      { encoding: 'utf8' },
    )
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    if (result.status !== 0) {
      fail(`Unable to inspect macOS code-signing entitlements for ${displayPath(appBundle)}`)
      continue
    }
    for (const key of requiredEntitlements) {
      if (!output.includes(key)) {
        fail(`${displayPath(appBundle)} code signature must include ${key}`)
      }
    }
  }
}

if (platform === 'unknown') {
  fail('RUNNER_OS is missing or unsupported for desktop artifact validation')
}

const bundleRoots = findBundleRoots()

if (bundleRoots.length === 0) {
  const searched = configuredBundleRoot
    ? displayRelativePath(configuredBundleRoot)
    : `${displayRelativePath(targetRoot)}/**/release/bundle`
  fail(`Desktop bundle directory does not exist: ${searched}`)
} else {
  const entries = bundleRoots.flatMap((bundleRoot) => walk(bundleRoot))
  console.log(
    `Desktop artifact validation scanning ${bundleRoots.length} bundle director${bundleRoots.length === 1 ? 'y' : 'ies'}:`,
  )
  for (const bundleRoot of bundleRoots) {
    console.log(`- ${displayRelativePath(bundleRoot)}`)
  }

  if (platform === 'windows') {
    requireFiles('Windows MSI installer', entries, (fullPath) => extname(fullPath).toLowerCase() === '.msi', 1_000_000)
    requireFiles('Windows NSIS installer', entries, (fullPath) => extname(fullPath).toLowerCase() === '.exe', 1_000_000)
  } else if (platform === 'macos') {
    const appBundles = requireDirectory('macOS .app bundle', entries, (fullPath) => fullPath.endsWith('.app'))
    requireFiles('macOS DMG installer', entries, (fullPath) => extname(fullPath).toLowerCase() === '.dmg', 1_000_000)
    validateMacBundlePrivacyMetadata(entries, appBundles)
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

for (const entry of warnings) {
  console.warn(`Desktop artifact validation warning: ${entry}`)
}

console.log(`Desktop artifact validation passed for ${platform}.`)
