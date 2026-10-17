import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '../stores/auth'
import NotFoundPage from './NotFoundPage'

afterEach(() => {
  useAuthStore.setState({ user: null })
})

describe('NotFoundPage', () => {
  it('explains the missing page and links signed-out visitors to the landing page', () => {
    useAuthStore.setState({ user: null })
    render(<MemoryRouter><NotFoundPage /></MemoryRouter>)

    expect(screen.getByRole('main')).toHaveClass('auth-page')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
  })

  it('links signed-in users back to the app', () => {
    useAuthStore.setState({ user: { id: 'user-1', username: 'local' } as never })
    render(<MemoryRouter><NotFoundPage /></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Back to Voxpery' })).toHaveAttribute('href', '/social')
  })
})
