import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(scriptDir, '..', 'dist')
const indexPath = path.join(distDir, 'index.html')
const indexHtml = readFileSync(indexPath, 'utf8')

const entryScriptMatches = indexHtml.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+\.js)"[^>]*>/g)
const preloadMatches = indexHtml.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+\.js)"[^>]*>/g)
const initialJsUrls = [...new Set([
  ...Array.from(entryScriptMatches, (match) => match[1]),
  ...Array.from(preloadMatches, (match) => match[1]),
])]

if (initialJsUrls.length === 0) {
  throw new Error('Initial bundle validation failed: no entry or modulepreload JavaScript was found.')
}

const initialFiles = initialJsUrls.map((url) => {
  const relativePath = url.replace(/^\//, '')
  const filePath = path.join(distDir, relativePath)
  const contents = readFileSync(filePath)
  return {
    url,
    rawBytes: statSync(filePath).size,
    gzipBytes: gzipSync(contents).byteLength,
  }
})

const rawBytes = initialFiles.reduce((total, file) => total + file.rawBytes, 0)
const gzipBytes = initialFiles.reduce((total, file) => total + file.gzipBytes, 0)
const rawBudgetBytes = 350 * 1024
const gzipBudgetBytes = 120 * 1024
// Warn while there is still room, so a change that nearly fills the budget is seen before the
// next one fails CI.
const warnBelowHeadroom = 0.05
const forbiddenPreloads = [
  /\/livekit-[^/]+\.js$/,
  /\/tauri-[^/]+\.js$/,
  /\/tanstack-[^/]+\.js$/,
  /\/rnnoise-[^/]+\.js$/,
  /\/AppShell-[^/]+\.js$/,
  /\/UnifiedLayout-[^/]+\.js$/,
  // Icons belong with the screens that use them; one shared icon chunk loads every icon at startup.
  /\/lucide-[^/]+\.js$/,
]

const failures = []
if (rawBytes > rawBudgetBytes) {
  failures.push(`initial JavaScript is ${formatKiB(rawBytes)} raw; budget is ${formatKiB(rawBudgetBytes)}`)
}
if (gzipBytes > gzipBudgetBytes) {
  failures.push(`initial JavaScript is ${formatKiB(gzipBytes)} gzip; budget is ${formatKiB(gzipBudgetBytes)}`)
}

for (const file of initialFiles) {
  if (forbiddenPreloads.some((pattern) => pattern.test(file.url))) {
    failures.push(`authenticated or platform-only chunk is preloaded: ${file.url}`)
  }
}

console.log(`Initial JavaScript: ${formatKiB(rawBytes)} raw / ${formatKiB(gzipBytes)} gzip across ${initialFiles.length} files.`)
for (const file of initialFiles) {
  console.log(`- ${file.url}: ${formatKiB(file.rawBytes)} raw / ${formatKiB(file.gzipBytes)} gzip`)
}
for (const [label, used, budget] of [['raw', rawBytes, rawBudgetBytes], ['gzip', gzipBytes, gzipBudgetBytes]]) {
  const headroom = budget - used
  console.log(`Headroom (${label}): ${formatKiB(headroom)} of ${formatKiB(budget)}.`)
  if (headroom >= 0 && headroom < budget * warnBelowHeadroom) {
    const message = `initial JavaScript leaves only ${formatKiB(headroom)} of the ${label} budget; lazy-load what the first screen does not need`
    console.log(process.env.GITHUB_ACTIONS ? `::warning title=Initial bundle::${message}` : `Warning: ${message}`)
  }
}

if (failures.length > 0) {
  console.error('\nInitial bundle validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}
