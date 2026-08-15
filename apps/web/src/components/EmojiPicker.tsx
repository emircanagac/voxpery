import { Clock3, LoaderCircle, Search, Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
  getRecentEmojis,
  getRecentGifs,
  getRecentStickers,
  recordRecentEmoji,
  recordRecentGif,
  recordRecentSticker,
  toggleFavoriteGif,
} from '../expressionPreferences'
import { fetchGiphyGifs, isGiphyConfigured } from '../giphy'
import InlineMediaImage from './InlineMediaImage'

type PickerMode = 'emoji' | 'gif' | 'sticker'
type GifView = 'browse' | 'recent' | 'favorites'
type StickerView = 'browse' | 'recent'

type EmojiPickerProps = {
  onSelect: (emoji: string) => void
  compact?: boolean
  reactionMode?: boolean
  initialMode?: PickerMode
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
}: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [mode, setMode] = useState<PickerMode>(initialMode)
  const [gifView, setGifView] = useState<GifView>('browse')
  const [stickerView, setStickerView] = useState<StickerView>('browse')
  const [recentEmojis, setRecentEmojis] = useState(() => getRecentEmojis())
  const [recentGifs, setRecentGifs] = useState(() => getRecentGifs())
  const [recentStickers, setRecentStickers] = useState(() => getRecentStickers())
  const [favoriteGifs, setFavoriteGifs] = useState(() => getFavoriteGifs())
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
    const source = stickerView === 'recent' && !query.trim() ? recentStickers : filterStickerOptions(query)
    return query.trim() ? source.filter((entry) => mediaMatchesQuery(entry, query)) : source
  }, [mode, query, reactionMode, recentStickers, stickerView])

  const favoriteUrls = useMemo(() => new Set(favoriteGifs.map((entry) => entry.url)), [favoriteGifs])

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
      <div className="chat-emoji-search">
        <Search size={14} />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
        />
      </div>
      {!reactionMode && (
        <div className="chat-emoji-mode-tabs" role="tablist" aria-label="Expression types">
          {(['emoji', 'gif', 'sticker'] as PickerMode[]).map((entryMode) => (
            <button
              key={entryMode}
              type="button"
              role="tab"
              aria-selected={mode === entryMode}
              className={`chat-emoji-mode-tab${mode === entryMode ? ' active' : ''}`}
              onClick={() => {
                setMode(entryMode)
                setQuery('')
              }}
            >
              {entryMode === 'gif' ? 'GIF' : `${entryMode[0].toUpperCase()}${entryMode.slice(1)}`}
            </button>
          ))}
        </div>
      )}
      <div className="chat-emoji-content">
        {(reactionMode || mode === 'emoji') && (
          <>
            <div className="chat-emoji-tabs" role="tablist" aria-label="Emoji categories">
              {recentEmojiOptions.length > 0 && (
                <button
                  type="button"
                  className={`chat-emoji-tab${activeCategory === 'recent' ? ' active' : ''}`}
                  onClick={() => setActiveCategory('recent')}
                  title="Recently used"
                  aria-label="Recently used"
                >
                  <Clock3 size={12} aria-hidden="true" />
                </button>
              )}
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
              <div className="chat-expression-filter-tabs" role="tablist" aria-label="GIF collections">
                <button type="button" className={gifView === 'browse' ? 'active' : ''} onClick={() => setGifView('browse')}>Browse</button>
                <button type="button" className={gifView === 'recent' ? 'active' : ''} onClick={() => setGifView('recent')} disabled={recentGifs.length === 0}>Recent</button>
                <button type="button" className={gifView === 'favorites' ? 'active' : ''} onClick={() => setGifView('favorites')}>Favorites</button>
              </div>
            )}
            <div className="chat-gif-grid">
              {visibleGifs.map((entry) => {
                const favorite = favoriteUrls.has(entry.url)
                return (
                  <div key={`${entry.id}-${entry.url}`} className="chat-gif-card">
                    <button
                      type="button"
                      className="chat-gif-item"
                      onClick={() => selectGif(entry)}
                      title={entry.label}
                      aria-label={`Send ${entry.label}`}
                    >
                      <InlineMediaImage src={entry.previewUrl ?? entry.url} alt={entry.label} />
                    </button>
                    <button
                      type="button"
                      className={`chat-gif-favorite${favorite ? ' active' : ''}`}
                      onClick={() => setFavoriteGifs(toggleFavoriteGif(entry))}
                      title={favorite ? 'Remove from favorites' : 'Add to favorites'}
                      aria-label={favorite ? `Remove ${entry.label} from favorites` : `Add ${entry.label} to favorites`}
                    >
                      <Star size={14} fill={favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                )
              })}
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
              <div className="chat-expression-filter-tabs" role="tablist" aria-label="Sticker collections">
                <button type="button" className={stickerView === 'browse' ? 'active' : ''} onClick={() => setStickerView('browse')}>Browse</button>
                <button type="button" className={stickerView === 'recent' ? 'active' : ''} onClick={() => setStickerView('recent')} disabled={recentStickers.length === 0}>Recent</button>
              </div>
            )}
            <div className="chat-sticker-grid">
              {visibleStickers.map((entry) => (
                <button
                  key={`${entry.id}-${entry.imageUrl}`}
                  type="button"
                  className="chat-sticker-item"
                  onClick={() => selectSticker(entry)}
                  title={entry.label}
                  aria-label={`Send ${entry.label}`}
                >
                  <InlineMediaImage src={entry.previewUrl ?? entry.imageUrl} alt={entry.label} className="chat-sticker-image" />
                </button>
              ))}
            </div>
            {visibleStickers.length === 0 && (
              <div className="chat-emoji-empty">{stickerView === 'recent' ? 'Recently used stickers appear here.' : 'No sticker found.'}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
