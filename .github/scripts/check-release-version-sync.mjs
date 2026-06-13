import { readFileSync } from 'node:fs'

function fail(message) {
  console.error(`[release-version-sync] ${message}`)
  process.exitCode = 1
}

function read(path) {
  return readFileSync(path, 'utf8')
}

function normalizeVersion(rawVersion) {
  const version = rawVersion?.trim().replace(/^v/, '')
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid semantic version: ${rawVersion || '<empty>'}`)
  }
  return version
}

function packageVersion(path) {
  return JSON.parse(read(path)).version
}

function cargoPackageVersion(path) {
  const match = read(path).match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)
  if (!match) throw new Error(`Could not read package version from ${path}`)
  return match[1]
}

function lockPackageVersion(path, packageName) {
  const lock = read(path)
  const packageNameLine = `name = "${packageName}"`
  const packageIndex = lock.indexOf(packageNameLine)
  if (packageIndex === -1) throw new Error(`Could not find ${packageName} in ${path}`)

  const packageStart = lock.lastIndexOf('[[package]]', packageIndex)
  const nextPackageStart = lock.indexOf('[[package]]', packageIndex + packageNameLine.length)
  const packageEnd = nextPackageStart === -1 ? lock.length : nextPackageStart
  const packageBlock = lock.slice(packageStart, packageEnd)
  const versionMatch = packageBlock.match(/^version\s*=\s*"([^"]+)"/m)
  if (!versionMatch) throw new Error(`Could not read ${packageName} version from ${path}`)
  return versionMatch[1]
}

function expectVersion(label, actual, expected) {
  if (actual !== expected) {
    fail(`${label} is ${actual}, expected ${expected}`)
  } else {
    console.log(`[release-version-sync] ${label}: ${actual}`)
  }
}

const expected = normalizeVersion(
  process.env.EXPECTED_RELEASE_VERSION || packageVersion('apps/web/package.json')
)

expectVersion('web package.json', packageVersion('apps/web/package.json'), expected)
expectVersion('web package-lock root', packageVersion('apps/web/package-lock.json'), expected)
expectVersion(
  'web package-lock package',
  JSON.parse(read('apps/web/package-lock.json')).packages?.['']?.version,
  expected
)
expectVersion('server Cargo.toml', cargoPackageVersion('apps/server/Cargo.toml'), expected)
expectVersion(
  'server Cargo.lock',
  lockPackageVersion('apps/server/Cargo.lock', 'voxpery-server'),
  expected
)
expectVersion('desktop Cargo.toml', cargoPackageVersion('apps/desktop/src-tauri/Cargo.toml'), expected)
expectVersion(
  'desktop Cargo.lock',
  lockPackageVersion('apps/desktop/src-tauri/Cargo.lock', 'voxpery-desktop'),
  expected
)
expectVersion(
  'desktop tauri.conf.json',
  JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')).version,
  expected
)

const changelog = read('docs/CHANGELOG.md')
if (!changelog.includes(`## [${expected}]`)) {
  fail(`docs/CHANGELOG.md does not contain a ${expected} release entry`)
} else {
  console.log(`[release-version-sync] changelog entry: ${expected}`)
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(`[release-version-sync] OK: ${expected}`)
