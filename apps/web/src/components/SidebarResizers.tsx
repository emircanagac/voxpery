import { useEffect, useRef, useState } from 'react'

const PANEL_WIDTHS_KEY = 'voxpery-panel-widths'
const DEFAULT_WIDTH = 240
const MIN_WIDTH = 200
const MAX_WIDTH = 360
type Widths = { left: number; right: number }

function fitPanelWidths(widths: Widths, viewportWidth: number): Widths {
  const bounded = (value: number) => Number.isFinite(value) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)) : DEFAULT_WIDTH
  let left = bounded(widths.left)
  let right = bounded(widths.right)
  const excess = Math.max(0, left + right - Math.max(MIN_WIDTH * 2, viewportWidth - 72 - 360))
  const leftReduction = Math.min(left - MIN_WIDTH, excess / 2)
  left -= leftReduction
  const rightReduction = Math.min(right - MIN_WIDTH, excess - leftReduction)
  right -= rightReduction
  left -= Math.min(left - MIN_WIDTH, excess - leftReduction - rightReduction)
  return { left: Math.round(left), right: Math.round(right) }
}

function readWidths(): Widths {
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_WIDTHS_KEY) ?? 'null')
    return fitPanelWidths({ left: stored?.left ?? DEFAULT_WIDTH, right: stored?.right ?? DEFAULT_WIDTH }, Infinity)
  } catch {
    return { left: DEFAULT_WIDTH, right: DEFAULT_WIDTH }
  }
}

export default function SidebarResizers() {
  const [preferred, setPreferred] = useState(readWidths)
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)
  const drag = useRef<{ side: keyof Widths; x: number; widths: Widths } | null>(null)
  const widths = fitPanelWidths(preferred, viewportWidth)

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const style = document.documentElement.style
    style.setProperty('--desktop-channel-width', `${widths.left}px`)
    style.setProperty('--desktop-member-width', `${widths.right}px`)
    return () => {
      style.removeProperty('--desktop-channel-width')
      style.removeProperty('--desktop-member-width')
    }
  }, [widths.left, widths.right])

  const save = (next: Widths) => {
    setPreferred(next)
    try { localStorage.setItem(PANEL_WIDTHS_KEY, JSON.stringify(next)) } catch { /* Keep the session preference when storage is unavailable. */ }
  }
  const change = (side: keyof Widths, value: number) => {
    const other = side === 'left' ? 'right' : 'left'
    const maximum = Math.min(MAX_WIDTH, viewportWidth - 72 - 360 - widths[other])
    save({ ...widths, [side]: Math.max(MIN_WIDTH, Math.min(maximum, value)) })
  }

  return <>{(['left', 'right'] as const).map((side) => (
    <div
      key={side}
      className={`sidebar-resizer sidebar-resizer--${side}`}
      role="separator"
      tabIndex={0}
      aria-label={side === 'left' ? 'Channel panel width' : 'Member panel width'}
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={Math.min(MAX_WIDTH, viewportWidth - 72 - 360 - widths[side === 'left' ? 'right' : 'left'])}
      aria-valuenow={widths[side]}
      onDoubleClick={() => change(side, DEFAULT_WIDTH)}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { side, x: event.clientX, widths }
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.side !== side) return
        change(side, drag.current.widths[side] + (event.clientX - drag.current.x) * (side === 'left' ? 1 : -1))
      }}
      onPointerUp={(event) => {
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={(event) => {
        if (event.key === 'Home') { event.preventDefault(); change(side, DEFAULT_WIDTH); return }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const delta = (event.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1)
        change(side, widths[side] + delta)
      }}
    />
  ))}</>
}
