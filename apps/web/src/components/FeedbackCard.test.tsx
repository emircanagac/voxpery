import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openExternalUrl } from '../openExternalUrl'
import FeedbackCard, { BUG_REPORT_URL, FEATURE_REQUEST_URL } from './FeedbackCard'

vi.mock('../openExternalUrl', () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}))

describe('FeedbackCard', () => {
  beforeEach(() => {
    vi.mocked(openExternalUrl).mockClear()
  })

  it('opens the repository bug report template', () => {
    render(<FeedbackCard />)

    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }))

    expect(openExternalUrl).toHaveBeenCalledWith(BUG_REPORT_URL)
  })

  it('opens the repository feature request template', () => {
    render(<FeedbackCard />)

    fireEvent.click(screen.getByRole('button', { name: 'Request a feature' }))

    expect(openExternalUrl).toHaveBeenCalledWith(FEATURE_REQUEST_URL)
  })
})
