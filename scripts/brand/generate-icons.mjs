#!/usr/bin/env node
// Regenerates every app icon from the master logo (apps/web/public/voxpery-logo.svg).
// Each size is rendered from the vector at its exact pixel size, so small icons are not
// downscaled bitmaps. Uses the Playwright Chromium installed for the web app.
//
// Usage: node scripts/brand/generate-icons.mjs   (run `npx playwright install chromium` in apps/web first if needed)
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(join(root, 'apps/web/package.json'))
const { chromium } = require('@playwright/test')

const master = readFileSync(join(root, 'apps/web/public/voxpery-logo.svg'), 'utf8')
const defs = master.match(/<defs>[\s\S]*?<\/defs>/)[0]
const fox = master.match(/<g id="fox">[\s\S]*?<\/g>/)[0]
// Solid background used only where a platform requires an opaque icon (iOS, Android, PWA maskable).
const tileColor = '#1B2130'

// The logo is the bare fox everywhere; `viewBox` frames it on the 64-unit grid.
// `plate` is the background a platform forces, and `foxScale` keeps the fox inside its safe zone.
const FOX_BOX = '6 8.5 52 52'
const VARIANTS = {
  // Bare fox filling the square: Windows/Linux desktop, tray, favicon, PWA "any", in-app.
  bare: { viewBox: FOX_BOX, plate: '' },
  // macOS app icon grid: the artwork takes about 80% of the canvas, transparent around it.
  macos: { viewBox: '-0.3 2.2 64.6 64.6', plate: '' },
  // Opaque square: iOS and apple-touch-icon (the OS applies its own mask).
  square: { viewBox: '0 0 64 64', plate: `<rect width="64" height="64" fill="${tileColor}"/>`, foxScale: 0.86 },
  // PWA maskable: full bleed, artwork inside the 80% safe zone.
  maskable: { viewBox: '0 0 64 64', plate: `<rect width="64" height="64" fill="${tileColor}"/>`, foxScale: 0.72 },
  // Android legacy and round launchers.
  tile: { viewBox: '0 0 64 64', plate: `<rect x="2" y="2" width="60" height="60" rx="15" fill="${tileColor}"/>` },
  round: { viewBox: '0 0 64 64', plate: `<circle cx="32" cy="32" r="30" fill="${tileColor}"/>`, foxScale: 0.86 },
  // Android adaptive foreground: artwork only, inside the 66/108 safe zone (background = tile color).
  foreground: { viewBox: '0 0 64 64', plate: '', foxScale: 0.58 },
}

function svgFor(variant, size) {
  const { viewBox, plate, foxScale = 1 } = VARIANTS[variant]
  const body = fox.replace('<g id="fox">', '<g>')
  const art = foxScale === 1 ? body : `<g transform="translate(32 33.5) scale(${foxScale}) translate(-32 -33.5)">${body}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}">${defs}${plate}${art}</svg>`
}

const TARGETS = [
  // Desktop (Tauri bundle, Windows/Linux)
  ['apps/desktop/src-tauri/icons/32x32.png', 'bare', 32],
  ['apps/desktop/src-tauri/icons/64x64.png', 'bare', 64],
  ['apps/desktop/src-tauri/icons/128x128.png', 'bare', 128],
  ['apps/desktop/src-tauri/icons/128x128@2x.png', 'bare', 256],
  ['apps/desktop/src-tauri/icons/icon.png', 'bare', 512],
  ['apps/desktop/src-tauri/icons/icon_preview.png', 'bare', 32],
  ['apps/desktop/src-tauri/icons/tray.png', 'bare', 64],
  ['apps/desktop/src-tauri/icons/StoreLogo.png', 'bare', 50],
  ...[30, 44, 71, 89, 107, 142, 150, 284, 310].map((s) => [`apps/desktop/src-tauri/icons/Square${s}x${s}Logo.png`, 'bare', s]),
  // Android
  ...[['mdpi', 48, 108], ['hdpi', 49, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]].flatMap(([dpi, launcher, fg]) => [
    [`apps/desktop/src-tauri/icons/android/mipmap-${dpi}/ic_launcher.png`, 'tile', launcher],
    [`apps/desktop/src-tauri/icons/android/mipmap-${dpi}/ic_launcher_round.png`, 'round', launcher],
    [`apps/desktop/src-tauri/icons/android/mipmap-${dpi}/ic_launcher_foreground.png`, 'foreground', fg],
  ]),
  // iOS
  ...[
    ['20x20@1x', 20], ['20x20@2x', 40], ['20x20@2x-1', 40], ['20x20@3x', 60],
    ['29x29@1x', 29], ['29x29@2x', 58], ['29x29@2x-1', 58], ['29x29@3x', 87],
    ['40x40@1x', 40], ['40x40@2x', 80], ['40x40@2x-1', 80], ['40x40@3x', 120],
    ['60x60@2x', 120], ['60x60@3x', 180], ['76x76@1x', 76], ['76x76@2x', 152],
    ['83.5x83.5@2x', 167], ['512@2x', 1024],
  ].map(([name, s]) => [`apps/desktop/src-tauri/icons/ios/AppIcon-${name}.png`, 'square', s]),
  // Web
  ['apps/web/public/1024.png', 'bare', 1024],
  ['apps/web/public/pwa-192.png', 'bare', 192],
  ['apps/web/public/pwa-512.png', 'bare', 512],
  ['apps/web/public/pwa-maskable-512.png', 'maskable', 512],
  ['apps/web/public/favicon-32.png', 'bare', 32],
  ['apps/web/public/apple-touch-icon.png', 'square', 180],
]

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
// macOS icns types with PNG payloads.
const ICNS_ENTRIES = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]]

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
const cache = new Map()
async function render(variant, size) {
  const key = `${variant}:${size}`
  if (!cache.has(key)) {
    await page.setViewportSize({ width: Math.max(size, 16), height: Math.max(size, 16) })
    await page.setContent(`<html><body style="margin:0;background:transparent">${svgFor(variant, size)}</body></html>`)
    cache.set(key, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }))
  }
  return cache.get(key)
}

for (const [file, variant, size] of TARGETS) {
  writeFileSync(join(root, file), await render(variant, size))
}

// Windows .ico with PNG frames of the bare fox; the 32 px frame is byte-identical to 32x32.png.
// Frames render one at a time: render() reuses one page, so concurrent calls mix viewports and crop.
const icoFrames = []
for (const s of ICO_SIZES) {
  icoFrames.push(await render('bare', s))
}
const icoHeader = Buffer.alloc(6 + 16 * ICO_SIZES.length)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(ICO_SIZES.length, 4)
let offset = icoHeader.length
ICO_SIZES.forEach((s, i) => {
  const entry = 6 + i * 16
  icoHeader.writeUInt8(s === 256 ? 0 : s, entry)
  icoHeader.writeUInt8(s === 256 ? 0 : s, entry + 1)
  icoHeader.writeUInt16LE(1, entry + 4)
  icoHeader.writeUInt16LE(32, entry + 6)
  icoHeader.writeUInt32LE(icoFrames[i].length, entry + 8)
  icoHeader.writeUInt32LE(offset, entry + 12)
  offset += icoFrames[i].length
})
writeFileSync(join(root, 'apps/desktop/src-tauri/icons/icon.ico'), Buffer.concat([icoHeader, ...icoFrames]))

// macOS .icns: the bare fox on the macOS icon grid.
const icnsChunks = []
for (const [type, s] of ICNS_ENTRIES) {
  const data = await render('macos', s)
  const head = Buffer.alloc(8)
  head.write(type, 0, 'ascii')
  head.writeUInt32BE(data.length + 8, 4)
  icnsChunks.push(head, data)
}
const icnsBody = Buffer.concat(icnsChunks)
const icnsHead = Buffer.alloc(8)
icnsHead.write('icns', 0, 'ascii')
icnsHead.writeUInt32BE(icnsBody.length + 8, 4)
writeFileSync(join(root, 'apps/desktop/src-tauri/icons/icon.icns'), Buffer.concat([icnsHead, icnsBody]))

await browser.close()
console.log(`Generated ${TARGETS.length} PNG files, icon.ico and icon.icns from voxpery-logo.svg`)
