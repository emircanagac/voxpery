import { readFileSync } from 'node:fs'

import { securityHeaderFailures } from '../../apps/web/scripts/security-headers.mjs'

const failures = []

function read(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${path}: ${String(error)}`)
    return ''
  }
}

function requireText(label, text, expected) {
  if (!text.includes(expected)) failures.push(`${label} must include: ${expected}`)
}

function locationBlock(config, location) {
  const marker = `location ${location} {`
  const start = config.indexOf(marker)
  if (start < 0) return ''
  const bodyStart = start + marker.length
  const bodyEnd = config.indexOf('}', bodyStart)
  return bodyEnd < 0 ? '' : config.slice(bodyStart, bodyEnd)
}

function requireLocationText(label, config, location, expected) {
  const block = locationBlock(config, location)
  if (!block) {
    failures.push(`${label} must include location ${location}`)
    return
  }
  requireText(`${label} location ${location}`, block, expected)
}

function includesLocalBackendTarget(value) {
  return /(^|[^a-z0-9.-])(localhost|127\.0\.0\.1)(?::|\/|\\|\*|"|$)/i.test(value)
}

function validateNginx(path, { production }) {
  const config = read(path)
  const label = path
  requireText(label, config, 'add_header X-Frame-Options "DENY" always;')
  requireText(label, config, 'add_header X-Content-Type-Options "nosniff" always;')
  requireText(label, config, 'add_header Referrer-Policy "no-referrer" always;')
  requireText(label, config, 'camera=(self), microphone=(self), display-capture=(self)')
  requireText(label, config, "object-src 'none'")
  requireText(label, config, "base-uri 'self'")
  requireText(label, config, "form-action 'self'")
  requireText(label, config, "frame-ancestors 'none'")
  requireText(label, config, "script-src 'self' 'wasm-unsafe-eval'")
  requireText(label, config, 'location = /healthz {')
  requireText(label, config, 'default_type text/plain;')
  requireLocationText(label, config, '= /index.html', 'expires -1;')
  requireLocationText(label, config, '= /index.html', 'try_files $uri =404;')
  requireLocationText(label, config, '= /sw.js', 'expires -1;')
  requireLocationText(label, config, '= /sw.js', 'try_files $uri =404;')
  requireLocationText(label, config, '= /assets/rnnoise-worklet.js', 'expires -1;')
  requireLocationText(label, config, '= /assets/rnnoise-worklet.js', 'try_files $uri =404;')
  requireLocationText(label, config, '^~ /assets/', 'expires 1y;')
  requireLocationText(label, config, '^~ /assets/', 'try_files $uri =404;')
  requireLocationText(label, config, '/', 'expires -1;')
  requireLocationText(label, config, '/', 'try_files $uri $uri/ /index.html;')

  if (production) {
    requireText(label, config, 'add_header Strict-Transport-Security "max-age=31536000" always;')
    if (includesLocalBackendTarget(config)) {
      failures.push(`${label} must not include loopback CSP targets`)
    }
  }

  const healthBlock = config.match(/location\s*=\s*\/healthz\s*\{([\s\S]*?)\}/)?.[1] || ''
  if (/\badd_header\b/.test(healthBlock)) {
    failures.push(`${label} /healthz must inherit server security headers instead of declaring add_header`)
  }
}

function validateTauri(path, { production }) {
  let config
  try {
    config = JSON.parse(read(path))
  } catch (error) {
    failures.push(`Invalid JSON in ${path}: ${String(error)}`)
    return
  }
  const csp = config?.app?.security?.csp || {}
  const requirements = {
    'media-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  }
  for (const [directive, sources] of Object.entries(requirements)) {
    const value = typeof csp[directive] === 'string' ? csp[directive].split(/\s+/) : []
    for (const source of sources) {
      if (!value.includes(source)) failures.push(`${path} ${directive} must include ${source}`)
    }
  }
  if (production && includesLocalBackendTarget(JSON.stringify(csp))) {
    failures.push(`${path} release CSP must not include loopback targets`)
  }
}

validateNginx('apps/web/nginx.production.conf', { production: true })
validateNginx('apps/web/nginx.development.conf', { production: false })
validateTauri('apps/desktop/src-tauri/tauri.conf.json', { production: true })
validateTauri('apps/desktop/src-tauri/tauri.dev.conf.json', { production: false })

const pwaRegistration = read('apps/web/src/pwa.ts')
requireText('apps/web/src/pwa.ts', pwaRegistration, "register('/sw.js', { updateViaCache: 'none' })")
requireText('apps/web/src/pwa.ts', pwaRegistration, 'registration.update()')

const apiFixture = new Response(null, {
  headers: {
    'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    'strict-transport-security': 'max-age=31536000',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), display-capture=(), geolocation=(), payment=()',
  },
})
for (const failure of securityHeaderFailures(apiFixture, {
  surface: 'api',
  url: 'https://api.voxpery.com/health',
})) {
  failures.push(`API runtime smoke contract rejected the expected policy: ${failure}`)
}

const webFixture = new Response(null, {
  headers: {
    'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://api.voxpery.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    'strict-transport-security': 'max-age=31536000',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()',
  },
})
for (const failure of securityHeaderFailures(webFixture, {
  surface: 'web',
  url: 'https://voxpery.com/healthz',
})) {
  failures.push(`Web runtime smoke contract rejected the expected policy: ${failure}`)
}

if (failures.length > 0) {
  console.error('Security policy validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Security policy validation passed.')
