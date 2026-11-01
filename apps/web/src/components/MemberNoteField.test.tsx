import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userNoteApi } from '../api'
import MemberNoteField from './MemberNoteField'

function mockNote(note: string | null) {
  vi.spyOn(userNoteApi, 'get').mockResolvedValue({ note, updated_at: null })
  return vi.spyOn(userNoteApi, 'save').mockResolvedValue({ note: 'saved', updated_at: null })
}

describe('MemberNoteField', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('loads the note and saves a change on blur', async () => {
    const save = mockNote('first')
    render(<MemberNoteField userId="bob" username="bob" />)
    const input = await screen.findByDisplayValue('first')

    fireEvent.change(input, { target: { value: '  second  ' } })
    fireEvent.blur(input)

    await waitFor(() => expect(save).toHaveBeenCalledWith('bob', 'second', null))
    expect(await screen.findByText('Saved. Only you can see this note.')).toBeInTheDocument()
  })

  it('does not write when nothing changed', async () => {
    const save = mockNote('same')
    render(<MemberNoteField userId="bob" username="bob" />)
    fireEvent.blur(await screen.findByDisplayValue('same'))
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps a change when the profile closes before blur', async () => {
    const save = mockNote('')
    const { unmount } = render(<MemberNoteField userId="bob" username="bob" />)
    const input = await screen.findByPlaceholderText('Add a note about bob')
    await waitFor(() => expect(input).toBeEnabled())

    fireEvent.change(input, { target: { value: 'closing' } })
    unmount()

    expect(save).toHaveBeenCalledWith('bob', 'closing', null)
  })

  it('never overwrites a note it could not load', async () => {
    vi.spyOn(userNoteApi, 'get').mockRejectedValue(new Error('offline'))
    const save = vi.spyOn(userNoteApi, 'save')
    const { unmount } = render(<MemberNoteField userId="bob" username="bob" />)
    expect(await screen.findByText('Could not sync this note. Try again.')).toBeInTheDocument()
    unmount()
    expect(save).not.toHaveBeenCalled()
  })

  it('takes the focus when opened from Add note', async () => {
    mockNote(null)
    render(<MemberNoteField userId="bob" username="bob" autoFocus />)
    const input = await screen.findByPlaceholderText('Add a note about bob')
    await waitFor(() => expect(input).toHaveFocus())
  })
})
