import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Edit3, Flag, MoreHorizontal, Pin, PinOff, Reply, Smile, Trash2 } from 'lucide-react'

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
  onReport,
  onEdit,
  onDelete,
      children,
      containerRef,
}: MessageInlineActionsProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileMenuPosition, setMobileMenuPosition] = useState<{ left: number; top: number } | null>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const mobileMenuRef = useRef<HTMLDivElement | null>(null)
  const isOwnMessage = !!authorUserId && authorUserId === currentUserId
  const canDelete = !!onDelete && (isOwnMessage || canModerate)
  const canEdit = !!onEdit && isOwnMessage

  const runMobileAction = (action: () => void) => {
    setMobileMenuOpen(false)
    setMobileMenuPosition(null)
    action()
  }

  useEffect(() => {
    if (!mobileMenuOpen) return
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (mobileTriggerRef.current?.contains(target) || mobileMenuRef.current?.contains(target))) return
      setMobileMenuOpen(false)
      setMobileMenuPosition(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false)
        setMobileMenuPosition(null)
      }
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileMenuOpen])

  useLayoutEffect(() => {
    if (!mobileMenuOpen) return
    const trigger = mobileTriggerRef.current
    const menu = mobileMenuRef.current
    if (!trigger || !menu) return

    const triggerRect = trigger.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const viewportPadding = 8
    const gap = 6
    const maxLeft = Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding)
    const left = Math.min(maxLeft, Math.max(viewportPadding, triggerRect.right - menuRect.width))
    const spaceAbove = triggerRect.top - viewportPadding
    const top = spaceAbove >= menuRect.height + gap
      ? triggerRect.top - menuRect.height - gap
      : Math.min(
          window.innerHeight - menuRect.height - viewportPadding,
          triggerRect.bottom + gap,
        )
    setMobileMenuPosition({ left, top: Math.max(viewportPadding, top) })

    const closeForViewportChange = () => {
      setMobileMenuOpen(false)
      setMobileMenuPosition(null)
    }
    window.addEventListener('resize', closeForViewportChange)
    window.addEventListener('scroll', closeForViewportChange, true)
    return () => {
      window.removeEventListener('resize', closeForViewportChange)
      window.removeEventListener('scroll', closeForViewportChange, true)
    }
  }, [mobileMenuOpen])

  if (
    !canReact &&
    !canPin &&
    !onReply &&
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
          className={`message-inline-action-btn message-inline-action-btn--reaction${reactionPickerOpen ? ' active' : ''}`}
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
          className="message-inline-action-btn message-inline-action-btn--pin"
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
          className="message-inline-action-btn message-inline-action-btn--pin"
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
          className="message-inline-action-btn message-inline-action-btn--reply"
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
          className="message-inline-action-btn message-inline-action-btn--report"
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
          className="message-inline-action-btn message-inline-action-btn--edit"
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
      {canDelete && (
        <button
          type="button"
          className="message-inline-action-btn message-inline-action-btn--delete danger"
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
      <button
        ref={mobileTriggerRef}
        type="button"
        className="message-inline-actions-mobile-trigger"
        title="More message actions"
        aria-label="More message actions"
        aria-expanded={mobileMenuOpen}
        onClick={(event) => {
          event.stopPropagation()
          setMobileMenuOpen((open) => {
            if (open) setMobileMenuPosition(null)
            return !open
          })
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {mobileMenuOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={mobileMenuRef}
          className="message-mobile-actions-menu"
          role="menu"
          aria-label="Message actions"
          style={mobileMenuPosition
            ? { left: mobileMenuPosition.left, top: mobileMenuPosition.top }
            : { left: 0, top: 0, visibility: 'hidden' }}
        >
          {canReact && onToggleReactionPicker && (
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation()
                const anchor = mobileTriggerRef.current ?? event.currentTarget
                runMobileAction(() => onToggleReactionPicker(messageId, anchor))
              }}
            >
              <Smile size={15} />
              <span>Add reaction</span>
            </button>
          )}
          {canPin && !isPinned && onPin && (
            <button type="button" role="menuitem" onClick={(event) => {
              event.stopPropagation()
              runMobileAction(() => onPin(messageId))
            }}>
              <Pin size={15} />
              <span>Pin message</span>
            </button>
          )}
          {canPin && isPinned && onUnpin && (
            <button type="button" role="menuitem" onClick={(event) => {
              event.stopPropagation()
              runMobileAction(() => onUnpin(messageId))
            }}>
              <PinOff size={15} />
              <span>Unpin message</span>
            </button>
          )}
          {onReply && (
            <button type="button" role="menuitem" onClick={(event) => {
              event.stopPropagation()
              runMobileAction(onReply)
            }}>
              <Reply size={15} />
              <span>Reply</span>
            </button>
          )}
          {onReport && (
            <button type="button" role="menuitem" onClick={(event) => {
              event.stopPropagation()
              runMobileAction(onReport)
            }}>
              <Flag size={15} />
              <span>Report</span>
            </button>
          )}
          {canEdit && onEdit && (
            <button type="button" role="menuitem" onClick={(event) => {
              event.stopPropagation()
              runMobileAction(onEdit)
            }}>
              <Edit3 size={15} />
              <span>Edit</span>
            </button>
          )}
          {canDelete && onDelete && (
            <button className="danger" type="button" role="menuitem" onClick={(event) => {
              event.stopPropagation()
              runMobileAction(onDelete)
            }}>
              <Trash2 size={15} />
              <span>Delete</span>
            </button>
          )}
        </div>,
        document.body,
      )}
      {children}
    </div>
  )
}
