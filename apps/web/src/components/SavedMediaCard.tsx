import { ArrowRight, BookmarkMinus } from 'lucide-react'
import type { SavedMediaItem } from '../types'

export default function SavedMediaCard({
  item,
  onOpen,
  onRemove,
}: {
  item: SavedMediaItem
  onOpen: () => void
  onRemove: () => void
}) {
  const hasImage = item.attachments.some((attachment) => attachment.type?.startsWith('image/'))

  return (
    <div className="saved-media-card">
      <div className="saved-media-card-header">
        <div className="saved-media-card-copy">
          <div className="saved-media-card-title-row">
            <h3>{item.author_username}</h3>
          </div>
          <p className="saved-media-card-source">
            {item.source === 'server'
              ? `#${item.channel_name} in ${item.server_name ?? 'Server'}`
              : `DM with ${item.peer_username ?? item.channel_name}`}
          </p>
        </div>
        <div className="saved-media-card-toolbar">
          <button type="button" className="saved-media-open-btn" onClick={onOpen}>
            <ArrowRight size={13} />
            <span>{item.source === 'server' ? 'Open channel' : 'Open chat'}</span>
          </button>
        </div>
      </div>

      <div className="saved-media-card-body">
        <div className="saved-media-meta">
          <span className={`saved-media-tone ${hasImage ? 'saved-media-tone--image' : ''}`}>
            {hasImage ? 'Contains images' : 'Contains files'}
          </span>
        </div>
        <button
          type="button"
          className="saved-media-remove-btn saved-media-remove-btn--bottom"
          onClick={onRemove}
          title="Remove from saved"
        >
          <BookmarkMinus size={14} />
        </button>
      </div>
    </div>
  )
}
