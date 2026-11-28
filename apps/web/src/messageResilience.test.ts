import { describe, expect, it } from 'vitest'
import { applyIncomingMessage, createSendQueue, mergeLatestPageWithHistory, reconcileConfirmedMessage, withoutFailedDuplicates } from './messageResilience'

type TestMessage = {
  id: string
  created_at: string
  content: string
  clientId?: string
  clientStatus?: 'sending' | 'failed'
}

const created_at = '2026-05-12T12:00:00.000Z'

const at = (minute: number) => `2026-05-12T12:${String(minute).padStart(2, '0')}:00.000Z`
const row = (id: string, minute: number): TestMessage => ({ id, created_at: at(minute), content: id })

describe('mergeLatestPageWithHistory', () => {
  it('keeps loaded older history when the latest page connects to it', () => {
    const cached = [row('m1', 1), row('m2', 2), row('m3', 3), row('m4', 4)]
    const latest = [row('m3', 3), row('m4', 4), row('m5', 5)]
    expect(mergeLatestPageWithHistory(latest, cached).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
  })

  it('replaces the cache when the latest page does not connect to it', () => {
    const cached = [row('m1', 1), row('m2', 2)]
    const latest = [row('m8', 8), row('m9', 9)]
    expect(mergeLatestPageWithHistory(latest, cached).map((m) => m.id)).toEqual(['m8', 'm9'])
  })

  it('keeps retryable local messages once and drops stale optimistic rows from older history', () => {
    const failed: TestMessage = { ...row('local', 6), clientId: 'c1', clientStatus: 'failed' }
    const cached = [row('m1', 1), row('m2', 2), failed]
    const latest = [row('m2', 2), row('m3', 3)]
    expect(mergeLatestPageWithHistory(latest, cached).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'local'])
  })
})

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

describe('withoutFailedDuplicates', () => {
  const base = { created_at: '2026-10-17T10:00:00Z', attachments: [] as unknown[] }
  it('drops only failed messages with the same text and attachments', () => {
    const messages = [
      { ...base, id: 'sent', content: 'hello' },
      { ...base, id: 'failed-same', content: 'hello', clientId: 'a', clientStatus: 'failed' as const },
      { ...base, id: 'failed-other', content: 'other', clientId: 'b', clientStatus: 'failed' as const },
      { ...base, id: 'sending-same', content: 'hello', clientId: 'c', clientStatus: 'sending' as const },
    ]
    expect(withoutFailedDuplicates(messages, 'hello', []).map(m => m.id)).toEqual(['sent', 'failed-other', 'sending-same'])
  })
})

describe('applyIncomingMessage', () => {
  type DmMessage = TestMessage & { author: { user_id: string }; attachments?: unknown[] }
  const me = 'user-me'
  const pending = (clientId: string, content: string): DmMessage => ({
    id: `local-${clientId}`, created_at, content, clientId, clientStatus: 'sending', author: { user_id: me },
  })
  const confirmed = (id: string, content: string, userId = me): DmMessage => ({
    id, created_at, content, author: { user_id: userId },
  })

  it('replaces only the copy whose request id the event echoes while an earlier send is slow', () => {
    const slow = pending('slow', 'first')
    const quick = pending('quick', 'second')
    let messages = applyIncomingMessage([slow, quick], confirmed('m2', 'second'), 'quick', me)
    // Stored messages come first; the copy still sending waits at the end, where the server will
    // store it.
    expect(messages.map((m) => m.id)).toEqual(['m2', 'local-slow'])

    // The quick request's own response is then a no-op, and the slow one can still fail visibly.
    messages = reconcileConfirmedMessage(messages, 'quick', confirmed('m2', 'second'))
    messages = messages.map((m) => (m.clientId === 'slow' ? { ...m, clientStatus: 'failed' as const } : m))
    expect(messages.map((m) => [m.id, m.clientStatus])).toEqual([['m2', undefined], ['local-slow', 'failed']])
  })

  it('adds a message from another session of the same user', () => {
    const messages = applyIncomingMessage([pending('local', 'mine')], confirmed('m9', 'from phone'), 'phone-request', me)
    expect(messages.map((m) => m.id)).toEqual(['m9', 'local-local'])
  })

  it('falls back to text and attachment count when the server sends no request id', () => {
    const messages = applyIncomingMessage(
      [pending('a', 'first'), pending('b', 'second')],
      confirmed('m2', 'second'),
      undefined,
      me,
    )
    expect(messages.map((m) => m.id)).toEqual(['m2', 'local-a'])
  })

  it("never lets another user's message replace a pending copy", () => {
    const messages = applyIncomingMessage([pending('a', 'hi')], confirmed('m3', 'hi', 'user-other'), undefined, me)
    expect(messages.map((m) => m.id)).toEqual(['m3', 'local-a'])
  })

  it('updates a message that is already listed', () => {
    const messages = applyIncomingMessage([confirmed('m1', 'old')], confirmed('m1', 'new'), 'x', me)
    expect(messages.map((m) => m.content)).toEqual(['new'])
  })
})

describe('createSendQueue', () => {
  const deferred = () => {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  it('starts the next send of a conversation only after the previous one finished', async () => {
    const enqueue = createSendQueue()
    const started: string[] = []
    const first = deferred()
    const second = deferred()
    const a = enqueue('channel:1', () => { started.push('a'); return first.promise })
    const b = enqueue('channel:1', () => { started.push('b'); return second.promise })
    const other = enqueue('channel:2', async () => { started.push('other') })
    await other
    expect(started).toEqual(['a', 'other'])

    first.resolve()
    await a
    await Promise.resolve()
    expect(started).toEqual(['a', 'other', 'b'])
    second.resolve()
    await b
  })

  it('does not hold the next send back when the previous one fails', async () => {
    const enqueue = createSendQueue()
    const failing = enqueue('dm:1', async () => { throw new Error('offline') })
    const next = enqueue('dm:1', async () => 'sent')
    await expect(failing).rejects.toThrow('offline')
    await expect(next).resolves.toBe('sent')
  })
})

describe('placing confirmed messages by server time', () => {
  type ChatMessage = TestMessage & { author: { user_id: string } }
  const me = 'user-me'
  const stored = (id: string, minute: number, userId = 'user-other'): ChatMessage => ({
    id, created_at: at(minute), content: id, author: { user_id: userId },
  })
  const sending = (clientId: string, minute: number): ChatMessage => ({
    id: `local-${clientId}`, created_at: at(minute), content: clientId, clientId, clientStatus: 'sending', author: { user_id: me },
  })

  it('moves a confirmed copy to its server time, before stored messages that came later', () => {
    // The client clock said minute 9; the server stored it at minute 3, before the other user's message.
    const messages = reconcileConfirmedMessage(
      [stored('s1', 1), sending('a', 9), stored('s5', 5)],
      'a',
      stored('m-a', 3, me),
    )
    expect(messages.map((m) => m.id)).toEqual(['s1', 'm-a', 's5'])
  })

  it('keeps copies still sending after the confirmed ones, in the order they were written', () => {
    let messages = [stored('s1', 1), sending('a', 2), sending('b', 2), sending('c', 2)]
    messages = reconcileConfirmedMessage(messages, 'a', stored('m-a', 4, me))
    messages = reconcileConfirmedMessage(messages, 'b', stored('m-b', 5, me))
    expect(messages.map((m) => m.id)).toEqual(['s1', 'm-a', 'm-b', 'local-c'])
    messages = reconcileConfirmedMessage(messages, 'c', stored('m-c', 6, me))
    expect(messages.map((m) => m.id)).toEqual(['s1', 'm-a', 'm-b', 'm-c'])
  })

  it('places a message from someone else among the stored ones, above copies still sending', () => {
    const messages = applyIncomingMessage([stored('s1', 1), sending('a', 2)], stored('x', 3), null, me)
    expect(messages.map((m) => m.id)).toEqual(['s1', 'x', 'local-a'])
  })
})
