import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = process.cwd()
const cargoTomlPath = resolve(repoRoot, 'apps/desktop/src-tauri/Cargo.toml')
const cargoLockPath = resolve(repoRoot, 'apps/desktop/src-tauri/Cargo.lock')
const tauriConfigPath = resolve(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json')

const cargoToml = readFileSync(cargoTomlPath, 'utf8')
const packageSectionMatch = cargoToml.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)

if (!packageSectionMatch) {
  console.error('Could not find desktop package version in Cargo.toml')
  process.exit(1)
}

function normalizeVersion(rawVersion) {
  const version = rawVersion?.trim().replace(/^refs\/tags\//, '').replace(/^v/, '')
  if (!version) return null
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`Invalid desktop release version: ${rawVersion}`)
    process.exit(1)
  }
  return version
}

function releaseVersionFromGitHubRef() {
  if (process.env.GITHUB_REF_TYPE === 'tag') {
    return normalizeVersion(process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF)
  }
  return null
}

const version =
  normalizeVersion(process.env.DESKTOP_RELEASE_VERSION) ??
  releaseVersionFromGitHubRef() ??
  packageSectionMatch[1]

const previousCargoVersion = packageSectionMatch[1]
const updatedCargoToml = cargoToml.replace(
  /(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m,
  `$1${version}$3`
)
if (updatedCargoToml !== cargoToml) {
  writeFileSync(cargoTomlPath, updatedCargoToml, 'utf8')
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'))
const previousTauriVersion = tauriConfig.version
if (previousTauriVersion !== version) {
  tauriConfig.version = version
  writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, 'utf8')
}

const cargoLock = readFileSync(cargoLockPath, 'utf8')
const packageAnchor = '[[package]]'
const packageName = 'name = "voxpery-desktop"'
const packageIndex = cargoLock.indexOf(packageName)

if (packageIndex === -1) {
  console.error('Could not find voxpery-desktop package in Cargo.lock')
  process.exit(1)
}

const packageStart = cargoLock.lastIndexOf(packageAnchor, packageIndex)
const nextPackageStart = cargoLock.indexOf(packageAnchor, packageIndex + packageName.length)
const packageBlockEnd = nextPackageStart === -1 ? cargoLock.length : nextPackageStart
const packageBlock = cargoLock.slice(packageStart, packageBlockEnd)

if (!packageBlock.includes(packageName)) {
  console.error('Could not isolate voxpery-desktop package block in Cargo.lock')
  process.exit(1)
}

const updatedPackageBlock = packageBlock.replace(/version = "([^"]+)"/, `version = "${version}"`)

if (updatedPackageBlock === packageBlock) {
  console.log(`Cargo.lock already matches desktop version ${version}`)
} else {
  const updatedCargoLock =
    cargoLock.slice(0, packageStart) + updatedPackageBlock + cargoLock.slice(packageBlockEnd)

  writeFileSync(cargoLockPath, updatedCargoLock, 'utf8')
}

console.log(
  `Synced desktop version to ${version} (Cargo.toml: ${previousCargoVersion} -> ${version}, tauri.conf: ${previousTauriVersion ?? 'unset'} -> ${version})`
)
