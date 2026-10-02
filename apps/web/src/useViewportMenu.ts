import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

export default function useViewportMenu(anchor: { x: number; y: number; trigger?: HTMLElement; horizontalBoundary?: HTMLElement | null; horizontalStart?: HTMLElement | null } | null) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({})
  const x = anchor?.x
  const y = anchor?.y
  const trigger = anchor?.trigger
  const horizontalBoundary = anchor?.horizontalBoundary
  const horizontalStart = anchor?.horizontalStart

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu || x === undefined || y === undefined) return

    const reposition = () => {
      const viewport = window.visualViewport
      const pad = 8
      let minX = (viewport?.offsetLeft ?? 0) + pad
      const minY = (viewport?.offsetTop ?? 0) + pad
      let maxWidth = Math.max(0, (viewport?.width ?? window.innerWidth) - pad * 2)
      if (horizontalBoundary?.isConnected) {
        const panel = horizontalBoundary.getBoundingClientRect()
        const right = Math.min(minX + maxWidth, panel.right - pad)
        const left = Math.max(minX, panel.left + pad)
        if (right > left) {
          minX = left
          maxWidth = right - left
        }
      }
      if (horizontalStart?.isConnected) {
        const left = Math.max(minX, horizontalStart.getBoundingClientRect().left)
        const right = minX + maxWidth
        if (left < right) {
          minX = left
          maxWidth = right - left
        }
      }
      let maxHeight = Math.max(0, (viewport?.height ?? window.innerHeight) - pad * 2)
      const rect = menu.getBoundingClientRect()
      const width = Math.min(rect.width, maxWidth)
      let height = Math.min(rect.height, maxHeight)
      let top = Math.max(minY, Math.min(y, minY + maxHeight - height))
      if (trigger?.isConnected) {
        const row = trigger.getBoundingClientRect()
        const endY = minY + maxHeight
        const below = Math.max(minY, Math.min(endY, row.bottom + 4))
        const above = Math.max(minY, Math.min(endY, row.top - 4))
        const belowSpace = endY - below
        const aboveSpace = above - minY
        const naturalHeight = Math.max(rect.height, menu.scrollHeight)
        // Keep the source row readable; flip or scroll the menu instead of covering it.
        const openBelow = naturalHeight <= belowSpace || (naturalHeight > aboveSpace && belowSpace >= aboveSpace)
        maxHeight = openBelow ? belowSpace : aboveSpace
        height = Math.min(naturalHeight, maxHeight)
        top = openBelow ? below : above - height
      }
      const next = {
        left: Math.max(minX, Math.min(x, minX + maxWidth - width)),
        top,
        maxWidth,
        maxHeight,
      }
      setStyle((current) => Object.entries(next).every(([key, value]) => current[key as keyof CSSProperties] === value) ? current : next)
    }

    reposition()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reposition) : null
    observer?.observe(menu)
    if (horizontalBoundary) observer?.observe(horizontalBoundary)
    if (horizontalStart) observer?.observe(horizontalStart)
    window.addEventListener('resize', reposition)
    window.visualViewport?.addEventListener('resize', reposition)
    window.visualViewport?.addEventListener('scroll', reposition)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', reposition)
      window.visualViewport?.removeEventListener('resize', reposition)
      window.visualViewport?.removeEventListener('scroll', reposition)
    }
  }, [x, y, trigger, horizontalBoundary, horizontalStart])

  return { ref, style: { left: x ?? 8, top: y ?? 8, ...style } }
}
