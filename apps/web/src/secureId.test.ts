import { describe, expect, it } from 'vitest'
import { createSecureId, createSecureRandomFraction } from './secureId'

describe('createSecureId', () => {
  it('creates unique UUID identifiers with Web Crypto', () => {
    const values = Array.from({ length: 64 }, () => createSecureId())

    expect(new Set(values).size).toBe(values.length)
    values.forEach((value) => {
      expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })
  })

  it('uses getRandomValues when randomUUID is unavailable', () => {
    let next = 0
    const cryptoApi = {
      getRandomValues: (target: Uint8Array) => {
        target.forEach((_, index) => { target[index] = next++ })
        return target
      },
    } as unknown as Crypto

    expect(createSecureId(cryptoApi)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })
})

describe('createSecureRandomFraction', () => {
  it('maps Web Crypto uint32 values into the unit interval', () => {
    const cryptoApi = {
      getRandomValues: (target: Uint32Array) => {
        target[0] = 0x8000_0000
        return target
      },
    } as unknown as Crypto

    expect(createSecureRandomFraction(cryptoApi)).toBe(0.5)
  })
})
