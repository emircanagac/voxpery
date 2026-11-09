import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useChannelSubscriptions } from './useChannelSubscriptions'

type Props = { ids: string[]; connected: boolean }

function setup(initial: Props) {
  const send = vi.fn()
  const hook = renderHook(({ ids, connected }: Props) => useChannelSubscriptions(ids, connected, send), {
    initialProps: initial,
  })
  return { send, ...hook }
}

describe('useChannelSubscriptions', () => {
  it('subscribes once, then only sends the difference', () => {
    const { send, rerender } = setup({ ids: ['a', 'b'], connected: true })
    expect(send.mock.calls).toEqual([['Subscribe', { channel_ids: ['a', 'b'] }]])

    send.mockClear()
    rerender({ ids: ['b', 'c'], connected: true })
    expect(send.mock.calls).toEqual([
      ['Unsubscribe', { channel_ids: ['a'] }],
      ['Subscribe', { channel_ids: ['c'] }],
    ])
  })

  it('sends nothing when the list is only reordered or rebuilt', () => {
    const { send, rerender } = setup({ ids: ['a', 'b'], connected: true })
    send.mockClear()
    rerender({ ids: ['b', 'a'], connected: true })
    rerender({ ids: ['a', 'b', 'a'], connected: true })
    expect(send).not.toHaveBeenCalled()
  })

  it('subscribes everything again after a reconnect', () => {
    const { send, rerender } = setup({ ids: ['a', 'b'], connected: true })
    rerender({ ids: ['a', 'b'], connected: false })
    send.mockClear()
    rerender({ ids: ['a', 'b'], connected: true })
    expect(send.mock.calls).toEqual([['Subscribe', { channel_ids: ['a', 'b'] }]])
  })

  it('waits for the connection and unsubscribes on unmount', () => {
    const { send, rerender, unmount } = setup({ ids: ['a'], connected: false })
    expect(send).not.toHaveBeenCalled()
    rerender({ ids: ['a'], connected: true })
    send.mockClear()
    unmount()
    expect(send.mock.calls).toEqual([['Unsubscribe', { channel_ids: ['a'] }]])
  })
})
