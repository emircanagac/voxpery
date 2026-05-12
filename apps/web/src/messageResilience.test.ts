import { describe, expect, it } from 'vitest'
import { reconcileConfirmedMessage } from './messageResilience'

type TestMessage = {
  id: string
  created_at: string
  content: string
  clientId?: string
  clientStatus?: 'sending' | 'failed'
}

const created_at = '2026-05-12T12:00:00.000Z'

describe('messageResilience', () => {
  it('replaces an optimistic message with the confirmed server message id', () => {
    const optimistic: TestMessage = {
      id: 'local-client-1',
      clientId: 'client-1',
      clientStatus: 'sending',
      content: 'hello',
      created_at,
    }
    const confirmed: TestMessage = {
      id: 'server-1',
      content: 'hello',
      created_at,
    }

    expect(reconcileConfirmedMessage([optimistic], 'client-1', confirmed)).toEqual([confirmed])
  })

  it('removes the optimistic copy if realtime already inserted the confirmed message', () => {
    const optimistic: TestMessage = {
      id: 'local-client-1',
      clientId: 'client-1',
      clientStatus: 'sending',
      content: 'hello',
      created_at,
    }
    const confirmed: TestMessage = {
      id: 'server-1',
      content: 'hello',
      created_at,
    }

    expect(reconcileConfirmedMessage([optimistic, confirmed], 'client-1', confirmed)).toEqual([confirmed])
  })
})
