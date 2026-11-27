import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeTypers,
  applyTypingEvent,
  createTypingSender,
  TYPING_DISPLAY_MS,
  TYPING_IDLE_STOP_MS,
  TYPING_SEND_INTERVAL_MS,
  typingLabel,
  useTypingStore,
} from './typingIndicator'

describe('typing sender', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends a start at most every few seconds while typing and a stop when idle', () => {
    const send = vi.fn()
    const sender = createTypingSender(send, () => Date.now())
    sender.setChannel('c-1')
    sender.draftChanged('h')
    sender.draftChanged('he')
    sender.draftChanged('hel')
    expect(send.mock.calls).toEqual([['c-1', true]])

    vi.advanceTimersByTime(TYPING_SEND_INTERVAL_MS)
    sender.draftChanged('hell')
    expect(send.mock.calls).toEqual([['c-1', true], ['c-1', true]])

    vi.advanceTimersByTime(TYPING_IDLE_STOP_MS)
    expect(send.mock.calls.at(-1)).toEqual(['c-1', false])
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('stops when the message is sent, the draft empties or the conversation changes', () => {
    const send = vi.fn()
    const sender = createTypingSender(send, () => Date.now())
    sender.setChannel('c-1')
    sender.draftChanged('hi')
    sender.sent()
    expect(send.mock.calls).toEqual([['c-1', true], ['c-1', false]])

    sender.draftChanged('again')
    sender.draftChanged('   ')
    expect(send.mock.calls.slice(2)).toEqual([['c-1', true], ['c-1', false]])

    sender.draftChanged('more')
    sender.setChannel('c-2')
    expect(send.mock.calls.slice(4)).toEqual([['c-1', true], ['c-1', false]])
    // Nothing was started in the new conversation, so nothing more is sent there.
    vi.advanceTimersByTime(TYPING_IDLE_STOP_MS * 2)
    expect(send).toHaveBeenCalledTimes(6)
  })
})

describe('typing display', () => {
  beforeEach(() => {
    useTypingStore.setState({ byChannel: {} })
  })

  const typing = (userId: string, username: string, isTyping = true) => ({
    type: 'Typing' as const,
    data: { channel_id: 'c-1', user_id: userId, username, is_typing: isTyping },
  })

  it('names who is typing, never the viewer, and forgets them after a while', () => {
    applyTypingEvent(typing('u-ada', 'Ada'), 1_000)
    applyTypingEvent(typing('u-me', 'Me'), 1_000)
    const typers = useTypingStore.getState().byChannel['c-1']
    expect(activeTypers(typers, 'u-me', 1_500)).toEqual(['Ada'])
    expect(activeTypers(typers, 'u-me', 1_000 + TYPING_DISPLAY_MS + 1)).toEqual([])
  })

  it('removes a typer who stopped or whose message arrived', () => {
    applyTypingEvent(typing('u-ada', 'Ada'), 1_000)
    applyTypingEvent(typing('u-ben', 'Ben'), 1_000)
    applyTypingEvent(typing('u-ada', 'Ada', false), 1_100)
    applyTypingEvent({
      type: 'NewMessage',
      data: {
        channel_id: 'c-1',
        channel_type: 'text',
        message: { author: { user_id: 'u-ben' } } as never,
      },
    }, 1_200)
    expect(activeTypers(useTypingStore.getState().byChannel['c-1'], null, 1_300)).toEqual([])
  })

  it('words one, two and several typers', () => {
    expect(typingLabel([])).toBeNull()
    expect(typingLabel(['Ada'])).toBe('Ada is typing…')
    expect(typingLabel(['Ada', 'Ben'])).toBe('Ada and Ben are typing…')
    expect(typingLabel(['Ada', 'Ben', 'Cem'])).toBe('Several people are typing…')
  })
})
