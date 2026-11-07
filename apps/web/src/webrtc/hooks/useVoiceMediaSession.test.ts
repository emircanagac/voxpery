import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { supportsVoiceMediaSessionAnchor, useVoiceMediaSession, VOICE_SESSION_ANCHOR_URL } from './useVoiceMediaSession'

describe('voice media session support', () => {
  it('is limited to Android browsers', () => {
    expect(supportsVoiceMediaSessionAnchor({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/142.0 Mobile Safari/537.36' })).toBe(true)
    expect(supportsVoiceMediaSessionAnchor({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Version/26.0 Mobile/15E148 Safari/604.1' })).toBe(false)
    expect(supportsVoiceMediaSessionAnchor({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0 Safari/537.36' })).toBe(false)
    expect(supportsVoiceMediaSessionAnchor(undefined)).toBe(false)
  })
})

type Handler = (() => void) | null

describe('voice media session', () => {
  const handlers = new Map<string, Handler>()
  const session = {
    metadata: null as unknown,
    playbackState: 'none',
    setActionHandler: vi.fn((action: string, handler: Handler) => {
      if (action === 'unknown-in-this-browser') throw new TypeError('unsupported')
      handlers.set(action, handler)
    }),
    setMicrophoneActive: vi.fn(),
  }
  const play = vi.fn(() => Promise.resolve())
  const pause = vi.fn()
  const created: string[] = []

  beforeEach(() => {
    handlers.clear()
    session.metadata = null
    session.playbackState = 'none'
    session.setActionHandler.mockClear()
    session.setMicrophoneActive.mockClear()
    play.mockClear()
    pause.mockClear()
    created.length = 0
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true })
    vi.stubGlobal('MediaMetadata', class {
      init: object
      constructor(init: object) { this.init = init }
    })
    vi.stubGlobal('Audio', class {
      loop = false
      constructor(src: string) { created.push(src) }
      play = play
      pause = pause
      removeAttribute() {}
      load() {}
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaSession')
  })

  const setup = (active: boolean, muted = false) => {
    const onToggleMute = vi.fn()
    const onLeave = vi.fn()
    const hook = renderHook((props: { active: boolean; muted: boolean }) => useVoiceMediaSession({
      active: props.active, title: 'Server / Lounge', muted: props.muted, onToggleMute, onLeave,
    }), { initialProps: { active, muted } })
    return { ...hook, onToggleMute, onLeave }
  }

  it('does nothing outside a mobile voice call', () => {
    setup(false)
    expect(created).toEqual([])
    expect(session.setActionHandler).not.toHaveBeenCalled()
  })

  it('plays the anchor and routes notification controls to the call', () => {
    const { onLeave, onToggleMute } = setup(true)

    expect(created).toEqual([VOICE_SESSION_ANCHOR_URL])
    expect(play).toHaveBeenCalledTimes(1)
    expect(session.playbackState).toBe('playing')
    expect(session.metadata).toMatchObject({ init: { title: 'Server / Lounge', artist: 'Voxpery voice' } })
    expect(session.setMicrophoneActive).toHaveBeenLastCalledWith(true)

    handlers.get('hangup')?.()
    handlers.get('stop')?.()
    expect(onLeave).toHaveBeenCalledTimes(2)
    handlers.get('togglemicrophone')?.()
    expect(onToggleMute).toHaveBeenCalledTimes(1)
    handlers.get('pause')?.()
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('reports mute changes and clears the session when the call ends', () => {
    const { rerender } = setup(true)
    rerender({ active: true, muted: true })
    expect(session.setMicrophoneActive).toHaveBeenLastCalledWith(false)

    rerender({ active: false, muted: true })
    expect(pause).toHaveBeenCalledTimes(1)
    expect(session.metadata).toBeNull()
    expect(session.playbackState).toBe('none')
    expect([...handlers.values()].every(handler => handler === null)).toBe(true)
  })
})
