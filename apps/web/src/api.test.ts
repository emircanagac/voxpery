import { describe, it, expect } from 'vitest'
import { getAuthErrorMessage, isAuthError } from './api'

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
})
