import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceChannelDuration from './VoiceChannelDuration'

describe('VoiceChannelDuration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'))
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('updates the timer without rerendering its parent or announcing every second', () => {
    let renders = 0
    const startedAt = Date.now() - 59_000
    function Parent() { renders++; return <VoiceChannelDuration startedAt={startedAt} /> }
    render(<Parent />)
    expect(screen.getByRole('timer')).toHaveTextContent('0:59')
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('timer')).toHaveTextContent('1:00')
    expect(screen.getByRole('timer')).toHaveAttribute('aria-live', 'off')
    expect(renders).toBe(1)
  })

  it('pauses background updates and catches up from wall-clock time on return', () => {
    render(<VoiceChannelDuration startedAt={Date.now()} />)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.advanceTimersByTime(70_000))
    expect(screen.getByRole('timer')).toHaveTextContent('0:00')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(screen.getByRole('timer')).toHaveTextContent('1:10')
    expect(vi.getTimerCount()).toBe(1)
  })

  it('cleans up its interval and formats hour rollover', () => {
    const { unmount } = render(<VoiceChannelDuration startedAt={Date.now() - 3_599_000} />)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('timer')).toHaveTextContent('1:00:00')
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
