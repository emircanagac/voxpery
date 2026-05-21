import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel } from '../api'
import ChatArea from './ChatArea'

const scrollToIndex = vi.fn()

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getItemKey,
  }: {
    count: number
    getItemKey: (index: number) => string | number
  }) => ({
    getTotalSize: () => count * 120,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: getItemKey(index),
        start: index * 120,
      })),
    measureElement: vi.fn(),
    scrollToIndex,
  }),
}))

const channel = (id: string, name: string): Channel =>
  ({
    id,
    name,
    channel_type: 'text',
  }) as Channel

const message = (id: string, content: string, createdAtMinute: number) => ({
  id,
  channel_id: 'general',
  content,
  created_at: `2026-05-21T10:${createdAtMinute.toString().padStart(2, '0')}:00.000Z`,
  author: {
    user_id: 'user-1',
    username: 'admin',
  },
})

function setScrollableMetrics(el: HTMLDivElement | null) {
  if (!el) return
  Object.defineProperties(el, {
    clientHeight: {
      configurable: true,
      value: 360,
    },
    scrollHeight: {
      configurable: true,
      value: 1440,
    },
  })
}

function renderChatArea(overrides?: Partial<React.ComponentProps<typeof ChatArea>>) {
  return render(
    <ChatArea
      activeChannel={channel('general', 'general')}
      messages={[message('message-1', 'hello', 0), message('message-2', 'latest', 1)]}
      draftAttachments={[]}
      messageInput=""
      onPickAttachments={vi.fn()}
      onRemoveAttachment={vi.fn()}
      onMessageInputChange={vi.fn()}
      onSendMessage={vi.fn()}
      onRetryMessage={vi.fn()}
      onScrollRefReady={setScrollableMetrics}
      {...overrides}
    />
  )
}

describe('ChatArea regressions', () => {
  beforeEach(() => {
    scrollToIndex.mockClear()
  })

  it('re-anchors switched channels to their latest rendered message', async () => {
    const { rerender } = renderChatArea()

    await waitFor(() => {
      expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    })

    scrollToIndex.mockClear()

    rerender(
      <ChatArea
        activeChannel={channel('off-topic', 'off-topic')}
        messages={[message('message-3', 'older', 2), message('message-4', 'newest', 3)]}
        draftAttachments={[]}
        messageInput=""
        onPickAttachments={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onMessageInputChange={vi.fn()}
        onSendMessage={vi.fn()}
        onRetryMessage={vi.fn()}
        onScrollRefReady={setScrollableMetrics}
      />
    )

    await waitFor(() => {
      expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    })
  })

  it('keeps older-message pagination out of the latest-message snap path', async () => {
    const onLoadOlder = vi.fn()
    const { rerender } = renderChatArea({
      hasMoreOlder: true,
      onLoadOlder,
    })

    await waitFor(() => {
      expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    })

    scrollToIndex.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Load older messages' }))

    expect(onLoadOlder).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Jump to latest messages' })).toBeInTheDocument()

    rerender(
      <ChatArea
        activeChannel={channel('general', 'general')}
        messages={[
          message('message-0', 'prepended', 0),
          message('message-1', 'hello', 1),
          message('message-2', 'latest', 2),
        ]}
        draftAttachments={[]}
        messageInput=""
        onPickAttachments={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onMessageInputChange={vi.fn()}
        onSendMessage={vi.fn()}
        onRetryMessage={vi.fn()}
        hasMoreOlder
        loadingOlder
        onLoadOlder={onLoadOlder}
        onScrollRefReady={setScrollableMetrics}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('prepended')).toBeInTheDocument()
    })
    expect(scrollToIndex).not.toHaveBeenCalledWith(2, { align: 'end' })
  })

  it('renders inline stickers and GIFs as chat media instead of text links', () => {
    const stickerUrl = 'https://media.example.test/sticker.png'
    const gifUrl = 'https://media.example.test/reaction.gif'

    const { container } = renderChatArea({
      messages: [
        message(
          'message-media',
          `party\n![sticker](${stickerUrl})\n![gif](${gifUrl})`,
          0
        ),
      ],
    })

    expect(screen.getByAltText('Sticker preview')).toHaveAttribute('src')
    expect(screen.getByAltText('GIF preview')).toHaveAttribute('src')
    expect(container.querySelector(`a[href="${stickerUrl}"]`)).toBeNull()
    expect(container.querySelector(`a[href="${gifUrl}"]`)).toBeNull()
  })
})
