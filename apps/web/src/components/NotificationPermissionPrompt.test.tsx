import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationPermissionPrompt from './NotificationPermissionPrompt'

const originalNotificationDescriptor = Object.getOwnPropertyDescriptor(window, 'Notification')

function installNotification(permission: NotificationPermission, nextPermission = permission) {
  const requestPermission = vi.fn().mockResolvedValue(nextPermission)
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: {
      permission,
      requestPermission,
    },
  })
  return requestPermission
}

describe('NotificationPermissionPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.clear()
    if (originalNotificationDescriptor) {
      Object.defineProperty(window, 'Notification', originalNotificationDescriptor)
    } else {
      Reflect.deleteProperty(window, 'Notification')
    }
  })

  it('waits for product readiness and explicit user intent before requesting permission', async () => {
    const requestPermission = installNotification('default', 'granted')
    const { rerender } = render(<NotificationPermissionPrompt ready={false} delayMs={1_000} />)

    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.queryByRole('region', { name: 'Enable notifications' })).not.toBeInTheDocument()
    expect(requestPermission).not.toHaveBeenCalled()

    rerender(<NotificationPermissionPrompt ready delayMs={1_000} />)
    act(() => vi.advanceTimersByTime(999))
    expect(screen.queryByRole('region', { name: 'Enable notifications' })).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('region', { name: 'Enable notifications' })).toBeInTheDocument()
    expect(requestPermission).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await act(async () => Promise.resolve())

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('voxpery-settings-push-enabled')).toBe('1')
    expect(localStorage.getItem('voxpery-settings-push-explicit')).toBe('1')
    expect(screen.queryByRole('region', { name: 'Enable notifications' })).not.toBeInTheDocument()
  })

  it('snoozes the soft prompt without opening the native permission dialog', () => {
    const requestPermission = installNotification('default')
    const { unmount } = render(<NotificationPermissionPrompt ready delayMs={0} />)

    act(() => vi.runOnlyPendingTimers())
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))

    expect(requestPermission).not.toHaveBeenCalled()
    expect(Number(localStorage.getItem('voxpery-push-prompt-snoozed-until'))).toBeGreaterThan(Date.now())
    unmount()

    render(<NotificationPermissionPrompt ready delayMs={0} />)
    act(() => vi.runOnlyPendingTimers())
    expect(screen.queryByRole('region', { name: 'Enable notifications' })).not.toBeInTheDocument()
  })

  it('does not offer the prompt after a notification preference was explicitly chosen', () => {
    installNotification('default')
    localStorage.setItem('voxpery-settings-push-explicit', '1')

    render(<NotificationPermissionPrompt ready delayMs={0} />)
    act(() => vi.runOnlyPendingTimers())

    expect(screen.queryByRole('region', { name: 'Enable notifications' })).not.toBeInTheDocument()
  })

  it('waits for focus when the delay elapses in the background', () => {
    installNotification('default')
    vi.mocked(document.hasFocus).mockReturnValue(false)
    render(<NotificationPermissionPrompt ready delayMs={1_000} />)

    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.queryByRole('region', { name: 'Enable notifications' })).not.toBeInTheDocument()

    vi.mocked(document.hasFocus).mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('focus')))
    expect(screen.getByRole('region', { name: 'Enable notifications' })).toBeInTheDocument()
  })
})
