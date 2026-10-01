import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceForegroundRecovery, type VoiceRecoverySession } from './useVoiceForegroundRecovery'

describe('voice foreground recovery', () => {
  let visibility = 'visible'
  let session: VoiceRecoverySession | null
  const resumeAudio = vi.fn<() => Promise<void>>()
  const recoverMicrophone = vi.fn<() => Promise<void>>()
  const onError = vi.fn()
  const getSession = () => session
  const setup = () => renderHook(() => useVoiceForegroundRecovery({
    getSession, resumeAudio, recoverMicrophone, onError,
  }))

  beforeEach(() => {
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
    session = { identity: {}, microphone: { readyState: 'ended' } as MediaStreamTrack }
    resumeAudio.mockReset().mockResolvedValue(undefined)
    recoverMicrophone.mockReset().mockResolvedValue(undefined)
    onError.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('does nothing while hidden, then resumes audio and recovers an ended microphone on return', async () => {
    setup()
    visibility = 'hidden'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(resumeAudio).not.toHaveBeenCalled()
    expect(recoverMicrophone).not.toHaveBeenCalled()
    visibility = 'visible'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(recoverMicrophone).toHaveBeenCalledOnce())
    expect(resumeAudio).toHaveBeenCalledOnce()
  })

  it('does not replace a live browser-muted microphone or change mute/deafen preferences', async () => {
    const microphone = { readyState: 'live', muted: true, enabled: false } as MediaStreamTrack
    session!.microphone = microphone
    setup()
    act(() => window.dispatchEvent(new Event('pageshow')))
    await waitFor(() => expect(resumeAudio).toHaveBeenCalledOnce())
    expect(recoverMicrophone).not.toHaveBeenCalled()
    expect(microphone.enabled).toBe(false)
  })

  it('coalesces duplicate foreground events for the same room', async () => {
    let resolve!: () => void
    resumeAudio.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    setup()
    act(() => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('pageshow'))
      window.dispatchEvent(new Event('online'))
    })
    expect(resumeAudio).toHaveBeenCalledOnce()
    await act(async () => resolve())
    expect(recoverMicrophone).toHaveBeenCalledOnce()
  })

  it('lets a gesture unlock audio even while the first resume promise is pending', async () => {
    let resolve!: () => void
    resumeAudio.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done }))
    setup()
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(resumeAudio).toHaveBeenCalledOnce()
    act(() => document.dispatchEvent(new Event('pointerdown')))
    await waitFor(() => expect(resumeAudio).toHaveBeenCalledTimes(2))
    await act(async () => resolve())
    expect(recoverMicrophone).toHaveBeenCalledOnce()
  })

  it.each(['leave', 'switch', 'unmount', 'hide'])('ignores stale recovery after %s', async (transition) => {
    let resolve!: () => void
    resumeAudio.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const view = setup()
    act(() => window.dispatchEvent(new Event('focus')))
    if (transition === 'leave') session = null
    if (transition === 'switch') session = { identity: {}, microphone: session!.microphone }
    if (transition === 'unmount') view.unmount()
    if (transition === 'hide') visibility = 'hidden'
    await act(async () => resolve())
    expect(recoverMicrophone).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports an autoplay failure and retries on a user gesture', async () => {
    const error = new Error('Audio blocked')
    resumeAudio.mockRejectedValueOnce(error)
    setup()
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(onError).toHaveBeenCalledWith(error))
    act(() => document.dispatchEvent(new Event('keydown')))
    await waitFor(() => expect(recoverMicrophone).toHaveBeenCalledOnce())
    expect(resumeAudio).toHaveBeenCalledTimes(2)
  })

  it('does not recreate a disconnected or revoked session and cleans up listeners', () => {
    session = null
    const view = setup()
    act(() => window.dispatchEvent(new Event('online')))
    expect(resumeAudio).not.toHaveBeenCalled()
    view.unmount()
    session = { identity: {}, microphone: { readyState: 'ended' } as MediaStreamTrack }
    act(() => window.dispatchEvent(new Event('focus')))
    expect(resumeAudio).not.toHaveBeenCalled()
  })
})
