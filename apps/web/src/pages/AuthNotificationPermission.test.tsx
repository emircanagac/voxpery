import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '../api'
import { useFeatureStore } from '../stores/features'
import LoginPage from './LoginPage'
import RegisterPage from './RegisterPage'

const authApiMocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
}))

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      login: authApiMocks.login,
      register: authApiMocks.register,
    },
  }
})

const authUser: User = {
  id: 'auth-user',
  username: 'auth_user',
  email: 'auth@example.test',
  email_verified: true,
  status: 'online',
}

const originalNotificationDescriptor = Object.getOwnPropertyDescriptor(window, 'Notification')

function renderAuthPage(page: 'login' | 'register') {
  return render(
    <MemoryRouter initialEntries={[`/${page}`]}>
      {page === 'login' ? <LoginPage /> : <RegisterPage />}
    </MemoryRouter>,
  )
}

describe('auth notification permission behavior', () => {
  let requestPermission: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    useFeatureStore.setState({
      features: {
        google_oauth_enabled: false,
        observability_enabled: false,
        email_delivery_enabled: false,
        email_verification_enabled: false,
        email_verification_required: false,
        password_reset_enabled: false,
      },
      loading: false,
      error: null,
    })
    requestPermission = vi.fn().mockResolvedValue('granted')
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission,
      },
    })
    authApiMocks.login.mockResolvedValue({ token: 'login-token', user: authUser })
    authApiMocks.register.mockResolvedValue({ token: 'register-token', user: authUser })
  })

  afterEach(() => {
    useFeatureStore.setState({ features: null, loading: false, error: null })
    if (originalNotificationDescriptor) {
      Object.defineProperty(window, 'Notification', originalNotificationDescriptor)
    } else {
      Reflect.deleteProperty(window, 'Notification')
    }
  })

  it('does not request notification permission during login', async () => {
    renderAuthPage('login')

    fireEvent.change(screen.getByPlaceholderText('you@example.com or your_username'), {
      target: { value: 'auth@example.test' },
    })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(authApiMocks.login).toHaveBeenCalledTimes(1))
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('does not request notification permission during registration', async () => {
    renderAuthPage('register')

    fireEvent.change(screen.getByPlaceholderText('your_username'), {
      target: { value: 'auth_user' },
    })
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'auth@example.test' },
    })
    const passwordInputs = screen.getAllByPlaceholderText('••••••••')
    fireEvent.change(passwordInputs[0], { target: { value: 'password-123' } })
    fireEvent.change(passwordInputs[1], { target: { value: 'password-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))

    await waitFor(() => expect(authApiMocks.register).toHaveBeenCalledTimes(1))
    expect(requestPermission).not.toHaveBeenCalled()
  })
})
