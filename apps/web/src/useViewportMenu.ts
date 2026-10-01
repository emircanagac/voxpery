import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

export default function useViewportMenu(anchor: { x: number; y: number } | null) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({})
  const x = anchor?.x
  const y = anchor?.y

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu || x === undefined || y === undefined) return

    const reposition = () => {
      const viewport = window.visualViewport
      const pad = 8
      const minX = (viewport?.offsetLeft ?? 0) + pad
      const minY = (viewport?.offsetTop ?? 0) + pad
      const maxWidth = Math.max(0, (viewport?.width ?? window.innerWidth) - pad * 2)
      const maxHeight = Math.max(0, (viewport?.height ?? window.innerHeight) - pad * 2)
      const rect = menu.getBoundingClientRect()
      const width = Math.min(rect.width, maxWidth)
      const height = Math.min(rect.height, maxHeight)
      const next = {
        left: Math.max(minX, Math.min(x, minX + maxWidth - width)),
        top: Math.max(minY, Math.min(y, minY + maxHeight - height)),
        maxWidth,
        maxHeight,
      }
      setStyle((current) => Object.entries(next).every(([key, value]) => current[key as keyof CSSProperties] === value) ? current : next)
    }

    reposition()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reposition) : null
    observer?.observe(menu)
    window.addEventListener('resize', reposition)
    window.visualViewport?.addEventListener('resize', reposition)
    window.visualViewport?.addEventListener('scroll', reposition)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', reposition)
      window.visualViewport?.removeEventListener('resize', reposition)
      window.visualViewport?.removeEventListener('scroll', reposition)
    }
  }, [x, y])

  return { ref, style: { left: x ?? 8, top: y ?? 8, ...style } }
}
