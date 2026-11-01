import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopUpdateNotice from './DesktopUpdateNotice'
import { checkForUpdates, downloadAndInstallUpdate, type UpdateProgress } from '../updater'

vi.mock('../updater', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../updater')>()),
  checkForUpdates: vi.fn(),
  downloadAndInstallUpdate: vi.fn(),
}))

describe('DesktopUpdateNotice', () => {
  beforeEach(() => {
    vi.mocked(checkForUpdates).mockReset()
    vi.mocked(downloadAndInstallUpdate).mockReset()
  })

  it('stays hidden when there is no update', async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({ available: false })
    const { container } = render(<DesktopUpdateNotice />)

    await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('offers the update and shows the download progress', async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({ available: true, version: '0.5.1' })
    let report: (progress: UpdateProgress) => void = () => {}
    vi.mocked(downloadAndInstallUpdate).mockImplementation((onProgress) => {
      report = onProgress ?? report
      return new Promise(() => {})
    })
    render(<DesktopUpdateNotice />)

    expect(await screen.findByText('Voxpery 0.5.1 is available.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(downloadAndInstallUpdate).toHaveBeenCalledTimes(1)

    report({ phase: 'downloading', percent: 42 })
    expect(await screen.findByRole('button', { name: 'Downloading 42%' })).toBeDisabled()
  })
})
