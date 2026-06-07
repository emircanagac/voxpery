import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    vi.useRealTimers()
    scrollToIndex.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('auto-loads older messages near the top without snapping to latest', async () => {
    const onLoadOlder = vi.fn()
    const { container, rerender } = renderChatArea({
      hasMoreOlder: true,
      onLoadOlder,
    })

    await waitFor(() => {
      expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    })

    scrollToIndex.mockClear()
    const scroller = container.querySelector('.chat-messages') as HTMLDivElement
    scroller.scrollTop = 72
    fireEvent.scroll(scroller)

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

  it('cancels pending latest anchoring when the user manually scrolls after a channel switch', () => {
    vi.useFakeTimers()
    const { container, rerender, unmount } = renderChatArea()

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
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

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    scrollToIndex.mockClear()

    const scroller = container.querySelector('.chat-messages') as HTMLDivElement
    scroller.scrollTop = 240
    fireEvent.wheel(scroller, { deltaY: -80 })
    fireEvent.scroll(scroller)

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(scrollToIndex).not.toHaveBeenCalled()
    unmount()
    vi.useRealTimers()
  })

  it('keeps a switched channel pending until its messages arrive', () => {
    vi.useFakeTimers()
    const { rerender, unmount } = renderChatArea()

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    scrollToIndex.mockClear()

    rerender(
      <ChatArea
        activeChannel={channel('off-topic', 'off-topic')}
        messages={[]}
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

    act(() => {
      vi.advanceTimersByTime(1200)
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

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    unmount()
    vi.useRealTimers()
  })

  it('keeps channel-switch latest anchoring through passive scroll events from list changes', () => {
    vi.useFakeTimers()
    const { container, rerender, unmount } = renderChatArea()

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    scrollToIndex.mockClear()

    const scroller = container.querySelector('.chat-messages') as HTMLDivElement
    scroller.scrollTop = 240
    fireEvent.wheel(scroller, { deltaY: -80 })
    fireEvent.scroll(scroller)

    rerender(
      <ChatArea
        activeChannel={channel('off-topic', 'off-topic')}
        messages={[]}
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

    scroller.scrollTop = 120
    fireEvent.scroll(scroller)

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

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    unmount()
    vi.useRealTimers()
  })

  it('does not re-lock to latest when the user scrolls slightly upward near the bottom', () => {
    const { container, rerender } = renderChatArea()

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    scrollToIndex.mockClear()

    const scroller = container.querySelector('.chat-messages') as HTMLDivElement
    scroller.scrollTop = 1060
    fireEvent.wheel(scroller, { deltaY: -24 })
    fireEvent.scroll(scroller)

    rerender(
      <ChatArea
        activeChannel={channel('general', 'general')}
        messages={[
          message('message-1', 'hello', 0),
          message('message-2', 'latest', 1),
          message('message-3', 'new arrival', 2),
        ]}
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

    expect(scrollToIndex).not.toHaveBeenCalledWith(2, { align: 'end' })
    expect(screen.getByRole('button', { name: 'Jump to latest messages' })).toBeInTheDocument()
  })

  it('does not re-lock to latest when a pointer drag scrolls upward near the bottom', () => {
    const { container, rerender } = renderChatArea()

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    scrollToIndex.mockClear()

    const scroller = container.querySelector('.chat-messages') as HTMLDivElement
    fireEvent.pointerDown(scroller)
    scroller.scrollTop = 1060
    fireEvent.scroll(scroller)

    rerender(
      <ChatArea
        activeChannel={channel('general', 'general')}
        messages={[
          message('message-1', 'hello', 0),
          message('message-2', 'latest', 1),
          message('message-3', 'new arrival', 2),
        ]}
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

    expect(scrollToIndex).not.toHaveBeenCalledWith(2, { align: 'end' })
    expect(screen.getByRole('button', { name: 'Jump to latest messages' })).toBeInTheDocument()
  })

  it('does not re-lock to latest when scrollbar movement scrolls upward during latest anchoring', () => {
    const { container, rerender } = renderChatArea()

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    scrollToIndex.mockClear()

    const scroller = container.querySelector('.chat-messages') as HTMLDivElement
    scroller.scrollTop = 1060
    fireEvent.scroll(scroller)

    rerender(
      <ChatArea
        activeChannel={channel('general', 'general')}
        messages={[
          message('message-1', 'hello', 0),
          message('message-2', 'latest', 1),
          message('message-3', 'new arrival', 2),
        ]}
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

    expect(scrollToIndex).not.toHaveBeenCalledWith(2, { align: 'end' })
    expect(screen.getByRole('button', { name: 'Jump to latest messages' })).toBeInTheDocument()
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
    expect(screen.getByAltText('Sticker preview')).toHaveAttribute('loading', 'eager')
    expect(screen.getByAltText('Sticker preview')).toHaveAttribute('width', '120')
    expect(screen.getByAltText('GIF preview')).toHaveAttribute('src')
    expect(screen.getByAltText('GIF preview')).toHaveAttribute('loading', 'eager')
    expect(screen.getByAltText('GIF preview')).toHaveAttribute('width', '320')
    expect(container.querySelector(`a[href="${stickerUrl}"]`)).toBeNull()
    expect(container.querySelector(`a[href="${gifUrl}"]`)).toBeNull()
  })

  it('renders image attachments with stable eager preview sizing', () => {
    renderChatArea({
      messages: [
        {
          ...message('message-image', 'screenshot', 0),
          attachments: [
            {
              url: 'https://cdn.example.test/screenshot.png',
              type: 'image/png',
              name: 'screenshot.png',
            },
          ],
        },
      ],
    })

    const preview = screen.getByAltText('screenshot.png')
    expect(preview).toHaveAttribute('loading', 'eager')
    expect(preview).toHaveAttribute('decoding', 'async')
    expect(preview).toHaveAttribute('width', '320')
    expect(preview).toHaveAttribute('height', '180')
  })
})
