import { Clock3, Images, LoaderCircle, Search, Smile, Star, Sticker, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  EMOJI_CATEGORIES,
  filterGifOptions,
  filterEmojiOptions,
  filterStickerOptions,
  getAllEmojiOptions,
  getReactionModeEmojiOptions,
  type EmojiOption,
  type GifOption,
  type StickerOption,
} from '../emoji'
import {
  getFavoriteGifs,
  getFavoriteStickers,
  getRecentEmojis,
  getRecentGifs,
  getRecentStickers,
  recordRecentEmoji,
  recordRecentGif,
  recordRecentSticker,
  toggleFavoriteGif,
  toggleFavoriteSticker,
} from '../expressionPreferences'
import { fetchGiphyGifs, isGiphyConfigured } from '../giphy'
import InlineMediaImage from './InlineMediaImage'

type PickerMode = 'emoji' | 'gif' | 'sticker'
type GifView = 'browse' | 'recent' | 'favorites'
type StickerView = 'browse' | 'recent' | 'favorites'

type EmojiPickerProps = {
  onSelect: (emoji: string) => void
  compact?: boolean
  reactionMode?: boolean
  initialMode?: PickerMode
  autoFocus?: boolean
  onModeChange?: (mode: PickerMode) => void
  onClose?: () => void
}

function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const index = tabs.indexOf(event.target as HTMLButtonElement)
  if (index < 0) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[next]?.focus()
  tabs[next]?.click()
}

function mediaMatchesQuery(entry: GifOption | StickerOption, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return entry.label.toLowerCase().includes(normalized)
    || entry.keywords.some((keyword) => keyword.toLowerCase().includes(normalized))
}

export default function EmojiPicker({
  onSelect,
  compact = false,
  reactionMode = false,
  initialMode = 'emoji',
  autoFocus = false,
  onModeChange,
  onClose,
}: EmojiPickerProps) {
  const pickerId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [mode, setMode] = useState<PickerMode>(initialMode)
  const [gifView, setGifView] = useState<GifView>('browse')
  const [stickerView, setStickerView] = useState<StickerView>('browse')
  const [recentEmojis, setRecentEmojis] = useState(() => getRecentEmojis())
  const [recentGifs, setRecentGifs] = useState(() => getRecentGifs())
  const [recentStickers, setRecentStickers] = useState(() => getRecentStickers())
  const [favoriteGifs, setFavoriteGifs] = useState(() => getFavoriteGifs())
  const [favoriteStickers, setFavoriteStickers] = useState(() => getFavoriteStickers())
  const [remoteGifs, setRemoteGifs] = useState<GifOption[]>([])
  const [remoteOffset, setRemoteOffset] = useState(0)
  const [remoteHasMore, setRemoteHasMore] = useState(false)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState(false)
  const giphyConfigured = isGiphyConfigured()

  useEffect(() => {
    if (reactionMode) return
    setMode(initialMode)
    setQuery('')
    setActiveCategory('all')
    setGifView('browse')
    setStickerView('browse')
  }, [initialMode, reactionMode])

  useEffect(() => {
    if (reactionMode || mode !== 'gif' || !giphyConfigured || (gifView !== 'browse' && !query.trim())) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setRemoteLoading(true)
      setRemoteError(false)
      void fetchGiphyGifs(query, 0, controller.signal)
        .then((page) => {
          setRemoteGifs(page.options)
          setRemoteOffset(page.options.length)
          setRemoteHasMore(page.hasMore)
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setRemoteError(true)
          setRemoteGifs([])
          setRemoteHasMore(false)
        })
        .finally(() => {
          if (!controller.signal.aborted) setRemoteLoading(false)
        })
    }, query.trim() ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [gifView, giphyConfigured, mode, query, reactionMode])

  const recentEmojiOptions = useMemo(() => {
    const byEmoji = new Map(getAllEmojiOptions().map((entry) => [entry.emoji, entry]))
    return recentEmojis.map((emoji) => byEmoji.get(emoji)).filter((entry): entry is EmojiOption => !!entry)
  }, [recentEmojis])

  const visibleOptions = useMemo(() => {
    if (!reactionMode && mode !== 'emoji') return []
    if (activeCategory === 'recent' && !query.trim()) return recentEmojiOptions
    if (reactionMode && !query.trim() && activeCategory === 'all') return getReactionModeEmojiOptions()
    return filterEmojiOptions(query, activeCategory === 'all' || activeCategory === 'recent' ? undefined : activeCategory)
  }, [activeCategory, mode, query, reactionMode, recentEmojiOptions])

  const visibleGifs = useMemo(() => {
    if (reactionMode || mode !== 'gif') return []
    if (query.trim()) return giphyConfigured && !remoteError ? remoteGifs : filterGifOptions(query)
    if (gifView === 'favorites') return favoriteGifs
    if (gifView === 'recent') return recentGifs
    return giphyConfigured && !remoteError ? remoteGifs : filterGifOptions('')
  }, [favoriteGifs, gifView, giphyConfigured, mode, query, reactionMode, recentGifs, remoteError, remoteGifs])

  const visibleStickers = useMemo(() => {
    if (reactionMode || mode !== 'sticker') return []
    const source = !query.trim() && stickerView === 'favorites'
      ? favoriteStickers
      : stickerView === 'recent' && !query.trim()
        ? recentStickers
        : filterStickerOptions(query)
    return query.trim() ? source.filter((entry) => mediaMatchesQuery(entry, query)) : source
  }, [favoriteStickers, mode, query, reactionMode, recentStickers, stickerView])

  const favoriteUrls = useMemo(() => new Set(favoriteGifs.map((entry) => entry.url)), [favoriteGifs])
  const favoriteStickerUrls = useMemo(
    () => new Set(favoriteStickers.map((entry) => entry.imageUrl)),
    [favoriteStickers],
  )
  const gifColumns = useMemo(() => {
    const columns: GifOption[][] = [[], []]
    const columnWeights = [0, 0]
    visibleGifs.forEach((entry) => {
      const columnIndex = columnWeights[0] <= columnWeights[1] ? 0 : 1
      const width = entry.width && entry.width > 0 ? entry.width : 1
      const height = entry.height && entry.height > 0 ? entry.height : width
      columns[columnIndex].push(entry)
      columnWeights[columnIndex] += Math.min(2.4, Math.max(0.55, height / width)) + 0.05
    })
    return columns
  }, [visibleGifs])

  const selectEmoji = (entry: EmojiOption) => {
    setRecentEmojis(recordRecentEmoji(entry.emoji))
    onSelect(entry.emoji)
  }

  const selectGif = (entry: GifOption) => {
    setRecentGifs(recordRecentGif(entry))
    onSelect(`![gif](${entry.url})`)
  }

  const selectSticker = (entry: StickerOption) => {
    setRecentStickers(recordRecentSticker(entry))
    onSelect(`![sticker](${entry.imageUrl})`)
  }

  const loadMoreGifs = () => {
    if (!giphyConfigured || remoteLoading || !remoteHasMore) return
    const controller = new AbortController()
    setRemoteLoading(true)
    void fetchGiphyGifs(query, remoteOffset, controller.signal)
      .then((page) => {
        setRemoteGifs((current) => {
          const knownUrls = new Set(current.map((entry) => entry.url))
          return [...current, ...page.options.filter((entry) => !knownUrls.has(entry.url))]
        })
        setRemoteOffset((current) => current + page.options.length)
        setRemoteHasMore(page.hasMore)
      })
      .catch(() => setRemoteHasMore(false))
      .finally(() => setRemoteLoading(false))
  }

  const searchPlaceholder = reactionMode
    ? 'Search reactions'
    : mode === 'gif'
      ? giphyConfigured ? 'Search GIPHY' : 'Search GIFs'
      : mode === 'sticker'
        ? 'Search stickers'
        : 'Search emoji'

  return (
    <div className={`chat-emoji-picker${compact ? ' compact' : ''}`}>
      {!reactionMode && (
        <div className="chat-expression-header">
          <div className="chat-emoji-mode-tabs" role="tablist" aria-label="Expression types" onKeyDown={navigateTabs}>
            {(['emoji', 'gif', 'sticker'] as PickerMode[]).map((entryMode) => (
              <button
                key={entryMode}
                type="button"
                role="tab"
                aria-selected={mode === entryMode}
                id={`${pickerId}-${entryMode}`}
                aria-controls={`${pickerId}-content`}
                tabIndex={mode === entryMode ? 0 : -1}
                className={`chat-emoji-mode-tab${mode === entryMode ? ' active' : ''}`}
                onClick={() => {
                  setMode(entryMode)
                  onModeChange?.(entryMode)
                  setQuery('')
                }}
              >
                {entryMode === 'emoji' && <Smile size={16} aria-hidden="true" />}
                {entryMode === 'gif' && <Images size={16} aria-hidden="true" />}
                {entryMode === 'sticker' && <Sticker size={16} aria-hidden="true" />}
                <span>{entryMode === 'gif' ? 'GIF' : `${entryMode[0].toUpperCase()}${entryMode.slice(1)}`}</span>
              </button>
            ))}
          </div>
          {onClose && <button type="button" className="chat-expression-icon-button" aria-label="Close expression picker" title="Close" onClick={onClose}><X size={16} /></button>}
        </div>
      )}
      <div className="chat-emoji-search">
        <Search size={16} aria-hidden="true" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          autoComplete="off"
          autoFocus={autoFocus}
        />
        {query && <button type="button" className="chat-expression-icon-button" aria-label="Clear search" title="Clear search" onClick={() => {
          setQuery('')
          searchRef.current?.focus()
        }}><X size={14} /></button>}
      </div>
      <div className="chat-emoji-content" id={`${pickerId}-content`} role={reactionMode ? undefined : 'tabpanel'} aria-labelledby={reactionMode ? undefined : `${pickerId}-${mode}`}>
        {(reactionMode || mode === 'emoji') && (
          <>
            <div className="chat-emoji-tabs" role="group" aria-label="Emoji categories">
              <button
                type="button"
                className={`chat-emoji-tab${activeCategory === 'recent' ? ' active' : ''}`}
                onClick={() => setActiveCategory('recent')}
                title={recentEmojiOptions.length > 0 ? 'Recently used' : 'No recently used emoji'}
                aria-label="Recently used"
                aria-pressed={activeCategory === 'recent'}
                disabled={recentEmojiOptions.length === 0}
              >
                <Clock3 size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`chat-emoji-tab${activeCategory === 'all' ? ' active' : ''}`}
                onClick={() => setActiveCategory('all')}
                title="All"
                aria-label="All"
                aria-pressed={activeCategory === 'all'}
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
                  aria-pressed={activeCategory === category.id}
                >
                  <span aria-hidden="true">{category.icon}</span>
                </button>
              ))}
            </div>
            <div className="chat-expression-section-label">{query.trim() ? 'Search results' : activeCategory === 'recent' ? 'Recently used' : EMOJI_CATEGORIES.find(category => category.id === activeCategory)?.label ?? 'All emoji'}</div>
            <div className="chat-emoji-grid">
              {visibleOptions.map((entry) => (
                <button
                  key={`${entry.emoji}-${entry.label}`}
                  type="button"
                  className="chat-emoji-item"
                  onClick={() => selectEmoji(entry)}
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
            {!query.trim() && (
              <div className="chat-expression-filter-tabs" role="group" aria-label="GIF collections">
                <button type="button" aria-pressed={gifView === 'browse'} className={gifView === 'browse' ? 'active' : ''} onClick={() => setGifView('browse')}><Images size={14} aria-hidden="true" />Browse</button>
                <button type="button" aria-pressed={gifView === 'recent'} className={gifView === 'recent' ? 'active' : ''} onClick={() => setGifView('recent')} disabled={recentGifs.length === 0}><Clock3 size={14} aria-hidden="true" />Recent</button>
                <button type="button" aria-pressed={gifView === 'favorites'} className={gifView === 'favorites' ? 'active' : ''} onClick={() => setGifView('favorites')}><Star size={14} aria-hidden="true" />Favorites</button>
              </div>
            )}
            <div className="chat-gif-grid">
              {gifColumns.map((column, columnIndex) => (
                <div key={columnIndex} className="chat-gif-column">
                  {column.map((entry) => {
                    const favorite = favoriteUrls.has(entry.url)
                    return (
                      <div key={`${entry.id}-${entry.url}`} className="chat-gif-card">
                        <button
                          type="button"
                          className="chat-gif-item"
                          onClick={() => selectGif(entry)}
                          title={entry.label}
                          aria-label={`Send ${entry.label}`}
                          style={{ aspectRatio: `${entry.width || 320} / ${entry.height || 180}` }}
                        >
                          <InlineMediaImage src={entry.previewUrl ?? entry.url} alt={entry.label} loading="lazy" />
                        </button>
                        <button
                          type="button"
                          className={`chat-media-favorite${favorite ? ' active' : ''}`}
                          onClick={() => setFavoriteGifs(toggleFavoriteGif(entry))}
                          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
                          aria-label={favorite ? `Remove ${entry.label} from favorites` : `Add ${entry.label} to favorites`}
                          aria-pressed={favorite}
                        >
                          <Star size={14} fill={favorite ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            {remoteLoading && visibleGifs.length === 0 && (
              <div className="chat-expression-loading"><LoaderCircle size={16} className="spin" /> Loading GIFs...</div>
            )}
            {!remoteLoading && visibleGifs.length === 0 && (
              <div className="chat-emoji-empty">
                {gifView === 'favorites' ? 'Favorite GIFs appear here.' : gifView === 'recent' ? 'Recently used GIFs appear here.' : 'No GIF found.'}
              </div>
            )}
            {giphyConfigured && (query.trim() || gifView === 'browse') && visibleGifs.length > 0 && (
              <div className="chat-gif-footer">
                <span>Powered by GIPHY</span>
                {remoteHasMore && (
                  <button type="button" onClick={loadMoreGifs} disabled={remoteLoading}>
                    {remoteLoading ? 'Loading...' : 'Load more'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {!reactionMode && mode === 'sticker' && (
          <>
            {!query.trim() && (
              <div className="chat-expression-filter-tabs" role="group" aria-label="Sticker collections">
                <button type="button" aria-pressed={stickerView === 'browse'} className={stickerView === 'browse' ? 'active' : ''} onClick={() => setStickerView('browse')}><Images size={14} aria-hidden="true" />Browse</button>
                <button type="button" aria-pressed={stickerView === 'recent'} className={stickerView === 'recent' ? 'active' : ''} onClick={() => setStickerView('recent')} disabled={recentStickers.length === 0}><Clock3 size={14} aria-hidden="true" />Recent</button>
                <button type="button" aria-pressed={stickerView === 'favorites'} className={stickerView === 'favorites' ? 'active' : ''} onClick={() => setStickerView('favorites')}><Star size={14} aria-hidden="true" />Favorites</button>
              </div>
            )}
            <div className="chat-sticker-grid">
              {visibleStickers.map((entry) => {
                const favorite = favoriteStickerUrls.has(entry.imageUrl)
                return (
                  <div key={`${entry.id}-${entry.imageUrl}`} className="chat-sticker-card">
                    <button
                      type="button"
                      className="chat-sticker-item"
                      onClick={() => selectSticker(entry)}
                      title={entry.label}
                      aria-label={`Send ${entry.label}`}
                    >
                      <InlineMediaImage src={entry.previewUrl ?? entry.imageUrl} alt={entry.label} className="chat-sticker-image" loading="lazy" />
                    </button>
                    <button
                      type="button"
                      className={`chat-media-favorite${favorite ? ' active' : ''}`}
                      onClick={() => setFavoriteStickers(toggleFavoriteSticker(entry))}
                      title={favorite ? 'Remove from favorites' : 'Add to favorites'}
                      aria-label={favorite ? `Remove ${entry.label} from favorites` : `Add ${entry.label} to favorites`}
                      aria-pressed={favorite}
                    >
                      <Star size={14} fill={favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                )
              })}
            </div>
            {visibleStickers.length === 0 && (
              <div className="chat-emoji-empty">
                {stickerView === 'favorites' ? 'Favorite stickers appear here.' : stickerView === 'recent' ? 'Recently used stickers appear here.' : 'No sticker found.'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
