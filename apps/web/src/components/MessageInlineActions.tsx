import type { ReactNode, Ref } from 'react'
import { Bookmark, Edit3, Flag, Pin, PinOff, Reply, Smile, Trash2 } from 'lucide-react'

type MessageInlineActionsProps = {
  messageId: string
  currentUserId?: string | null
  authorUserId?: string | null
  canModerate?: boolean
  canReact?: boolean
  onToggleReactionPicker?: (messageId: string, anchorEl: HTMLButtonElement) => void
  reactionPickerOpen?: boolean
  canPin?: boolean
  isPinned?: boolean
  onPin?: (messageId: string) => void
  onUnpin?: (messageId: string) => void
  onReply?: () => void
  canSave?: boolean
  isSaved?: boolean
  onToggleSave?: () => void
  onReport?: () => void
  onEdit?: () => void
  onDelete?: () => void
  children?: ReactNode
  containerRef?: Ref<HTMLDivElement>
}

export default function MessageInlineActions({
  messageId,
  currentUserId,
  authorUserId,
  canModerate = false,
  canReact = false,
  onToggleReactionPicker,
  reactionPickerOpen = false,
  canPin = false,
  isPinned = false,
  onPin,
  onUnpin,
  onReply,
  canSave = false,
  isSaved = false,
  onToggleSave,
  onReport,
  onEdit,
  onDelete,
      children,
      containerRef,
}: MessageInlineActionsProps) {
  const isOwnMessage = !!authorUserId && authorUserId === currentUserId
  const canDelete = !!onDelete && (isOwnMessage || canModerate)
  const canEdit = !!onEdit && isOwnMessage

  if (
    !canReact &&
    !canPin &&
    !onReply &&
    !canSave &&
    !onReport &&
    !canEdit &&
    !canDelete &&
    !children
  ) {
    return null
  }

  return (
    <div className={`message-inline-actions${reactionPickerOpen ? ' is-visible' : ''}`} ref={containerRef}>
      {canReact && onToggleReactionPicker && (
        <button
          type="button"
          className={`message-inline-action-btn${reactionPickerOpen ? ' active' : ''}`}
          title="Add reaction"
          aria-label="Add reaction"
          onClick={(e) => {
            e.stopPropagation()
            onToggleReactionPicker(messageId, e.currentTarget)
          }}
        >
          <Smile size={14} />
        </button>
      )}
      {canPin && !isPinned && onPin && (
        <button
          type="button"
          className="message-inline-action-btn"
          title="Pin message"
          aria-label="Pin"
          onClick={(e) => {
            e.stopPropagation()
            onPin(messageId)
          }}
        >
          <Pin size={14} />
        </button>
      )}
      {canPin && isPinned && onUnpin && (
        <button
          type="button"
          className="message-inline-action-btn"
          title="Unpin message"
          aria-label="Unpin"
          onClick={(e) => {
            e.stopPropagation()
            onUnpin(messageId)
          }}
        >
          <PinOff size={14} />
        </button>
      )}
      {onReply && (
        <button
          type="button"
          className="message-inline-action-btn"
          title="Reply"
          aria-label="Reply"
          onClick={(e) => {
            e.stopPropagation()
            onReply()
          }}
        >
          <Reply size={14} />
        </button>
      )}
      {onReport && (
        <button
          type="button"
          className="message-inline-action-btn"
          title="Report"
          aria-label="Report"
          onClick={(e) => {
            e.stopPropagation()
            onReport()
          }}
        >
          <Flag size={14} />
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          className="message-inline-action-btn"
          title="Edit"
          aria-label="Edit"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          <Edit3 size={14} />
        </button>
      )}
      {canSave && onToggleSave && (
        <button
          type="button"
          className={`message-inline-action-btn ${isSaved ? 'active' : ''}`}
          title={isSaved ? 'Remove from saved' : 'Save media'}
          aria-label={isSaved ? 'Remove from saved' : 'Save media'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSave()
          }}
        >
          <Bookmark size={14} />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className="message-inline-action-btn danger"
          title="Delete"
          aria-label="Delete"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 size={14} />
        </button>
      )}
      {children}
    </div>
  )
}
