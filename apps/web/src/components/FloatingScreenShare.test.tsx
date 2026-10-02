import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FloatingScreenShare from './FloatingScreenShare'

describe('FloatingScreenShare', () => {
  let width = 1300
  const onReturn = vi.fn()
  const onStop = vi.fn()
  const resize = () => screen.getByRole('button', { name: 'Resize stream preview from bottom left' })
  const open = () => screen.getByRole('button', { name: "Return to admin's stream" })
  const preview = (visible = true, layoutKey = 'chat-1') => (
    <MemoryRouter><div className="chat-messages" /><FloatingScreenShare visible={visible} owner="admin" layoutKey={layoutKey} onReturn={onReturn} onStop={onStop}><video data-testid="preview-video" /></FloatingScreenShare></MemoryRouter>
  )

  beforeEach(() => {
    width = 1300
    vi.clearAllMocks()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 310, top: 100, right: 310 + width, bottom: 900, width, height: 800, x: 310, y: 100, toJSON: () => ({}) }))
  })
  afterEach(() => vi.restoreAllMocks())

  it('changes size without replacing the video or navigating', () => {
    const { container } = render(preview())
    const player = container.querySelector<HTMLElement>('.screen-share-mini-player')!
    const video = screen.getByTestId('preview-video')
    expect(player.style.width).toBe('360px')
    fireEvent.keyDown(resize(), { key: 'ArrowLeft', shiftKey: true })
    fireEvent.keyDown(resize(), { key: 'ArrowLeft', shiftKey: true })
    expect(player.style.width).toBe('520px')
    for (let i = 0; i < 4; i++) fireEvent.keyDown(resize(), { key: 'ArrowRight', shiftKey: true })
    expect(player.style.width).toBe('240px')
    expect(container.querySelectorAll('.screen-share-mini-player-resize')).toHaveLength(4)
    expect(container.querySelectorAll('.screen-share-mini-player-resize svg')).toHaveLength(1)
    expect(resize().querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Shrink stream preview' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enlarge stream preview' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move stream preview' })).toBeNull()
    expect(screen.getByTestId('preview-video')).toBe(video)
    expect(onReturn).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('supports keyboard movement to each corner without returning to voice', () => {
    const { container } = render(preview())
    const player = container.querySelector<HTMLElement>('.screen-share-mini-player')!
    const handle = open()
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(player.style.transform).toBe('translate3d(322px, 112px, 0)')
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(player.style.transform).toBe('translate3d(402px, 112px, 0)')
    fireEvent.keyDown(handle, { key: 'End' })
    expect(player.style.transform).not.toBe('translate3d(402px, 112px, 0)')
    expect(onReturn).not.toHaveBeenCalled()
  })

  it('retains size and position through voice/text view switches and clamps after resize', () => {
    const { container, rerender } = render(preview())
    for (let i = 0; i < 6; i++) fireEvent.keyDown(resize(), { key: 'ArrowRight' })
    fireEvent.keyDown(open(), { key: 'Home' })
    rerender(preview(false, 'voice-1'))
    expect(screen.queryByRole('button', { name: "Return to admin's stream" })).toBeNull()
    width = 220
    rerender(preview(true, 'chat-2'))
    const player = container.querySelector<HTMLElement>('.screen-share-mini-player')!
    expect(player.style.width).toBe('196px')
    expect(player.style.transform).toBe('translate3d(322px, 112px, 0)')
    expect(player.dataset.previewWidth).toBe('240')
  })

  it('keeps return and stop watching as separate explicit actions', () => {
    render(preview())
    fireEvent.click(screen.getByRole('button', { name: "Return to admin's stream" }))
    expect(onReturn).toHaveBeenCalledOnce()
    expect(onStop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: "Stop watching admin's screen share" }))
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('supports continuous keyboard corner resizing without replacing media', () => {
    const { container } = render(preview())
    const video = screen.getByTestId('preview-video')
    fireEvent.keyDown(resize(), { key: 'ArrowRight' })
    expect(container.querySelector<HTMLElement>('.screen-share-mini-player')!.style.width).toBe('340px')
    expect(screen.getByTestId('preview-video')).toBe(video)
    expect(onReturn).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('fits the native video ratio and follows resolution changes without replacing media', () => {
    const { container } = render(preview())
    const player = container.querySelector<HTMLElement>('.screen-share-mini-player')!
    const video = screen.getByTestId('preview-video')
    Object.defineProperties(video, { videoWidth: { configurable: true, value: 1280 }, videoHeight: { configurable: true, value: 1280 } })
    fireEvent.loadedMetadata(video)
    expect(player.style.aspectRatio).toBe('1 / 1')
    expect(player.style.width).toBe('360px')
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 800 })
    fireEvent(video, new Event('resize'))
    expect(player.style.aspectRatio).toBe('1.6 / 1')
    expect(screen.getByTestId('preview-video')).toBe(video)
    expect(onReturn).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('suppresses drag clicks while keeping keyboard return available', () => {
    render(preview())
    fireEvent.pointerCancel(open())
    fireEvent.click(open(), { detail: 1 })
    expect(onReturn).not.toHaveBeenCalled()
    fireEvent.pointerCancel(open())
    fireEvent.click(open(), { detail: 0 })
    expect(onReturn).toHaveBeenCalledOnce()
    fireEvent.click(open(), { detail: 1 })
    expect(onReturn).toHaveBeenCalledTimes(2)
  })

  it('rebinds replaced conversation surfaces without measuring message updates', async () => {
    const { container } = render(<div className="shell-content">{preview()}</div>)
    const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
    const calls = measure.mock.calls.length
    const content = container.querySelector('.chat-messages')!
    await act(async () => { content.appendChild(document.createElement('span')) })
    expect(measure.mock.calls.length).toBe(calls)
    await act(async () => { content.replaceWith(content.cloneNode(true)) })
    expect(measure.mock.calls.length).toBeGreaterThan(calls)
  })

  it('uses visible Friends bounds instead of a kept-mounted hidden chat and remeasures view switches', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      const hidden = Boolean(this.closest('[aria-hidden="true"]'))
      const left = this.matches('.chat-messages') ? 600 : 310
      const size = hidden ? 0 : 400
      return { left, top: 100, right: left + size, bottom: 100 + size, width: size, height: size, x: left, y: 100, toJSON: () => ({}) }
    })
    const { container } = render(
      <MemoryRouter><div className="shell-content">
        <div className="unified-content"><div className="home-main" /></div>
        <div className="unified-content" aria-hidden="true" data-testid="retained-server"><div className="chat-messages" /></div>
        <FloatingScreenShare visible owner="admin" layoutKey="same-call" onReturn={onReturn} onStop={onStop}><video data-testid="preview-video" /></FloatingScreenShare>
      </div></MemoryRouter>,
    )
    const player = container.querySelector<HTMLElement>('.screen-share-mini-player')!
    const video = screen.getByTestId('preview-video')
    fireEvent.keyDown(open(), { key: 'Home' })
    expect(player.style.transform).toBe('translate3d(322px, 112px, 0)')
    await act(async () => { screen.getByTestId('retained-server').setAttribute('aria-hidden', 'false') })
    fireEvent.keyDown(open(), { key: 'Home' })
    expect(player.style.transform).toBe('translate3d(612px, 112px, 0)')
    await act(async () => { screen.getByTestId('retained-server').setAttribute('aria-hidden', 'true') })
    fireEvent.keyDown(open(), { key: 'Home' })
    expect(player.style.transform).toBe('translate3d(322px, 112px, 0)')
    expect(screen.getByTestId('preview-video')).toBe(video)
  })
})
