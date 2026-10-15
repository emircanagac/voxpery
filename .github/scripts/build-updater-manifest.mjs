// Builds the desktop updater manifest (latest.json) once, after every platform has uploaded its
// signed bundle to the release. Each platform job used to rewrite latest.json itself, and jobs
// finishing together raced on it (one failed with "Not Found" and its platform was missing).
//
// Usage: node build-updater-manifest.mjs <sig-dir> <out-file>
// Env: GITHUB_REPOSITORY, UPDATER_NOTES, UPDATER_REQUIRE (comma-separated: windows,linux,darwin)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Bundle name patterns as tauri-action uploads them; the first match per updater key wins, so
// native builds come before universal macOS and installers before fallbacks.
const BUNDLES = [
  { pattern: /_x64_[^_]+\.msi$/, keys: ['windows-x86_64-msi'] },
  { pattern: /_x64-setup\.exe$/, keys: ['windows-x86_64-nsis'] },
  { pattern: /_amd64\.AppImage$/, keys: ['linux-x86_64-appimage'] },
  { pattern: /_amd64\.deb$/, keys: ['linux-x86_64-deb'] },
  { pattern: /\.x86_64\.rpm$/, keys: ['linux-x86_64-rpm'] },
  { pattern: /_aarch64\.app\.tar\.gz$/, keys: ['darwin-aarch64-app'] },
  { pattern: /_x64\.app\.tar\.gz$/, keys: ['darwin-x86_64-app'] },
  { pattern: /_universal\.app\.tar\.gz$/, keys: ['darwin-aarch64-app', 'darwin-x86_64-app'] },
]

// The plain platform key points at the preferred bundle, like tauri-action's defaults.
const DEFAULTS = {
  'windows-x86_64': ['windows-x86_64-msi', 'windows-x86_64-nsis'],
  'linux-x86_64': ['linux-x86_64-appimage', 'linux-x86_64-deb', 'linux-x86_64-rpm'],
  'darwin-aarch64': ['darwin-aarch64-app'],
  'darwin-x86_64': ['darwin-x86_64-app'],
}

/**
 * @param {{ version: string, repository: string, notes: string, pubDate: string,
 *   signatures: Record<string, string>, require?: string[] }} input
 *   `signatures` maps each bundle file name to the contents of its `.sig` file.
 */
export function buildUpdaterManifest({ version, repository, notes, pubDate, signatures, require = [] }) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid version: ${version}`)
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`Invalid repository: ${repository}`)

  const platforms = {}
  for (const [file, signature] of Object.entries(signatures).sort(([a], [b]) => a.localeCompare(b))) {
    const bundle = BUNDLES.find(({ pattern }) => pattern.test(file))
    if (!bundle) throw new Error(`No updater platform for ${file}`)
    if (!signature.trim()) throw new Error(`Empty signature for ${file}`)
    const entry = {
      signature: signature.trim(),
      url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(file)}`,
    }
    for (const key of bundle.keys) {
      const index = BUNDLES.indexOf(bundle)
      const current = platforms[key]
      // A native macOS bundle beats the universal one listed after it.
      if (!current || current.index > index) platforms[key] = { ...entry, index }
    }
  }
  for (const [key, preferred] of Object.entries(DEFAULTS)) {
    const source = preferred.find(candidate => platforms[candidate])
    if (source) platforms[key] = platforms[source]
  }

  const families = new Set(Object.keys(platforms).map(key => key.split('-')[0]))
  const missing = require.filter(family => !families.has(family))
  if (missing.length) throw new Error(`Updater manifest is missing: ${missing.join(', ')}`)
  if (!families.size) throw new Error('No signed bundles found')

  const ordered = Object.fromEntries(
    Object.keys(platforms).sort().map(key => [key, { signature: platforms[key].signature, url: platforms[key].url }]),
  )
  return { version, notes, pub_date: pubDate, platforms: ordered }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [sigDir, outFile] = process.argv.slice(2)
  if (!sigDir || !outFile) {
    console.error('Usage: node build-updater-manifest.mjs <sig-dir> <out-file>')
    process.exit(1)
  }
  const tauriConfig = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'))
  const signatures = Object.fromEntries(
    readdirSync(sigDir)
      .filter(name => name.endsWith('.sig'))
      .map(name => [name.slice(0, -'.sig'.length), readFileSync(join(sigDir, name), 'utf8')]),
  )
  const manifest = buildUpdaterManifest({
    version: tauriConfig.version,
    repository: process.env.GITHUB_REPOSITORY ?? '',
    notes: process.env.UPDATER_NOTES ?? '',
    pubDate: new Date().toISOString(),
    signatures,
    require: (process.env.UPDATER_REQUIRE ?? '').split(',').map(value => value.trim()).filter(Boolean),
  })
  writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Updater manifest ${manifest.version}: ${Object.keys(manifest.platforms).join(', ')}`)
}
