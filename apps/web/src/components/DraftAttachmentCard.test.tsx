import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAttachmentUrl } from '../api'
import { applyUploadedDraftAttachments, getUploadedDraftAttachments, type DraftAttachmentItem } from '../draftAttachments'
import DraftAttachmentCard from './DraftAttachmentCard'

vi.mock('../api', () => ({ resolveAttachmentUrl: vi.fn() }))
const createObjectURL = vi.fn(() => 'blob:local-preview')
const revokeObjectURL = vi.fn()
const item: DraftAttachmentItem = {
  localId: 'local-photo', name: 'photo.png', type: 'image/png', size: 2048, url: '',
  file: new File(['test'], 'photo.png', { type: 'image/png' }), uploadStatus: 'uploading',
}

describe('draft attachment cards', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    })
    vi.clearAllMocks()
    vi.mocked(resolveAttachmentUrl).mockResolvedValue('blob:uploaded-preview')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('retains the local preview after upload without serializing the File into a message', () => {
    const { rerender, unmount } = render(<DraftAttachmentCard attachment={item} onRemove={vi.fn()} />)
    const [uploaded] = applyUploadedDraftAttachments([item], [item.localId], [{
      id: 'uploaded-photo', name: item.name, url: '/unlinked-upload', size: item.size, type: item.type,
    }])
    expect(uploaded.file).toBe(item.file)
    rerender(<DraftAttachmentCard attachment={uploaded} onRemove={vi.fn()} />)
    expect(screen.getByAltText('Preview of photo.png')).toHaveAttribute('src', 'blob:local-preview')
    expect(resolveAttachmentUrl).not.toHaveBeenCalled()
    expect(getUploadedDraftAttachments([uploaded])[0]).not.toHaveProperty('file')
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview')
  })

  it('shows a local image and indeterminate upload, then releases local and resolved previews', async () => {
    const { rerender, unmount } = render(<DraftAttachmentCard attachment={item} onRemove={vi.fn()} />)
    expect(screen.getByAltText('Preview of photo.png')).toHaveAttribute('src', 'blob:local-preview')
    expect(screen.getByRole('progressbar', { name: 'Uploading photo.png' })).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    rerender(<DraftAttachmentCard attachment={{ ...item, file: undefined, url: '/uploaded', uploadStatus: 'uploaded' }} onRemove={vi.fn()} />)
    await waitFor(() => expect(screen.getByAltText('Preview of photo.png')).toHaveAttribute('src', 'blob:uploaded-preview'))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview')
    expect(screen.getByText('Ready to send')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:uploaded-preview')
  })

  it('does not preview non-raster files and keeps retry/remove accessible', () => {
    const retry = vi.fn()
    const remove = vi.fn()
    render(<DraftAttachmentCard attachment={{ ...item, type: 'image/svg+xml', name: 'unsafe.svg', uploadStatus: 'failed', uploadError: 'Try again' }} onRemove={remove} onRetry={retry} />)
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Try again')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry upload of unsafe.svg' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment unsafe.svg' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('revokes a late authenticated blob result after the card was removed', async () => {
    let resolve!: (url: string) => void
    vi.mocked(resolveAttachmentUrl).mockReturnValue(new Promise(done => { resolve = done }))
    const { unmount } = render(<DraftAttachmentCard attachment={{ ...item, file: undefined, url: '/uploaded', uploadStatus: 'uploaded' }} onRemove={vi.fn()} />)
    unmount()
    await act(async () => resolve('blob:late-result'))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:late-result')
  })

  it('uses a file fallback if an image cannot load without changing upload success', () => {
    render(<DraftAttachmentCard attachment={{ ...item, uploadStatus: 'uploaded' }} onRemove={vi.fn()} />)
    fireEvent.error(screen.getByAltText('Preview of photo.png'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Ready to send')).toBeInTheDocument()
  })
})
