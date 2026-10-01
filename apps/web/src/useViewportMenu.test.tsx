import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useViewportMenu from './useViewportMenu'

function Menu({ anchor }: { anchor: { x: number; y: number } | null }) {
  const { ref, style } = useViewportMenu(anchor)
  return anchor ? <div ref={ref} style={style} role="menu" /> : null
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('viewport member menu layout', () => {
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
