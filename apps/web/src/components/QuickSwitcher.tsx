import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hash, MessageCircleMore, Search, Server, X } from 'lucide-react'

export type QuickSwitcherItem = {
  id: string
  kind: 'server' | 'channel' | 'dm'
  label: string
  subtitle?: string
  searchText: string
}

function itemIcon(kind: QuickSwitcherItem['kind']) {
  if (kind === 'server') return <Server size={15} />
  if (kind === 'channel') return <Hash size={15} />
  return <MessageCircleMore size={15} />
}

function itemKindLabel(kind: QuickSwitcherItem['kind']) {
  if (kind === 'server') return 'Server'
  if (kind === 'channel') return 'Channel'
  return 'DM'
}

export default function QuickSwitcher({
  items,
  onClose,
  onSelect,
}: {
  items: QuickSwitcherItem[]
  onClose: () => void
  onSelect: (item: QuickSwitcherItem) => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return items.slice(0, 14)

    return items
      .map((item) => {
        const haystack = item.searchText.toLowerCase()
        const starts = item.label.toLowerCase().startsWith(normalizedQuery)
        const includes = haystack.includes(normalizedQuery)
        return { item, starts, includes }
      })
      .filter((entry) => entry.includes)
      .sort((a, b) => {
        if (a.starts !== b.starts) return a.starts ? -1 : 1
        return a.item.label.localeCompare(b.item.label)
      })
      .map((entry) => entry.item)
      .slice(0, 18)
  }, [items, query])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((prev) => Math.min(prev + 1, Math.max(filteredItems.length - 1, 0)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        const activeItem = filteredItems[activeIndex]
        if (!activeItem) return
        event.preventDefault()
        onSelect(activeItem)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeIndex, filteredItems, onClose, onSelect])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="quick-switcher-overlay" onClick={onClose}>
      <div
        className="quick-switcher"
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="quick-switcher-search">
          <Search size={16} />
          <input
            ref={inputRef}
            className="quick-switcher-input"
            placeholder="Search servers, channels, and direct messages"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
          />
          <button type="button" className="quick-switcher-close" onClick={onClose} aria-label="Close quick switcher">
            <X size={15} />
          </button>
        </div>

        <div className="quick-switcher-list">
          {filteredItems.length === 0 ? (
            <div className="quick-switcher-empty">
              No matches for <strong>{query}</strong>
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`quick-switcher-item ${index === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(item)}
              >
                <span className={`quick-switcher-item-icon quick-switcher-item-icon-${item.kind}`} aria-hidden>
                  {itemIcon(item.kind)}
                </span>
                <span className="quick-switcher-item-copy">
                  <span className="quick-switcher-item-label">{item.label}</span>
                  {item.subtitle ? (
                    <span className="quick-switcher-item-subtitle">{item.subtitle}</span>
                  ) : null}
                </span>
                <span className={`quick-switcher-kind quick-switcher-kind-${item.kind}`}>
                  {itemKindLabel(item.kind)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
