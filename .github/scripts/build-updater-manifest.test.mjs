import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildUpdaterManifest } from './build-updater-manifest.mjs'

const base = {
  version: '0.4.6',
  repository: 'emircanagac/voxpery',
  notes: 'Desktop release.',
  pubDate: '2026-10-16T00:00:00.000Z',
}
const release = {
  'Voxpery_0.4.6_x64-setup.exe': 'sig-exe\n',
  'Voxpery_0.4.6_amd64.deb': 'sig-deb',
  'Voxpery-0.4.6-1.x86_64.rpm': 'sig-rpm',
  'Voxpery_universal.app.tar.gz': 'sig-mac',
}
const url = file => `https://github.com/emircanagac/voxpery/releases/download/v0.4.6/${file}`

test('lists every platform of a full release like tauri-action did', () => {
  const manifest = buildUpdaterManifest({ ...base, signatures: release, require: ['windows', 'linux', 'darwin'] })
  assert.equal(manifest.version, '0.4.6')
  assert.equal(manifest.notes, 'Desktop release.')
  assert.deepEqual(Object.keys(manifest.platforms), [
    'darwin-aarch64',
    'darwin-aarch64-app',
    'darwin-x86_64',
    'darwin-x86_64-app',
    'linux-x86_64',
    'linux-x86_64-deb',
    'linux-x86_64-rpm',
    'windows-x86_64',
    'windows-x86_64-nsis',
  ])
  assert.deepEqual(manifest.platforms['windows-x86_64'], { signature: 'sig-exe', url: url('Voxpery_0.4.6_x64-setup.exe') })
  assert.equal(manifest.platforms['linux-x86_64'].url, url('Voxpery_0.4.6_amd64.deb'))
  assert.equal(manifest.platforms['linux-x86_64-rpm'].url, url('Voxpery-0.4.6-1.x86_64.rpm'))
  assert.equal(manifest.platforms['darwin-x86_64'].url, url('Voxpery_universal.app.tar.gz'))
})

test('prefers native macOS and MSI bundles when present', () => {
  const manifest = buildUpdaterManifest({
    ...base,
    signatures: {
      ...release,
      'Voxpery_0.4.6_aarch64.app.tar.gz': 'sig-arm',
      'Voxpery_0.4.6_x64_en-US.msi': 'sig-msi',
    },
  })
  assert.equal(manifest.platforms['darwin-aarch64'].signature, 'sig-arm')
  assert.equal(manifest.platforms['darwin-x86_64'].signature, 'sig-mac')
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'sig-msi')
  assert.equal(manifest.platforms['windows-x86_64-nsis'].signature, 'sig-exe')
})

test('a tag release fails when a platform is missing instead of publishing a partial manifest', () => {
  const { 'Voxpery_universal.app.tar.gz': _mac, ...withoutMac } = release
  assert.throws(
    () => buildUpdaterManifest({ ...base, signatures: withoutMac, require: ['windows', 'linux', 'darwin'] }),
    /missing: darwin/,
  )
  // A manual single-platform run publishes what it built.
  const manual = buildUpdaterManifest({ ...base, signatures: { 'Voxpery_0.4.6_x64-setup.exe': 'sig-exe' } })
  assert.deepEqual(Object.keys(manual.platforms), ['windows-x86_64', 'windows-x86_64-nsis'])
})

test('rejects unknown bundles, empty signatures and bad input', () => {
  assert.throws(() => buildUpdaterManifest({ ...base, signatures: { 'notes.txt': 'x' } }), /No updater platform/)
  assert.throws(() => buildUpdaterManifest({ ...base, signatures: { 'Voxpery_0.4.6_amd64.deb': ' ' } }), /Empty signature/)
  assert.throws(() => buildUpdaterManifest({ ...base, signatures: {} }), /No signed bundles/)
  assert.throws(() => buildUpdaterManifest({ ...base, version: 'latest', signatures: release }), /Invalid version/)
  assert.throws(() => buildUpdaterManifest({ ...base, repository: 'a/b/c', signatures: release }), /Invalid repository/)
})
