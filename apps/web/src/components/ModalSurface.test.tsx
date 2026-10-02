import { createPortal } from 'react-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ModalSurface from './ModalSurface'

afterEach(() => vi.restoreAllMocks())

describe('ModalSurface', () => {
  it('keeps native form submission, contains focus and restores the opener', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const submit = vi.fn(event => event.preventDefault())
    const view = render(createPortal(<div className="modal-overlay">
      <ModalSurface as="form" name="Create Channel" onSubmit={submit}>
        <input aria-label="Channel name" />
        <button type="submit">Create</button>
      </ModalSurface>
    </div>, document.body))
    const dialog = screen.getByRole('dialog', { name: 'Create Channel' })
    expect(dialog.tagName).toBe('FORM')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('textbox', { name: 'Channel name' })).toHaveFocus()
    expect(opener).toHaveAttribute('inert')
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Create' })).toHaveFocus()
    fireEvent.submit(dialog)
    expect(submit).toHaveBeenCalledOnce()
    view.unmount()
    expect(opener).not.toHaveAttribute('inert')
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
