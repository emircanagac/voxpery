import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = process.cwd()
const configPath = resolve(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json')
const updaterPublicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim()

if (!updaterPublicKey) {
  console.error('TAURI_UPDATER_PUBLIC_KEY is required when desktop updater artifacts are enabled.')
  process.exit(1)
}

const tauri = JSON.parse(readFileSync(configPath, 'utf8'))

if (!tauri.plugins?.updater) {
  console.error('tauri.conf.json is missing plugins.updater configuration.')
  process.exit(1)
}

tauri.plugins.updater.pubkey = updaterPublicKey

writeFileSync(configPath, `${JSON.stringify(tauri, null, 2)}\n`, 'utf8')
console.log('Injected desktop updater public key into tauri.conf.json')
