import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from './toast'

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const toast of useToastStore.getState().toasts) {
      useToastStore.getState().dismissToast(toast.id)
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deduplicates an identical visible notification and refreshes its lifetime', () => {
    const notification = { level: 'error' as const, title: 'Voice failed', message: 'Try again.' }
    useToastStore.getState().pushToast(notification, 1_000)
    vi.advanceTimersByTime(800)
    useToastStore.getState().pushToast(notification, 1_000)

    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(800)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(200)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps distinct notifications visible', () => {
    useToastStore.getState().pushToast({ level: 'info', title: 'Saved', message: 'Profile saved.' })
    useToastStore.getState().pushToast({ level: 'error', title: 'Failed', message: 'Profile was not saved.' })
    expect(useToastStore.getState().toasts).toHaveLength(2)
  })
})
