import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const moduleIndex = process.argv.indexOf('--sharp-module')
const sharp = require(moduleIndex < 0 ? 'sharp' : process.argv[moduleIndex + 1])
const check = process.argv.includes('--check')
const directory = new URL('../../apps/desktop/src-tauri/icons/', import.meta.url)
const source = await readFile(new URL('icon.png', directory))
const oldIco = await readFile(new URL('icon.ico', directory))
const frames = new Map()
const outputs = new Map()
for (let index = 0; index < oldIco.readUInt16LE(4); index++) {
  const offset = 6 + index * 16
  const size = oldIco[offset] || 256
  const start = oldIco.readUInt32LE(offset + 12)
  if (size > 48) frames.set(size, oldIco.subarray(start, start + oldIco.readUInt32LE(offset + 8)))
}
for (const size of [16, 20, 24, 32, 40, 48, 64]) {
  // Preserve the original logo's proportions and transparent margins at every size.
  const png = await sharp(source).resize(size, size, { fit: 'contain', kernel: 'lanczos3' }).png().toBuffer()
  if (size <= 48) frames.set(size, png)
  if (size === 32) outputs.set('32x32.png', png)
  if (size === 64) outputs.set('tray.png', png)
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
outputs.set('icon.ico', Buffer.concat([header, ...entries.map(([, frame]) => frame)]))
for (const [name, bytes] of outputs) {
  const destination = new URL(name, directory)
  if (check) {
    if (!(await readFile(destination)).equals(bytes)) {
      throw new Error(`${name} is out of date; regenerate the desktop icons from icon.png`)
    }
  } else {
    await writeFile(destination, bytes)
  }
}
console.log(`${check ? 'Verified' : 'Generated'} original-logo small ICO frames, 32x32.png and tray.png in ${fileURLToPath(directory)}`)
