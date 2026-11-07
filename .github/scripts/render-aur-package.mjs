// Fills the AUR package templates (apps/desktop/src-tauri/linux/aur) with a release version and
// the SHA-256 of its .deb, so the PKGBUILD always points at the exact file on the release.
// Usage: node .github/scripts/render-aur-package.mjs <release .deb> <version> <output dir>
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE_DIR = new URL('../../apps/desktop/src-tauri/linux/aur/', import.meta.url)
const FILES = ['PKGBUILD', '.SRCINFO']

export function renderAurTemplate(template, { version, sha256 }) {
  // pacman versions cannot contain '-'; the release tags are plain X.Y.Z.
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid AUR package version: ${version}`)
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Invalid SHA-256 checksum')
  if (!template.includes('@VERSION@') || !template.includes('@SHA256@')) {
    throw new Error('AUR template is missing @VERSION@ or @SHA256@')
  }
  const rendered = template.replaceAll('@VERSION@', version).replaceAll('@SHA256@', sha256)
  if (rendered.includes('\r')) throw new Error('AUR files must use LF line endings')
  return rendered
}

const readTemplate = (name) => readFileSync(new URL(name, TEMPLATE_DIR), 'utf8')

export function renderAurPackage(debPath, version, outDir, read = readTemplate) {
  const sha256 = createHash('sha256').update(readFileSync(debPath)).digest('hex')
  mkdirSync(outDir, { recursive: true })
  for (const name of FILES) {
    writeFileSync(join(outDir, name), renderAurTemplate(read(name), { version, sha256 }))
  }
  return sha256
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [debPath, version, outDir] = process.argv.slice(2)
  if (!debPath || !version || !outDir) {
    console.error('Usage: render-aur-package.mjs <release .deb> <version> <output dir>')
    process.exit(1)
  }
  const sha256 = renderAurPackage(debPath, version, outDir)
  console.log(`Rendered voxpery-bin ${version} (sha256 ${sha256}) into ${outDir}`)
}
