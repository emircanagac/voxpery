import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useViewportMenu from './useViewportMenu'

function Menu({ anchor }: { anchor: { x: number; y: number; trigger?: HTMLElement; horizontalBoundary?: HTMLElement; horizontalStart?: HTMLElement } | null }) {
  const { ref, style } = useViewportMenu(anchor)
  return anchor ? <div ref={ref} style={style} role="menu" /> : null
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('viewport member menu layout', () => {
  it('aligns a voice menu to the avatar and shrinks it rather than shifting left', () => {
    vi.stubGlobal('innerWidth', 1920)
    vi.stubGlobal('innerHeight', 1080)
    const panel = document.createElement('aside')
    const avatar = document.createElement('span')
    panel.append(avatar)
    document.body.append(panel)
    let left = 110
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === panel) return new DOMRect(72, 52, 240, 1028)
      if (this === avatar) return new DOMRect(left, 160, 20, 20)
      return new DOMRect(0, 0, 224, 260)
    })
    const { unmount } = render(<Menu anchor={{ x: 110, y: 184, horizontalBoundary: panel, horizontalStart: avatar }} />)
    expect(screen.getByRole('menu')).toHaveStyle({ left: '110px', maxWidth: '194px' })
    left = 130
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('menu')).toHaveStyle({ left: '130px', maxWidth: '174px' })
    avatar.remove()
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('menu')).toHaveStyle({ left: '80px', maxWidth: '224px' })
    unmount()
    panel.remove()
  })
  it('caps width inside the owning panel and updates its bounds after resizing', () => {
    vi.stubGlobal('innerWidth', 1920)
    vi.stubGlobal('innerHeight', 1080)
    const panel = document.createElement('aside')
    document.body.append(panel)
    let left = 1680
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this === panel ? new DOMRect(left, 52, 240, 1028) : new DOMRect(0, 0, 264, 260)
    })
    const { unmount } = render(<Menu anchor={{ x: 1700, y: 160, horizontalBoundary: panel }} />)
    expect(screen.getByRole('menu')).toHaveStyle({ left: '1688px', maxWidth: '224px' })
    left = 72
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('menu')).toHaveStyle({ left: '80px', maxWidth: '224px' })
    unmount()
    panel.remove()
  })
  it('opens below the source row, flips above, or scrolls without covering it', () => {
    vi.stubGlobal('innerWidth', 800)
    vi.stubGlobal('innerHeight', 600)
    const trigger = document.createElement('button')
    document.body.append(trigger)
    let top = 100
    let menuHeight = 260
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this === trigger ? new DOMRect(720, top, 60, 40) : new DOMRect(0, 0, 264, menuHeight)
    })
    const { unmount } = render(<Menu anchor={{ x: 720, y: 110, trigger }} />)
    expect(screen.getByRole('menu')).toHaveStyle({ left: '528px', top: '144px', maxHeight: '448px' })
    top = 500
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('menu')).toHaveStyle({ top: '236px', maxHeight: '488px' })
    top = 280
    menuHeight = 450
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('menu')).toHaveStyle({ top: '324px', maxHeight: '268px' })
    unmount()
    trigger.remove()
  })
  it('uses measured size rather than sidebar bounds or estimated action counts', () => {
    vi.stubGlobal('innerWidth', 800)
    vi.stubGlobal('innerHeight', 600)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 264, 450))
    render(<Menu anchor={{ x: 780, y: 570 }} />)
    expect(screen.getByRole('menu')).toHaveStyle({ left: '528px', top: '142px', maxWidth: '784px', maxHeight: '584px' })
  })

  it('repositions an open menu when the window shrinks and caps its scrollable height', () => {
    vi.stubGlobal('innerWidth', 1920)
    vi.stubGlobal('innerHeight', 1080)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 264, 450))
    const { rerender } = render(<Menu anchor={null} />)
    rerender(<Menu anchor={{ x: 1660, y: 900 }} />)
    expect(screen.getByRole('menu')).toHaveStyle({ left: '1648px', top: '622px' })
    vi.stubGlobal('innerWidth', 320)
    vi.stubGlobal('innerHeight', 280)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('menu')).toHaveStyle({ left: '48px', top: '8px', maxWidth: '304px', maxHeight: '264px' })
  })

  it('respects the visual viewport when a mobile keyboard changes the usable area', () => {
    const viewport = Object.assign(new EventTarget(), { width: 320, height: 300, offsetLeft: 0, offsetTop: 30 })
    vi.stubGlobal('visualViewport', viewport)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 264, 450))
    const { unmount } = render(<Menu anchor={{ x: 310, y: 500 }} />)
    expect(screen.getByRole('menu')).toHaveStyle({ left: '48px', top: '38px', maxHeight: '284px' })
    viewport.height = 240
    act(() => viewport.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('menu')).toHaveStyle({ maxHeight: '224px' })
    unmount()
    viewport.dispatchEvent(new Event('scroll'))
  })
})
