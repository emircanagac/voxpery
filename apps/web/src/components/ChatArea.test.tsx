import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import type { Channel } from '../api'
import ChatArea from './ChatArea'

const scrollToIndex = vi.fn()
const measureVirtualElement = vi.fn()
const measureVirtualizer = vi.fn()
let estimateVirtualRow: ((index: number) => number) | undefined

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getItemKey,
    estimateSize,
  }: {
    count: number
    getItemKey: (index: number) => string | number
    estimateSize: (index: number) => number
  }) => {
    estimateVirtualRow = estimateSize
    return {
      options: { count },
      getTotalSize: () => count * 120,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: getItemKey(index),
          start: index * 120,
        })),
      measureElement: measureVirtualElement,
      measure: measureVirtualizer,
      scrollToIndex,
    }
  },
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

function mockDecodedImages() {
  class MockImage {
    decoding = 'auto'
    complete = true
    naturalWidth = 320
    onload: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null

    set src(_value: string) {
      queueMicrotask(() => this.onload?.(new Event('load')))
    }

    decode() {
      return Promise.resolve()
    }
  }

  vi.stubGlobal('Image', MockImage)
}

describe('ChatArea regressions', () => {
  beforeEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    scrollToIndex.mockClear()
    measureVirtualElement.mockClear()
    measureVirtualizer.mockClear()
    estimateVirtualRow = undefined
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('separates loading and empty search results from an empty conversation', () => {
    const { rerender } = renderChatArea({ messages: [], loading: true })
    expect(screen.queryByText('Welcome to #general!')).not.toBeInTheDocument()
    rerender(<ChatArea activeChannel={channel('general', 'general')} messages={[]} draftAttachments={[]} messageInput="" onPickAttachments={vi.fn()} onRemoveAttachment={vi.fn()} onMessageInputChange={vi.fn()} onSendMessage={vi.fn()} onRetryMessage={vi.fn()} searchQuery="missing" onSearchChange={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('No messages found')
    expect(screen.queryByText('Welcome to #general!')).not.toBeInTheDocument()
  })

  it.each(['Escape', 'Close search'])('restores the remounted search trigger after %s', async (dismiss) => {
    const onSearchChange = vi.fn()
    renderChatArea({ searchQuery: 'hello', onSearchChange })
    const opener = screen.getByRole('button', { name: 'Search in conversation' })
    fireEvent.click(opener)
    const input = screen.getByRole('textbox', { name: 'Search messages' })
    await waitFor(() => expect(input).toHaveFocus())
    expect(opener.isConnected).toBe(false)
    if (dismiss === 'Escape') fireEvent.keyDown(input, { key: 'Escape' })
    else fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    expect(screen.queryByRole('textbox', { name: 'Search messages' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search in conversation' })).toHaveFocus()
    expect(onSearchChange).toHaveBeenLastCalledWith('')
  })

  it('restores the search trigger after dismissing shortcut-opened search', async () => {
    renderChatArea({ onSearchChange: vi.fn() })
    const composer = screen.getByPlaceholderText('Message #general')
    composer.focus()
    fireEvent.keyDown(composer, { key: 'f', ctrlKey: true })
    const input = screen.getByRole('textbox', { name: 'Search messages' })
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Search in conversation' })).toHaveFocus()
  })

  it('does not steal focus when Pins replaces search', async () => {
    renderChatArea({ onSearchChange: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Search in conversation' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Search messages' })).toHaveFocus())
    const pins = screen.getByRole('button', { name: 'Pinned messages' })
    pins.focus()
    fireEvent.click(pins)
    expect(screen.queryByRole('textbox', { name: 'Search messages' })).not.toBeInTheDocument()
    expect(pins).toHaveFocus()
    expect(pins).toHaveAttribute('aria-expanded', 'true')
  })

  it.each(['', '   '])('disables send for an empty draft %j', (messageInput) => {
    const onSendMessage = vi.fn()
    renderChatArea({ messageInput, onSendMessage })
    const send = screen.getByRole('button', { name: 'Send message' })
    expect(send).toBeDisabled()
    fireEvent.click(send)
    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it.each(['uploaded', 'uploading', 'failed'] as const)('keeps attachment-only drafts gated by upload status %s', (uploadStatus) => {
    renderChatArea({ draftAttachments: [{ localId: 'draft', url: '/photo.png', name: 'photo.png', type: 'image/png', size: 42, uploadStatus }] })
    const send = screen.getByRole('button', { name: 'Send message' })
    if (uploadStatus === 'uploaded') expect(send).toBeEnabled()
    else expect(send).toBeDisabled()
  })

  it('caps pasted Unicode text and shows the reply-adjusted character budget', () => {
    const onMessageInputChange = vi.fn()
    renderChatArea({
      messageInput: '',
      onMessageInputChange,
      replyingTo: { id: 'message-1', username: 'alice', contentSnippet: 'hello' },
    })
    const input = screen.getByPlaceholderText('Message #general')
    fireEvent.change(input, { target: { value: '😀'.repeat(4100), selectionStart: 4100 } })
    expect(Array.from(onMessageInputChange.mock.lastCall?.[0] ?? '')).toHaveLength(3983)
    expect(screen.getByLabelText('Characters remaining')).toHaveTextContent('3983')
  })

  it('matches desktop CSS heights for the first avatar row and compact continuation rows', () => {
    const rows = [
      message('message-1', 'first author', 0),
      {
        ...message('message-2', 'new author', 1),
        author: { user_id: 'user-2', username: 'friend' },
      },
      {
        ...message('message-3', 'compact continuation', 2),
        author: { user_id: 'user-2', username: 'friend' },
      },
    ]

    renderChatArea({ messages: rows })

    expect(estimateVirtualRow?.(1)).toBe(53)
    expect(estimateVirtualRow?.(2)).toBe(23)
  })

  it('matches mobile CSS heights before the first virtualizer measurement', () => {
    const rows = [
      message('message-1', 'first author', 0),
      {
        ...message('message-2', 'new author', 1),
        author: { user_id: 'user-2', username: 'friend' },
      },
      {
        ...message('message-3', 'compact continuation', 2),
        author: { user_id: 'user-2', username: 'friend' },
      },
    ]
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })

    renderChatArea({ messages: rows })

    expect(estimateVirtualRow?.(1)).toBe(44)
    expect(estimateVirtualRow?.(2)).toBe(23)
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
    fireEvent.wheel(scroller, { deltaY: -100 })
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
    expect(screen.queryByRole('button', { name: 'Jump to latest messages' })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'Jump to latest messages' })).not.toBeInTheDocument()
  })

  it('keeps latest locked after passive scroll events and same-count content replacement', () => {
    vi.useFakeTimers()
    const { container, rerender, unmount } = renderChatArea()
    act(() => { vi.advanceTimersByTime(1500) })
    const scroller = container.querySelector('.chat-messages') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1481 })
    fireEvent.scroll(scroller)
    expect(screen.queryByRole('button', { name: 'Jump to latest messages' })).not.toBeInTheDocument()
    scrollToIndex.mockClear()
    rerender(<ChatArea activeChannel={channel('general', 'general')}
      messages={[message('message-1', 'replaced with a taller message', 0), message('message-2', 'latest refreshed', 1)]}
      draftAttachments={[]} messageInput="" onPickAttachments={vi.fn()} onRemoveAttachment={vi.fn()}
      onMessageInputChange={vi.fn()} onSendMessage={vi.fn()} onRetryMessage={vi.fn()} />)
    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    expect(scroller.scrollTop).toBe(1121)
    unmount()
  })

  it('does not let queued latest scrolling override a notification target', () => {
    vi.useFakeTimers()
    const { rerender, unmount } = renderChatArea()
    rerender(<ChatArea activeChannel={channel('general', 'general')}
      messages={[message('message-1', 'older target', 0), message('message-2', 'latest', 1)]}
      draftAttachments={[]} messageInput="" onPickAttachments={vi.fn()} onRemoveAttachment={vi.fn()}
      onMessageInputChange={vi.fn()} onSendMessage={vi.fn()} onRetryMessage={vi.fn()}
      onScrollRefReady={setScrollableMetrics} jumpToMessageId="message-1" />)
    scrollToIndex.mockClear()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(scrollToIndex).not.toHaveBeenCalledWith(1, { align: 'end' })
    unmount()
  })

  it('does not re-lock to latest when keyboard input scrolls upward', () => {
    const { container, rerender } = renderChatArea()

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
    scrollToIndex.mockClear()

    const scroller = container.querySelector('.chat-messages') as HTMLDivElement
    fireEvent.keyDown(scroller, { key: 'PageUp' })
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
    expect(screen.queryByRole('button', { name: 'Jump to latest messages' })).not.toBeInTheDocument()
  })

  it('shows the latest arrow only after meaningful history scrolling and avoids threshold flicker', () => {
    const { container } = renderChatArea()
    const scroller = container.querySelector('.chat-messages') as HTMLDivElement
    fireEvent.wheel(scroller, { deltaY: -24 })
    scroller.scrollTop = 1056
    fireEvent.scroll(scroller)
    expect(screen.queryByRole('button', { name: 'Jump to latest messages' })).not.toBeInTheDocument()
    scroller.scrollTop = 910
    fireEvent.scroll(scroller)
    expect(screen.getByRole('button', { name: 'Jump to latest messages' })).toBeInTheDocument()
    scroller.scrollTop = 960
    fireEvent.scroll(scroller)
    expect(screen.getByRole('button', { name: 'Jump to latest messages' })).toBeInTheDocument()
    scroller.scrollTop = 1030
    fireEvent.scroll(scroller)
    expect(screen.queryByRole('button', { name: 'Jump to latest messages' })).not.toBeInTheDocument()
    expect(scroller.scrollTop).toBe(1030)
  })

  it('handles a notification jump only after the target row is visible', async () => {
    const handled = vi.fn()
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('chat-messages')) {
        return { top: 0, bottom: 360, left: 0, right: 800, width: 800, height: 360, x: 0, y: 0, toJSON: () => ({}) }
      }
      if (this.dataset.messageId === 'message-2') {
        return { top: 40, bottom: 100, left: 0, right: 800, width: 800, height: 60, x: 0, y: 40, toJSON: () => ({}) }
      }
      return { top: 400, bottom: 460, left: 0, right: 800, width: 800, height: 60, x: 0, y: 400, toJSON: () => ({}) }
    })

    renderChatArea({
      jumpToMessageId: 'message-2',
      onJumpToMessageHandled: handled,
    })

    await waitFor(() => {
      expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'start', behavior: 'auto' })
      expect(handled).toHaveBeenCalledTimes(1)
    })
    rectSpy.mockRestore()
  })

  it('keeps the unread divider anchored to the original remote message', async () => {
    const localMessage = {
      ...message('message-local', 'my new message', 2),
      author: {
        user_id: 'local-user',
        username: 'local',
      },
    }
    const initialMessages = [
      message('message-read', 'already read', 0),
      message('message-unread', 'first unread', 1),
      localMessage,
    ]
    const { rerender } = renderChatArea({
      messages: initialMessages,
      currentUserId: 'local-user',
      unreadDividerCount: 1,
    })

    await waitFor(() => {
      expect(screen.getByLabelText('New unread messages').closest('[data-message-id]'))
        .toHaveAttribute('data-message-id', 'message-unread')
    })

    const nextLocalMessage = {
      ...message('message-local-2', 'another local message', 3),
      author: {
        user_id: 'local-user',
        username: 'local',
      },
    }
    rerender(
      <ChatArea
        activeChannel={channel('general', 'general')}
        messages={[...initialMessages, nextLocalMessage]}
        draftAttachments={[]}
        messageInput=""
        onPickAttachments={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onMessageInputChange={vi.fn()}
        onSendMessage={vi.fn()}
        onRetryMessage={vi.fn()}
        onScrollRefReady={setScrollableMetrics}
        currentUserId="local-user"
        unreadDividerCount={1}
      />
    )

    expect(screen.getByLabelText('New unread messages').closest('[data-message-id]'))
      .toHaveAttribute('data-message-id', 'message-unread')

    rerender(
      <ChatArea
        activeChannel={channel('general', 'general')}
        messages={[
          message('message-older', 'loaded history', 0),
          ...initialMessages,
          nextLocalMessage,
          message('message-live', 'live arrival while open', 4),
        ]}
        draftAttachments={[]}
        messageInput=""
        onPickAttachments={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onMessageInputChange={vi.fn()}
        onSendMessage={vi.fn()}
        onRetryMessage={vi.fn()}
        onScrollRefReady={setScrollableMetrics}
        currentUserId="local-user"
        unreadDividerCount={1}
      />
    )

    expect(screen.getByLabelText('New unread messages').closest('[data-message-id]'))
      .toHaveAttribute('data-message-id', 'message-unread')
  })

  it('groups emoji, GIF, and sticker selection beside the attachment action', async () => {
    renderChatArea()

    const pickerButton = screen.getByRole('button', { name: 'Emoji, GIFs and stickers' })
    expect(screen.getByRole('button', { name: 'Attach files' }).nextElementSibling?.nextElementSibling).toBe(pickerButton)
    expect(screen.queryByRole('button', { name: 'Browse GIFs' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Browse stickers' })).not.toBeInTheDocument()
    fireEvent.click(pickerButton)
    fireEvent.click(await screen.findByRole('tab', { name: 'GIF' }))
    expect(await screen.findByPlaceholderText('Search GIFs')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Sticker' }))
    expect(await screen.findByPlaceholderText('Search stickers')).toBeInTheDocument()
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

  it('renders image attachments eagerly without forcing a preview aspect ratio', async () => {
    mockDecodedImages()

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

    expect(screen.queryByAltText('screenshot.png')).toBeNull()
    const previewButton = await screen.findByRole('button', { name: 'Preview screenshot.png' })
    const preview = previewButton.querySelector('img') as HTMLImageElement
    expect(preview).toHaveAttribute('loading', 'eager')
    expect(preview).toHaveAttribute('decoding', 'async')
    expect(preview).not.toHaveAttribute('width')
    expect(preview).not.toHaveAttribute('height')
    expect(preview).toHaveAttribute('alt', '')
  })

  it('offers non-image attachments as downloads instead of new tabs', async () => {
    renderChatArea({
      messages: [{
        ...message('message-archive', 'archive', 0),
        attachments: [{
          url: 'https://cdn.example.test/archive.zip',
          type: 'application/zip',
          name: 'archive.zip',
        }],
      }],
    })

    const link = await screen.findByRole('link', { name: 'archive.zip' })
    expect(link).toHaveAttribute('download', 'archive.zip')
    expect(link).not.toHaveAttribute('target')
  })

  it('keeps a decoded attachment and its image node when reaction responses renew its signature', async () => {
    mockDecodedImages()
    const resolve = vi.spyOn(api, 'resolveAttachmentUrl').mockResolvedValue('https://cdn.example.test/stable-preview.png')
    const attachment = { id: 'stable-photo', sha256: 'immutable-content', url: 'http://localhost:3001/api/attachments/content/stable-photo?exp=1&sig=old', type: 'image/png', name: 'stable.png' }
    const row = { ...message('stable-reaction-photo', 'Photo', 0), attachments: [attachment] }
    const { rerender } = renderChatArea({ messages: [row] })
    const image = (await screen.findByRole('button', { name: 'Preview stable.png' })).querySelector('img')!
    rerender(<ChatArea activeChannel={channel('general', 'general')} messages={[{ ...row, attachments: [{ ...attachment, url: attachment.url.replace('exp=1&sig=old', 'exp=2&sig=new') }], reactions: [{ emoji: '👍', count: 1, reacted: true }] }]} messageInput="" draftAttachments={[]} onMessageInputChange={vi.fn()} onRemoveAttachment={vi.fn()} onSendMessage={vi.fn()} onPickAttachments={vi.fn()} onRetryMessage={vi.fn()} />)
    await screen.findByRole('button', { name: /reaction, 1 total/ })
    expect(screen.getByRole('button', { name: 'Preview stable.png' }).querySelector('img')).toBe(image)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('does not merge unrelated external image URLs that happen to have the same attachment id', async () => {
    mockDecodedImages()
    const resolve = vi.spyOn(api, 'resolveAttachmentUrl').mockImplementation(async url => url)
    renderChatArea({ messages: [{ ...message('external-identities', 'Two photos', 0), attachments: [
      { id: 'external-photo', url: 'https://cdn.example.test/photo.png?version=1', type: 'image/png', name: 'one.png' },
      { id: 'external-photo', url: 'https://cdn.example.test/photo.png?version=2', type: 'image/png', name: 'two.png' },
    ] }] })
    await screen.findByRole('button', { name: 'Preview one.png' })
    await screen.findByRole('button', { name: 'Preview two.png' })
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('keeps external signatures distinct even when the URL resembles our attachment API', async () => {
    mockDecodedImages()
    const resolve = vi.spyOn(api, 'resolveAttachmentUrl').mockImplementation(async url => url)
    const attachment = { id: 'external-api-photo', url: 'https://cdn.example.test/api/attachments/content/external-api-photo?exp=1&sig=old', type: 'image/png', name: 'external-signed.png' }
    const row = { ...message('external-signed-identity', 'Photo', 0), attachments: [attachment] }
    const { rerender } = renderChatArea({ messages: [row] })
    await screen.findByRole('button', { name: 'Preview external-signed.png' })
    const nextUrl = attachment.url.replace('exp=1&sig=old', 'exp=2&sig=new')
    rerender(<ChatArea activeChannel={channel('general', 'general')} messages={[{ ...row, attachments: [{ ...attachment, url: nextUrl }] }]} messageInput="" draftAttachments={[]} onMessageInputChange={vi.fn()} onRemoveAttachment={vi.fn()} onSendMessage={vi.fn()} onPickAttachments={vi.fn()} onRetryMessage={vi.fn()} />)
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2))
    expect(resolve).toHaveBeenLastCalledWith(nextUrl, null, expect.any(Object))
    expect(screen.getByRole('button', { name: 'Preview external-signed.png' }).querySelector('img')).toHaveAttribute('src', nextUrl)
  })

  it('keeps the download filename when desktop resolves an attachment to a blob URL', async () => {
    const resolve = vi.spyOn(api, 'resolveAttachmentUrl').mockResolvedValue('blob:desktop-archive')
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe('blob:desktop-archive')
      expect(this.download).toBe('desktop.zip')
    })
    renderChatArea({
      messages: [{
        ...message('message-desktop-archive', 'desktop archive', 0),
        attachments: [{
          url: 'https://api.example.test/desktop.zip',
          type: 'application/zip',
          name: 'desktop.zip',
        }],
      }],
    })

    const link = await screen.findByRole('link', { name: 'desktop.zip' })
    expect(resolve).not.toHaveBeenCalled()
    fireEvent.click(link)
    fireEvent.click(link)
    await screen.findByText('Download started')
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledTimes(1)
    expect(link).toHaveAttribute('download', 'desktop.zip')
  })

  it('shows failed downloads and allows retrying', async () => {
    const resolve = vi.spyOn(api, 'resolveAttachmentUrl')
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce('blob:retry-archive')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderChatArea({ messages: [{
      ...message('archive-retry', 'archive', 0),
      attachments: [{ url: 'https://api.example.test/retry.zip', type: 'application/zip', name: 'retry.zip' }],
    }] })
    const link = await screen.findByRole('link', { name: 'retry.zip' })
    fireEvent.click(link)
    await screen.findByText('Download failed. Click to retry.')
    fireEvent.click(link)
    await screen.findByText('Download started')
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('renders reactions after inline media and attachments', async () => {
    mockDecodedImages()

    const { container } = renderChatArea({
      messages: [
        {
          ...message(
            'message-media-reaction',
            'party\n![gif](https://media.example.test/reaction.gif)',
            0
          ),
          attachments: [
            {
              url: 'https://cdn.example.test/screenshot.png',
              type: 'image/png',
              name: 'screenshot.png',
            },
          ],
          reactions: [{ emoji: '👍', count: 2, reacted: true }],
        },
      ],
      onToggleReaction: vi.fn(),
    })

    await screen.findByRole('button', { name: 'Preview screenshot.png' })
    const messageRow = container.querySelector('[data-message-id="message-media-reaction"]')
    expect(messageRow).not.toBeNull()
    expect(
      Array.from(
        messageRow!.querySelectorAll('.chat-inline-gif-link, .dm-attachments, .message-reactions')
      ).map((element) => element.className)
    ).toEqual(['chat-inline-gif-link', 'dm-attachments', 'message-reactions'])
  })

  it('remeasures every visible row whose reactions change', () => {
    const rows = [
      message('reaction-row-1', 'first', 0),
      message('reaction-row-2', 'second', 1),
      message('reaction-row-3', 'third', 2),
    ]
    const { rerender } = renderChatArea({ messages: rows })
    measureVirtualElement.mockClear()

    rerender(
      <ChatArea
        activeChannel={channel('general', 'general')}
        messages={rows.map((row, index) => ({
          ...row,
          reactions: [{ emoji: ['👍', '❤️', '🎉'][index], count: index + 1, reacted: false }],
        }))}
        draftAttachments={[]}
        messageInput=""
        onPickAttachments={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onMessageInputChange={vi.fn()}
        onSendMessage={vi.fn()}
        onRetryMessage={vi.fn()}
        onScrollRefReady={setScrollableMetrics}
        onToggleReaction={vi.fn()}
      />
    )

    const remeasuredIds = measureVirtualElement.mock.calls
      .map(([element]) => (element as HTMLElement | null)?.dataset.messageId)
      .filter(Boolean)
    expect(remeasuredIds).toEqual(expect.arrayContaining([
      'reaction-row-1',
      'reaction-row-2',
      'reaction-row-3',
    ]))
  })

  it('enlarges emoji-only messages without changing regular message text', () => {
    const { container } = renderChatArea({
      messages: [
        message('emoji-only', '😀', 0),
        message('emoji-in-text', 'Hello 😀', 1),
      ],
    })

    expect(container.querySelector('[data-message-id="emoji-only"] .message-text')).toHaveClass('message-text--emoji-only')
    expect(container.querySelector('[data-message-id="emoji-in-text"] .message-text')).not.toHaveClass('message-text--emoji-only')
  })

  it('shows reaction authors on hover when the API provides them', () => {
    renderChatArea({
      messages: [{
        ...message('reaction-authors', 'Thanks', 0),
        reactions: [{
          emoji: '👍',
          count: 2,
          reacted: false,
          users: [{ username: 'alice' }, { username: 'bob' }],
        }],
      }],
      onToggleReaction: vi.fn(),
    })

    fireEvent.pointerEnter(screen.getByRole('button', { name: /reaction from alice, bob/i }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('alice, bob')
  })

  it('edits multiple lines without saving on Shift+Enter or IME composition', () => {
    const save = vi.fn()
    const cancel = vi.fn()
    const change = vi.fn()
    renderChatArea({ editingMessageId: 'message-1', editingContent: 'hello\nworld', onSaveEdit: save, onCancelEdit: cancel, onEditingContentChange: change })
    const editor = screen.getByRole('textbox', { name: 'Edit message' })
    expect(editor.tagName).toBe('TEXTAREA')
    expect(editor).toHaveValue('hello\nworld')
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(editor, { target: { value: 'edited\ntext' } })
    expect(change).toHaveBeenCalledWith('edited\ntext')
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(save).toHaveBeenCalledOnce()
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('opens an author profile and closes it with Escape', () => {
    renderChatArea()
    fireEvent.click(screen.getByRole('button', { name: 'View profile for admin' }))
    expect(screen.getByRole('dialog', { name: 'admin' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lets a shared GIF be saved to the same favorites store as the picker', () => {
    renderChatArea({
      messages: [message('shared-gif', '![gif](https://cdn.example.test/shared.gif)', 0)],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add GIF to favorites' }))
    expect(screen.getByRole('button', { name: 'Remove GIF from favorites' })).toBeVisible()
  })
})
