import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openExternalUrl } from '../openExternalUrl'
import { isTauri } from '../secureStorage'
import { useToastStore } from '../stores/toast'
import SocialInfoPanel, { ProjectSupportLink } from './SocialInfoPanel'

vi.mock('../openExternalUrl', () => ({ openExternalUrl: vi.fn() }))
vi.mock('../secureStorage', () => ({ isTauri: vi.fn() }))

describe('SocialInfoPanel', () => {
  beforeEach(() => {
    vi.mocked(openExternalUrl).mockReset().mockResolvedValue(undefined)
    vi.mocked(isTauri).mockReturnValue(false)
    useToastStore.setState({ toasts: [] })
  })

  it('exposes three compact actions and delegates community navigation', () => {
    const onOpenCommunity = vi.fn()
    render(<SocialInfoPanel onOpenCommunity={onOpenCommunity} />, { wrapper: MemoryRouter })

    expect(screen.getByRole('heading', { name: 'Friend Activity' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Voxpery' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Voxpery resources' }).children).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Community' }))
    expect(onOpenCommunity).toHaveBeenCalledOnce()
    expect(openExternalUrl).not.toHaveBeenCalled()
    expect(screen.queryByText('What is Voxpery?')).toBeNull()
    expect(screen.queryByText('Share feedback on GitHub')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Support Voxpery' })).toBeNull()
  })

  it('opens GitHub through the external-link helper without local navigation', () => {
    render(<SocialInfoPanel onOpenCommunity={vi.fn()} />, { wrapper: MemoryRouter })
    const link = screen.getByRole('link', { name: 'Star on GitHub' })
    expect(link.getAttribute('href')).toBe('https://github.com/emircanagac/voxpery')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(fireEvent.click(link)).toBe(false)
    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/emircanagac/voxpery')
  })

  it.each([false, true])('keeps the existing About destination when desktop is %s', (desktop) => {
    vi.mocked(isTauri).mockReturnValue(desktop)
    render(<SocialInfoPanel onOpenCommunity={vi.fn()} />, { wrapper: MemoryRouter })
    fireEvent.click(screen.getByRole('link', { name: 'About Voxpery' }))
    expect(openExternalUrl).toHaveBeenCalledWith(desktop
      ? 'https://voxpery.com/about'
      : new URL('/about', window.location.origin).href)
  })

  it('provides only one support link for the separate footer', () => {
    render(<ProjectSupportLink />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0].textContent).toBe('Support Voxpery')
    fireEvent.click(links[0])
    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/sponsors/emircanagac')
  })

  it('reports external opening failures without an unhandled rejection', async () => {
    vi.mocked(openExternalUrl).mockRejectedValueOnce(new Error('Opener unavailable'))
    render(<ProjectSupportLink />)
    fireEvent.click(screen.getByRole('link', { name: 'Support Voxpery' }))
    await waitFor(() => expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ level: 'error', title: 'Could not open Support Voxpery' }),
    ]))
  })
})
