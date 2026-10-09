import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import RegistrationCaptcha from './RegistrationCaptcha'
import { loadTurnstileScript } from '../turnstileScript'

vi.mock('../turnstileScript', () => ({ loadTurnstileScript: vi.fn() }))
vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess, onError, onExpire, injectScript }: {
    onSuccess: (token: string) => void; onError: () => void; onExpire: () => void; injectScript: boolean
  }) => <div data-testid="widget" data-inject-script={String(injectScript)}>
    <button onClick={() => onSuccess('synthetic-test-response')}>Complete test challenge</button>
    <button onClick={onError}>Fail test challenge</button>
    <button onClick={onExpire}>Expire test challenge</button>
  </div>,
}))
beforeEach(() => vi.mocked(loadTurnstileScript).mockReset())
afterEach(() => vi.restoreAllMocks())

it('shows script failure and retries without supplying a token', async () => {
  const onToken = vi.fn()
  vi.mocked(loadTurnstileScript).mockRejectedValueOnce(new Error('CAPTCHA loading timed out.'))
  vi.mocked(loadTurnstileScript).mockResolvedValueOnce(undefined)
  render(<RegistrationCaptcha siteKey="test-key" widgetRef={{ current: undefined }} onToken={onToken} />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading CAPTCHA')
  expect(await screen.findByRole('alert')).toHaveTextContent('timed out')
  expect(onToken).toHaveBeenCalledWith('')
  expect(onToken).not.toHaveBeenCalledWith(expect.stringMatching(/.+/))
  fireEvent.click(screen.getByRole('button', { name: 'Retry CAPTCHA' }))
  await screen.findByTestId('widget')
  expect(screen.getByTestId('widget')).toHaveAttribute('data-inject-script', 'false')
  expect(loadTurnstileScript).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'Complete test challenge' }))
  expect(onToken).toHaveBeenLastCalledWith('synthetic-test-response')
  fireEvent.click(screen.getByRole('button', { name: 'Expire test challenge' }))
  expect(onToken).toHaveBeenLastCalledWith('')
})

it('clears a token after widget error and exposes recovery', async () => {
  const onToken = vi.fn()
  vi.mocked(loadTurnstileScript).mockResolvedValue(undefined)
  render(<RegistrationCaptcha siteKey="test-key" widgetRef={{ current: undefined }} onToken={onToken} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Complete test challenge' }))
  fireEvent.click(screen.getByRole('button', { name: 'Fail test challenge' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('verification failed'))
  expect(onToken).toHaveBeenLastCalledWith('')
  expect(screen.queryByTestId('widget')).not.toBeInTheDocument()
})
