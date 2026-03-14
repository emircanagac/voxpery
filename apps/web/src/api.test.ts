import { beforeEach, describe, it, expect, afterEach } from 'vitest'
import { createWebSocket, getAuthErrorMessage, isAuthError } from './api'

class MockWebSocket {
  url: string
  protocols?: string | string[]
  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
  }
}

const OriginalWebSocket = globalThis.WebSocket

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.WebSocket = MockWebSocket as any
})

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket
})

describe('API Error Handling', () => {
  describe('getAuthErrorMessage', () => {
    it('should parse error with code prefix', () => {
      const err = new Error('INVALID_CREDENTIALS:Wrong password')
      const result = getAuthErrorMessage(err)

      expect(result.code).toBe('INVALID_CREDENTIALS')
      expect(result.message).toBe('Wrong password')
    })

    it('should handle connection errors', () => {
      const err = new Error('CONNECTION_ERROR:Cannot connect to server')
      const result = getAuthErrorMessage(err)

      expect(result.code).toBe('CONNECTION_ERROR')
      expect(result.message).toContain('Cannot connect')
    })

    it('should handle errors without code', () => {
      const err = new Error('Something went wrong')
      const result = getAuthErrorMessage(err)

      expect(result.code).toBeUndefined()
      expect(result.message).toBe('Something went wrong')
    })

    it('should handle non-Error objects', () => {
      const err = 'String error'
      const result = getAuthErrorMessage(err)

      expect(result.message).toBe('String error')
    })
  })

  describe('isAuthError', () => {
    it('should detect authentication errors', () => {
      expect(isAuthError(new Error('Authentication required'))).toBe(true)
      expect(isAuthError(new Error('Invalid credentials'))).toBe(true)
      expect(isAuthError(new Error('Unauthorized'))).toBe(true)
    })

    it('should not detect non-auth errors', () => {
      expect(isAuthError(new Error('Network error'))).toBe(false)
      expect(isAuthError(new Error('Server error'))).toBe(false)
    })
  })

  describe('createWebSocket', () => {
    it('uses websocket protocol auth when token is provided', () => {
      const ws = createWebSocket('abc123') as unknown as MockWebSocket
      expect(ws.url).toMatch(/\/ws$/)
      expect(ws.url).not.toContain('token=')
      expect(ws.protocols).toEqual(['voxpery.auth', 'abc123'])
    })

    it('does not attach token in URL when token is null', () => {
      const ws = createWebSocket(null) as unknown as MockWebSocket
      expect(ws.url).toMatch(/\/ws$/)
      expect(ws.url).not.toContain('token=')
      expect(ws.protocols).toBeUndefined()
    })
  })
})
