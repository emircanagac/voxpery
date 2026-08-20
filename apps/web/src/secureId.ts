function fallbackUuid(cryptoApi: Crypto): string {
  const bytes = new Uint8Array(16)
  cryptoApi.getRandomValues(bytes)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createSecureRandomFraction(cryptoApi: Crypto = globalThis.crypto): number {
  if (!cryptoApi) throw new Error('Secure randomness is unavailable')
  const value = new Uint32Array(1)
  cryptoApi.getRandomValues(value)
  return (value[0] ?? 0) / 0x1_0000_0000
}

export function createSecureId(cryptoApi: Crypto = globalThis.crypto): string {
  if (!cryptoApi) throw new Error('Secure randomness is unavailable')
  return typeof cryptoApi.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : fallbackUuid(cryptoApi)
}
