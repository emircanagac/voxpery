import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  EMOJI_CATEGORIES,
  filterGifOptions,
  filterEmojiOptions,
  filterStickerOptions,
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
  const [mode, setMode] = useState<'emoji' | 'gif' | 'sticker'>('emoji')

  const visibleOptions = useMemo(() => {
    if (!reactionMode && mode === 'gif') return []
    if (!reactionMode && mode === 'sticker') return []
    if (reactionMode && !query.trim() && activeCategory === 'all') {
      return getReactionModeEmojiOptions()
    }
    return filterEmojiOptions(query, activeCategory === 'all' ? undefined : activeCategory)
  }, [activeCategory, mode, query, reactionMode])

  const visibleGifs = useMemo(
    () => (reactionMode || mode !== 'gif' ? [] : filterGifOptions(query)),
    [mode, query, reactionMode],
  )

  const visibleStickers = useMemo(
    () => (reactionMode || mode !== 'sticker' ? [] : filterStickerOptions(query)),
    [mode, query, reactionMode],
  )

  const searchPlaceholder = reactionMode
    ? 'Search reactions'
    : mode === 'gif'
      ? 'Search GIFs'
      : mode === 'sticker'
        ? 'Search stickers'
        : 'Search emoji'

  return (
    <div className={`chat-emoji-picker${compact ? ' compact' : ''}`}>
      <div className="chat-emoji-search">
        <Search size={14} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
        />
      </div>
      {!reactionMode && (
        <div className="chat-emoji-mode-tabs" role="tablist" aria-label="Picker modes">
          <button
            type="button"
            className={`chat-emoji-mode-tab${mode === 'emoji' ? ' active' : ''}`}
            onClick={() => setMode('emoji')}
          >
            Emoji
          </button>
          <button
            type="button"
            className={`chat-emoji-mode-tab${mode === 'gif' ? ' active' : ''}`}
            onClick={() => setMode('gif')}
          >
            GIF
          </button>
          <button
            type="button"
            className={`chat-emoji-mode-tab${mode === 'sticker' ? ' active' : ''}`}
            onClick={() => setMode('sticker')}
          >
            Sticker
          </button>
        </div>
      )}
      <div className="chat-emoji-content">
        {(reactionMode || mode === 'emoji') && (
          <>
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
          </>
        )}
        {!reactionMode && mode === 'gif' && (
          <>
            <div className="chat-gif-grid">
              {visibleGifs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="chat-gif-item"
                  onClick={() => onSelect(`![gif](${entry.url})`)}
                  title={entry.label}
                  aria-label={entry.label}
                >
                  <img src={entry.url} alt={entry.label} loading="lazy" />
                  <span>{entry.label}</span>
                </button>
              ))}
            </div>
            {visibleGifs.length === 0 && <div className="chat-emoji-empty">No GIF found.</div>}
          </>
        )}
        {!reactionMode && mode === 'sticker' && (
          <>
            <div className="chat-sticker-grid">
              {visibleStickers.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="chat-sticker-item"
                  onClick={() => onSelect(`![sticker](${entry.imageUrl})`)}
                  title={entry.label}
                  aria-label={entry.label}
                >
                  <img src={entry.imageUrl} alt={entry.label} className="chat-sticker-image" loading="lazy" />
                  <span className="chat-sticker-label">{entry.label}</span>
                </button>
              ))}
            </div>
            {visibleStickers.length === 0 && <div className="chat-emoji-empty">No sticker found.</div>}
          </>
        )}
      </div>
    </div>
  )
}
