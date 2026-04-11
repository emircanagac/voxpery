import { ArrowRight, BookmarkMinus, Hash, Image as ImageIcon, MessageCircleMore, Paperclip } from 'lucide-react'
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
  const attachmentCount = item.attachments.length
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
          <span className="saved-media-card-badge">{attachmentCount} {attachmentCount === 1 ? 'item' : 'items'}</span>
          <button type="button" className="saved-media-open-btn" onClick={onOpen}>
            <ArrowRight size={13} />
            <span>{item.source === 'server' ? 'Open channel' : 'Open chat'}</span>
          </button>
          <button type="button" className="saved-media-remove-btn" onClick={onRemove} title="Remove from saved">
            <BookmarkMinus size={14} />
          </button>
        </div>
      </div>

      <div className="saved-media-card-body">
        <div className="saved-media-attachments">
          {item.attachments.slice(0, 3).map((attachment, index) => (
            <div key={`${item.id}-${attachment.id ?? index}`} className="saved-media-chip">
              {attachment.type?.startsWith('image/') ? <ImageIcon size={13} /> : <Paperclip size={13} />}
              <span>{attachment.name || `Attachment ${index + 1}`}</span>
            </div>
          ))}
          {item.attachments.length > 3 && (
            <div className="saved-media-chip saved-media-chip--more">+{item.attachments.length - 3} more</div>
          )}
        </div>

        {item.content.trim() && (
          <div className="saved-media-snippet">
            <MessageCircleMore size={13} />
            <span>{item.content}</span>
          </div>
        )}

        <div className="saved-media-meta">
          <span className={`saved-media-tone ${hasImage ? 'saved-media-tone--image' : ''}`}>
            {hasImage ? 'Contains images' : 'Contains files'}
          </span>
          {item.source === 'server' && (
            <span className="saved-media-location-pill">
              <Hash size={12} />
              {item.channel_name}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
