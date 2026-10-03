import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const moduleIndex = process.argv.indexOf('--sharp-module')
const sharp = require(moduleIndex < 0 ? 'sharp' : process.argv[moduleIndex + 1])
const directory = new URL('../../apps/desktop/src-tauri/icons/', import.meta.url)
const svg = await readFile(new URL('small-icon.svg', directory), 'utf8')
const oldIco = await readFile(new URL('icon.ico', directory))
const frames = new Map()
for (let index = 0; index < oldIco.readUInt16LE(4); index++) {
  const offset = 6 + index * 16
  const size = oldIco[offset] || 256
  const start = oldIco.readUInt32LE(offset + 12)
  if (size > 48) frames.set(size, oldIco.subarray(start, start + oldIco.readUInt32LE(offset + 8)))
}
for (const size of [16, 20, 24, 32, 40, 48, 64]) {
  const source = svg.replace('width="32" height="32"', `width="${size}" height="${size}"`)
  const png = await sharp(Buffer.from(source)).png().toBuffer()
  if (size <= 48) frames.set(size, png)
  if (size === 32) await writeFile(new URL('32x32.png', directory), png)
  if (size === 64) await writeFile(new URL('tray.png', directory), png)
}
const entries = [...frames].sort(([left], [right]) => left - right)
const header = Buffer.alloc(6 + entries.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(entries.length, 4)
let start = header.length
entries.forEach(([size, frame], index) => {
  const offset = 6 + index * 16
  header[offset] = size === 256 ? 0 : size
  header[offset + 1] = header[offset]
  header.writeUInt16LE(1, offset + 4)
  header.writeUInt16LE(32, offset + 6)
  header.writeUInt32LE(frame.length, offset + 8)
  header.writeUInt32LE(start, offset + 12)
  start += frame.length
})
await writeFile(new URL('icon.ico', directory), Buffer.concat([header, ...entries.map(([, frame]) => frame)]))
console.log(`Generated small ICO frames, 32x32.png and tray.png in ${fileURLToPath(directory)}`)
