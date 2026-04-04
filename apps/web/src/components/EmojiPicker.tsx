import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  EMOJI_CATEGORIES,
  filterEmojiOptions,
  getReactionModeEmojiOptions,
  type EmojiOption,
} from '../emoji'

type EmojiPickerProps = {
  onSelect: (emoji: string) => void
  compact?: boolean
  reactionMode?: boolean
}

export default function EmojiPicker({
  onSelect,
  compact = false,
  reactionMode = false,
}: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')

  const visibleOptions = useMemo(() => {
    if (reactionMode && !query.trim() && activeCategory === 'all') {
      return getReactionModeEmojiOptions()
    }
    return filterEmojiOptions(query, activeCategory === 'all' ? undefined : activeCategory)
  }, [activeCategory, query, reactionMode])

  return (
    <div className={`chat-emoji-picker${compact ? ' compact' : ''}`}>
      <div className="chat-emoji-search">
        <Search size={14} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji"
          autoComplete="off"
        />
      </div>
      <div className="chat-emoji-tabs" role="tablist" aria-label="Emoji categories">
        <button
          type="button"
          className={`chat-emoji-tab${activeCategory === 'all' ? ' active' : ''}`}
          onClick={() => setActiveCategory('all')}
          title="All"
          aria-label="All"
        >
          <span aria-hidden="true">#</span>
        </button>
        {EMOJI_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            className={`chat-emoji-tab${activeCategory === category.id ? ' active' : ''}`}
            onClick={() => setActiveCategory(category.id)}
            title={category.label}
            aria-label={category.label}
          >
            <span aria-hidden="true">{category.icon}</span>
          </button>
        ))}
      </div>
      <div className="chat-emoji-grid">
        {visibleOptions.map((entry: EmojiOption) => (
          <button
            key={`${entry.emoji}-${entry.label}`}
            type="button"
            className="chat-emoji-item"
            onClick={() => onSelect(entry.emoji)}
            title={entry.label}
            aria-label={entry.label}
          >
            {entry.emoji}
          </button>
        ))}
      </div>
      {visibleOptions.length === 0 && <div className="chat-emoji-empty">No emoji found.</div>}
    </div>
  )
}
