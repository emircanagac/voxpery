import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function desktopEntry(text) {
  const values = new Map()
  let inEntry = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]'
      continue
    }
    if (!inEntry) continue
    const separator = line.indexOf('=')
    if (separator < 1) throw new Error('Invalid Linux desktop entry.')
    const key = line.slice(0, separator)
    if (values.has(key)) throw new Error(`Duplicate Linux desktop entry key: ${key}`)
    values.set(key, line.slice(separator + 1))
  }
  return values
}

export function validateLinuxDesktopEntry(text, { legacy = false } = {}) {
  const entry = desktopEntry(text)
  const expected = {
    Type: 'Application', Name: legacy ? '{{name}}' : 'Voxpery',
    Exec: legacy ? '{{exec}} %U' : 'voxpery-desktop %U',
    Icon: legacy ? '{{icon}}' : 'voxpery-desktop',
    StartupWMClass: legacy ? '{{exec}}' : 'voxpery-desktop',
    Terminal: 'false', MimeType: 'x-scheme-handler/voxpery;',
  }
  for (const [key, value] of Object.entries(expected)) {
    if (entry.get(key) !== value) throw new Error(`Linux launcher ${key} must equal ${value}.`)
  }
  if (legacy ? entry.get('NoDisplay') !== 'true' : ['NoDisplay', 'Hidden'].some(key => entry.get(key) === 'true')) {
    throw new Error('Only the compatibility launcher may be hidden.')
  }
}

export function validateLinuxLaunchers(repoRoot) {
  const root = resolve(repoRoot, 'apps/desktop/src-tauri')
  const config = JSON.parse(readFileSync(resolve(root, 'tauri.conf.json'), 'utf8'))
  if (config.app?.enableGTKAppId !== true || config.identifier !== 'com.voxpery') {
    throw new Error('Linux GTK app ID must match com.voxpery.desktop.')
  }
  for (const format of ['deb', 'rpm']) {
    const bundle = config.bundle?.linux?.[format]
    if (bundle?.desktopTemplate !== 'linux/legacy.desktop.hbs'
      || bundle.files?.['/usr/share/applications/com.voxpery.desktop'] !== 'linux/com.voxpery.desktop') {
      throw new Error(`${format} must install the canonical launcher and preserve the hidden compatibility launcher.`)
    }
  }
  validateLinuxDesktopEntry(readFileSync(resolve(root, 'linux/com.voxpery.desktop'), 'utf8'))
  validateLinuxDesktopEntry(readFileSync(resolve(root, 'linux/legacy.desktop.hbs'), 'utf8'), { legacy: true })
}
