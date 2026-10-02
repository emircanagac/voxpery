import { useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDialogFocus } from './useDialogFocus'

function Dialog({ name, owned, fallback }: { name: string; owned?: boolean; fallback?: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, true, owned ? portalRef : undefined, fallback)
  return createPortal(<div className="modal-overlay">
    <div ref={ref} role="dialog" aria-label={name} tabIndex={-1}>
      <button>{name} first</button>
      <button disabled>Disabled</button>
      <button>{name} last</button>
    </div>
    {owned && createPortal(<div ref={portalRef}><button>Device option</button></div>, document.body)}
  </div>, document.body)
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
})
afterEach(() => vi.restoreAllMocks())

describe('dialog focus', () => {
  it('contains Tab and programmatic focus, makes the background inert, and restores focus', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const view = render(<Dialog name="Settings" />)
    expect(screen.getByText('Settings first')).toHaveFocus()
    expect(trigger).toHaveAttribute('inert')
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('Settings last')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('Settings first')).toHaveFocus()
    trigger.focus()
    expect(screen.getByText('Settings first')).toHaveFocus()
    view.unmount()
    expect(trigger).not.toHaveAttribute('inert')
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('limits focus to the nested dialog and returns to the parent trigger', () => {
    const view = render(<><Dialog name="Settings" /></>)
    screen.getByText('Settings last').focus()
    view.rerender(<><Dialog name="Settings" /><Dialog name="Password" /></>)
    expect(screen.getByText('Password first')).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Settings', hidden: true }).closest('.modal-overlay')).toHaveAttribute('inert')
    view.rerender(<><Dialog name="Settings" /></>)
    expect(screen.getByText('Settings last')).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Settings' }).closest('.modal-overlay')).not.toHaveAttribute('inert')
  })

  it('preserves existing inert state and releases it correctly when all nested dialogs unmount', () => {
    const locked = document.createElement('div')
    locked.setAttribute('inert', '')
    const background = document.createElement('div')
    document.body.append(locked, background)
    const view = render(<><Dialog name="Settings" /><Dialog name="Delete" /></>)
    view.unmount()
    expect(locked).toHaveAttribute('inert')
    expect(background).not.toHaveAttribute('inert')
    locked.remove()
    background.remove()
  })

  it('keeps an owned device portal interactive and includes it in the Tab cycle', () => {
    render(<Dialog name="Voice" owned />)
    const option = screen.getByText('Device option')
    expect(option.closest('[inert]')).toBeNull()
    option.focus()
    expect(option).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('Voice first')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(option).toHaveFocus()
  })

  it('returns to a logical entry point when the original profile-dialog trigger was removed', () => {
    const entry = document.createElement('button')
    const transient = document.createElement('button')
    document.body.append(entry, transient)
    transient.focus()
    const view = render(<Dialog name="Settings" fallback={{ current: entry }} />)
    transient.remove()
    view.unmount()
    expect(entry).not.toHaveAttribute('inert')
    expect(entry).toHaveFocus()
    entry.remove()
  })
})
