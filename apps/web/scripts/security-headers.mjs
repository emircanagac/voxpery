function header(response, name) {
  return (response.headers.get(name) || '').trim()
}

function compact(value) {
  return value.toLowerCase().replace(/\s+/g, '')
}

function isPublicUrl(rawUrl) {
  const { hostname } = new URL(rawUrl)
  return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1'
}

export function securityHeaderFailures(response, { surface, url }) {
  const csp = header(response, 'content-security-policy').toLowerCase()
  const permissions = compact(header(response, 'permissions-policy'))
  const failures = []

  if (header(response, 'x-frame-options').toUpperCase() !== 'DENY') {
    failures.push('x-frame-options=DENY')
  }
  if (header(response, 'x-content-type-options').toLowerCase() !== 'nosniff') {
    failures.push('x-content-type-options=nosniff')
  }
  if (header(response, 'referrer-policy').toLowerCase() !== 'no-referrer') {
    failures.push('referrer-policy=no-referrer')
  }
  if (new URL(url).protocol === 'https:' && !/^max-age=\d+/i.test(header(response, 'strict-transport-security'))) {
    failures.push('strict-transport-security=max-age')
  }
  if (!csp.includes("frame-ancestors 'none'")) failures.push("csp frame-ancestors 'none'")
  if (!csp.includes("object-src 'none'")) failures.push("csp object-src 'none'")

  if (surface === 'api') {
    if (!csp.includes("default-src 'none'")) failures.push("csp default-src 'none'")
    if (!csp.includes("base-uri 'none'")) failures.push("csp base-uri 'none'")
    if (!csp.includes("form-action 'none'")) failures.push("csp form-action 'none'")
    for (const directive of ['camera=()', 'microphone=()', 'display-capture=()', 'geolocation=()', 'payment=()']) {
      if (!permissions.includes(directive)) failures.push(`permissions-policy ${directive}`)
    }
  } else if (surface === 'web') {
    if (!csp.includes("default-src 'self'")) failures.push("csp default-src 'self'")
    if (!csp.includes("script-src 'self' 'wasm-unsafe-eval'")) {
      failures.push("csp script-src 'wasm-unsafe-eval'")
    }
    if (!csp.includes("base-uri 'self'")) failures.push("csp base-uri 'self'")
    if (!csp.includes("form-action 'self'")) failures.push("csp form-action 'self'")
    for (const directive of [
      'camera=(self)',
      'microphone=(self)',
      'display-capture=(self)',
      'geolocation=()',
      'payment=()',
    ]) {
      if (!permissions.includes(directive)) failures.push(`permissions-policy ${directive}`)
    }
    if (isPublicUrl(url) && /(?:localhost|127\.0\.0\.1)/i.test(csp)) {
      failures.push('production CSP contains a loopback target')
    }
  } else {
    failures.push(`unknown security header surface: ${surface}`)
  }

  return failures
}

export function assertSecurityHeaders(response, options) {
  const failures = securityHeaderFailures(response, options)
  if (failures.length > 0) {
    throw new Error(`${options.surface} security headers missing/invalid: ${failures.join(', ')}`)
  }
}
