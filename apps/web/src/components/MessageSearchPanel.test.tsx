import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MessageWithAuthor } from '../api'
import MessageSearchPanel from './MessageSearchPanel'

const reply = {
  id: 'm1',
  channel_id: 'c1',
  content: '> @alice: First message here\n\nSounds good to me',
  created_at: '2026-10-17T10:00:00Z',
  author: { user_id: 'u2', username: 'bob', avatar_url: null },
} as unknown as MessageWithAuthor

describe('MessageSearchPanel', () => {
  it('shows reply results without the raw quote prefix', () => {
    render(<MessageSearchPanel query="good" results={[reply]} scopeLabel="#general" onGoToMessage={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Sounds good to me/)).toBeInTheDocument()
    expect(screen.getByText(/Reply to @alice/)).toBeInTheDocument()
    expect(screen.queryByText(/> @alice/)).not.toBeInTheDocument()
  })
})
