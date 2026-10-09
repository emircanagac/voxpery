import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateLinuxDesktopEntry, validateLinuxLaunchers } from './validate-linux-launchers.mjs'

const canonical = readFileSync(new URL('../../apps/desktop/src-tauri/linux/com.voxpery.desktop', import.meta.url), 'utf8')

test('both packages match the GTK app ID and preserve an URL-aware compatibility launcher', () => {
  validateLinuxLaunchers(fileURLToPath(new URL('../../', import.meta.url)))
})

test('rejects launchers that lose the OAuth URL, icon, identity or visibility', () => {
  for (const text of [
    canonical.replace(' %U', ''), canonical.replace('Icon=voxpery-desktop', 'Icon=webkit'),
    canonical.replace('x-scheme-handler/voxpery;', ''), `${canonical}\nNoDisplay=true`,
    `${canonical}\nExec=voxpery-desktop %U`,
  ]) assert.throws(() => validateLinuxDesktopEntry(text))
})
