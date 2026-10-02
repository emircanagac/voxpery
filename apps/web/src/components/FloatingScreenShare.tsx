import { Maximize2, EyeOff } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { resizeStreamPreview, streamPreviewFrame, streamPreviewPosition, type PreviewBounds, type PreviewCorner, type PreviewPosition } from '../streamPreviewLayout'

type Props = {
  visible: boolean
  owner: string
  layoutKey: string | null
  onReturn: () => void
  onStop: () => void
  children: ReactNode
}

function readBounds(): PreviewBounds {
  const viewport = window.visualViewport
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  const right = left + (viewport?.width ?? window.innerWidth)
  const bottom = top + (viewport?.height ?? window.innerHeight)
  // Kept-mounted channel/DM panes may precede Friends in the DOM while hidden.
  const rect = ['.chat-messages', '.home-main'].flatMap(selector => (
    [...document.querySelectorAll(selector)].map(element => element.getBoundingClientRect())
  )).find(candidate => candidate.width > 0 && candidate.height > 0)
  const callbar = [...document.querySelectorAll('.callbar-overlay, .active-call-bar')]
    .map(element => element.getBoundingClientRect()).find(candidate => candidate.width > 0 && candidate.height > 0)
  const usableRect = rect && rect.width > 0 && rect.height > 0 ? rect : null
  const x = Math.max(left, usableRect?.left ?? left) + 12
  const y = Math.max(top, usableRect?.top ?? top + 96) + 12
  const endX = Math.min(right, usableRect?.right ?? right) - 12
  const endY = Math.min(bottom, usableRect?.bottom ?? bottom - 80, callbar && callbar.height > 0 ? callbar.top - 12 : bottom) - 12
  return { left: x, top: y, width: Math.max(0, endX - x), height: Math.max(0, endY - y) }
}

export default function FloatingScreenShare({ visible, owner, layoutKey, onReturn, onStop, children }: Props) {
  const location = useLocation()
  const playerRef = useRef<HTMLElement | null>(null)
  const boundsRef = useRef<PreviewBounds>({ left: 0, top: 0, width: 0, height: 0 })
  const positionRef = useRef<PreviewPosition>({ x: 1, y: 0 })
  const widthRef = useRef(360)
  const aspectRatioRef = useRef(16 / 9)
  const [width, setWidth] = useState(360)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number; width: number; height: number; corner?: PreviewCorner; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const pendingFrameRef = useRef<number | null>(null)

  const paint = useCallback(() => {
    const element = playerRef.current
    if (!element) return
    const frame = streamPreviewFrame(boundsRef.current, widthRef.current, positionRef.current, aspectRatioRef.current)
    element.style.width = `${frame.width}px`
    element.style.aspectRatio = `${aspectRatioRef.current} / 1`
    element.style.transform = `translate3d(${frame.left}px, ${frame.top}px, 0)`
  }, [])

  useLayoutEffect(() => {
    if (!visible) return
    const video = playerRef.current?.querySelector('video')
    if (!video) return
    const updateRatio = () => {
      if (!video.videoWidth || !video.videoHeight) return
      const ratio = video.videoWidth / video.videoHeight
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio === aspectRatioRef.current) return
      aspectRatioRef.current = ratio
      dragRef.current = null
      paint()
    }
    updateRatio()
    video.addEventListener('loadedmetadata', updateRatio)
    video.addEventListener('resize', updateRatio)
    return () => {
      video.removeEventListener('loadedmetadata', updateRatio)
      video.removeEventListener('resize', updateRatio)
    }
  }, [children, paint, visible])

  useLayoutEffect(() => {
    if (!visible) return
    const measure = () => {
      dragRef.current = null
      boundsRef.current = readBounds()
      setWidth(widthRef.current)
      paint()
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    const observeLayout = () => {
      observer?.disconnect()
      for (const element of document.querySelectorAll('.chat-messages, .home-main, .callbar-overlay, .active-call-bar, .shell-content')) observer?.observe(element)
    }
    observeLayout()
    const contentRoot = document.querySelector('.shell-content')
    const mutations = contentRoot ? new MutationObserver((records) => {
      // Rebind only when a conversation surface is replaced, not when message rows change.
      const changed = records.some(record => {
        if (record.type === 'attributes') return record.target instanceof Element && record.target.matches('.unified-content')
        if (record.target instanceof Element && record.target.closest('.chat-messages')) return false
        return [...record.addedNodes, ...record.removedNodes].some(node => (
          node instanceof Element && (node.matches('.chat-messages, .home-main') || node.querySelector('.chat-messages, .home-main'))
        ))
      })
      if (!changed) return
      observeLayout()
      measure()
    }) : null
    if (contentRoot) mutations?.observe(contentRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden'] })
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    return () => {
      observer?.disconnect()
      mutations?.disconnect()
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('scroll', measure)
      if (pendingFrameRef.current !== null) cancelAnimationFrame(pendingFrameRef.current)
      pendingFrameRef.current = null
      dragRef.current = null
    }
  }, [layoutKey, location.pathname, paint, visible])

  const startDrag = (event: PointerEvent<HTMLButtonElement>, corner?: PreviewCorner) => {
    if (event.button !== 0 || !event.isPrimary) return
    suppressClickRef.current = false
    boundsRef.current = readBounds()
    const frame = streamPreviewFrame(boundsRef.current, widthRef.current, positionRef.current, aspectRatioRef.current)
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...frame, corner, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.currentTarget.focus()
  }
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.corner && !drag.moved) {
      if (Math.hypot(dx, dy) < 6) return
      drag.moved = true
      suppressClickRef.current = true
    }
    if (drag.corner) {
      const resized = resizeStreamPreview(boundsRef.current, drag, drag.corner, dx, dy, aspectRatioRef.current)
      widthRef.current = resized.width
      positionRef.current = resized.position
    } else positionRef.current = streamPreviewPosition(boundsRef.current, drag.width, drag.left + dx, drag.top + dy, aspectRatioRef.current)
    // Update only this surface; dragging and resizing never reattach media.
    if (pendingFrameRef.current === null) pendingFrameRef.current = requestAnimationFrame(() => { pendingFrameRef.current = null; paint() })
  }
  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setWidth(widthRef.current)
    paint()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  if (!visible) return null
  return (
    <aside ref={playerRef} className="screen-share-mini-player" data-preview-width={width} aria-label={`Watching ${owner}'s screen share`}>
      <button
          type="button"
          className="screen-share-mini-player-open"
          title={`Return to ${owner}'s stream`}
          aria-label={`Return to ${owner}'s stream`}
          draggable={false}
          onDragStart={event => event.preventDefault()}
          onClick={event => {
            const suppressed = suppressClickRef.current && event.detail !== 0
            suppressClickRef.current = false
            if (!suppressed) onReturn()
          }}
          onPointerDown={(event) => startDrag(event)}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={event => { suppressClickRef.current = true; finishDrag(event) }}
          onLostPointerCapture={() => { dragRef.current = null; setWidth(widthRef.current) }}
          onKeyDown={(event) => {
            const frame = streamPreviewFrame(boundsRef.current, widthRef.current, positionRef.current, aspectRatioRef.current)
            const delta = event.shiftKey ? 80 : 20
            const offsets: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }
            if (event.key === 'Home') positionRef.current = { x: 0, y: 0 }
            else if (event.key === 'End') positionRef.current = { x: 1, y: 1 }
            else if (offsets[event.key]) {
              const [dx, dy] = offsets[event.key]
              positionRef.current = streamPreviewPosition(boundsRef.current, frame.width, frame.left + dx, frame.top + dy, aspectRatioRef.current)
            } else return
            event.preventDefault()
            paint()
          }}
      >
        {children}
        <span className="screen-share-mini-player-label">{owner}</span>
      </button>
      <div className="screen-share-mini-player-toolbar">
        <button type="button" className="screen-share-mini-player-stop" title="Stop watching" aria-label={`Stop watching ${owner}'s screen share`} onClick={onStop}><EyeOff size={15} aria-hidden="true" /></button>
      </div>
      {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map(corner => (
        <button
          key={corner}
          type="button"
          className={`screen-share-mini-player-resize screen-share-mini-player-resize--${corner}`}
          aria-label={`Resize stream preview from ${corner.replace('-', ' ')}`}
          title="Resize stream preview"
          onPointerDown={event => startDrag(event, corner)}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={() => { dragRef.current = null; setWidth(widthRef.current) }}
          onKeyDown={event => {
            const step = event.shiftKey ? 80 : 20
            const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
            const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
            if (!dx && !dy) return
            event.preventDefault()
            const frame = streamPreviewFrame(boundsRef.current, widthRef.current, positionRef.current, aspectRatioRef.current)
            const resized = resizeStreamPreview(boundsRef.current, frame, corner, dx, dy, aspectRatioRef.current)
            widthRef.current = resized.width
            positionRef.current = resized.position
            setWidth(resized.width)
            paint()
          }}
        >{corner === 'bottom-left' && <Maximize2 size={12} aria-hidden="true" />}</button>
      ))}
    </aside>
  )
}
