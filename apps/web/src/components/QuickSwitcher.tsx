import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hash, MessageCircleMore, Search, Server, X } from 'lucide-react'
import { useDialogFocus } from '../hooks/useDialogFocus'

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

const ITEM_GROUPS = [
  { kind: 'dm', label: 'Direct messages' },
  { kind: 'server', label: 'Servers' },
  { kind: 'channel', label: 'Channels' },
] as const

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
  const listRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const scrollSelectionRef = useRef(false)
  useDialogFocus(dialogRef, true)

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const matches = !normalizedQuery ? items : items
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
    return ITEM_GROUPS.flatMap(group => matches.filter(item => item.kind === group.kind)
      .slice(0, normalizedQuery ? 18 : 6)).slice(0, 18)
  }, [items, query])

  useEffect(() => {
    if (!scrollSelectionRef.current) return
    scrollSelectionRef.current = false
    listRef.current?.querySelector<HTMLElement>('.quick-switcher-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, filteredItems])

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
        scrollSelectionRef.current = true
        setActiveIndex((prev) => Math.min(prev + 1, Math.max(filteredItems.length - 1, 0)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        scrollSelectionRef.current = true
        setActiveIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (event.key === 'Enter' && event.target === inputRef.current) {
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
        ref={dialogRef}
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
            aria-label="Search servers, channels, and direct messages"
            value={query}
            onChange={(event) => {
              scrollSelectionRef.current = true
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
          />
          <button type="button" className="quick-switcher-close" onClick={onClose} aria-label="Close quick switcher">
            <X size={15} />
          </button>
        </div>

        <div className="quick-switcher-list" ref={listRef}>
          {filteredItems.length === 0 ? (
            <div className="quick-switcher-empty">
              No matches for <strong>{query}</strong>
            </div>
          ) : (
            ITEM_GROUPS.map(group => {
              const groupItems = filteredItems.filter(item => item.kind === group.kind)
              if (!groupItems.length) return null
              return <section className="quick-switcher-group" key={group.kind} aria-label={group.label}>
                <h3 className="quick-switcher-group-title">{group.label}</h3>
                {groupItems.map(item => {
                  const index = filteredItems.indexOf(item)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`quick-switcher-item ${index === activeIndex ? 'active' : ''}`}
                      onMouseEnter={() => {
                        scrollSelectionRef.current = false
                        setActiveIndex(index)
                      }}
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
                  )
                })}
              </section>
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
