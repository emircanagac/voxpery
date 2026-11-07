import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { renderAurPackage, renderAurTemplate } from './render-aur-package.mjs'

const SHA = 'a'.repeat(64)

function readTemplate(name) {
  // A Windows checkout may hold CRLF; the release job renders from a Linux (LF) checkout.
  return readFileSync(new URL(`../../apps/desktop/src-tauri/linux/aur/${name}`, import.meta.url), 'utf8').replaceAll('\r', '')
}

test('renders both AUR files with the release version and .deb checksum', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voxpery-aur-'))
  try {
    const deb = join(dir, 'Voxpery_1.2.3_amd64.deb')
    writeFileSync(deb, 'deb bytes')
    const sha256 = renderAurPackage(deb, '1.2.3', join(dir, 'out'), readTemplate)
    const pkgbuild = readFileSync(join(dir, 'out', 'PKGBUILD'), 'utf8')
    const srcinfo = readFileSync(join(dir, 'out', '.SRCINFO'), 'utf8')

    assert.ok(pkgbuild.split('\n').includes('pkgver=1.2.3'))
    assert.ok(pkgbuild.split('\n').includes(`sha256sums=('${sha256}')`))
    assert.ok(srcinfo.split('\n').includes('\tpkgver = 1.2.3'))
    assert.ok(srcinfo.split('\n').includes('\tsource = https://github.com/emircanagac/voxpery/releases/download/v1.2.3/Voxpery_1.2.3_amd64.deb'))
    assert.ok(srcinfo.split('\n').includes(`\tsha256sums = ${sha256}`))
    for (const text of [pkgbuild, srcinfo]) assert.doesNotMatch(text, /@[A-Z0-9]+@|\r/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('keeps the PKGBUILD and .SRCINFO metadata in step', () => {
  const pkgbuild = renderAurTemplate(readTemplate('PKGBUILD'), { version: '1.2.3', sha256: SHA })
  const srcinfo = renderAurTemplate(readTemplate('.SRCINFO'), { version: '1.2.3', sha256: SHA })
  const list = (name) => {
    const body = pkgbuild.match(new RegExp(`^${name}=\\(([\\s\\S]*?)\\)$`, 'm'))?.[1] ?? ''
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
  }
  const entries = (key) => [...srcinfo.matchAll(new RegExp(`^\\t${key} = (.+)$`, 'gm'))].map((m) => m[1])

  for (const key of ['depends', 'optdepends', 'provides', 'conflicts', 'options', 'arch', 'license']) {
    assert.ok(list(key).length > 0, key)
    assert.deepEqual(entries(key), list(key), key)
  }
  assert.equal(entries('pkgdesc')[0], pkgbuild.match(/^pkgdesc='(.+)'$/m)?.[1])
})

test('rejects versions pacman cannot use and malformed checksums', () => {
  const template = "pkgver=@VERSION@\nsha256sums=('@SHA256@')\n"
  assert.throws(() => renderAurTemplate(template, { version: '1.2.3-beta.1', sha256: SHA }))
  assert.throws(() => renderAurTemplate(template, { version: '1.2.3', sha256: 'abc' }))
  assert.throws(() => renderAurTemplate('pkgver=1.0.0\n', { version: '1.2.3', sha256: SHA }))
  assert.throws(() => renderAurTemplate(template.replace('\n', '\r\n'), { version: '1.2.3', sha256: SHA }))
})
