import type { Message } from '../api'
import type { ReactNode } from 'react'
import type { Channel } from '../types'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { AtSign, Hash, X, Search, ChevronLeft, ChevronRight, Pin, PinOff, Users } from 'lucide-react'

interface ChatHeaderProps {
  activeChannel: Channel
  applySearchFilter: (token: "from:" | "has:attachment") => void
  closeSearch: () => void
  formatPinnedDate: (dateStr: string) => string
  headerActions: ReactNode
  isDm: boolean
  isGroupDm: boolean
  memberButtonLabel: "View members" | "Hide member list" | "Show member list"
  memberPanelOpen: boolean | undefined
  onGoToPinnedMessage: ((messageId: string) => void) | undefined
  onOpenChannelList: (() => void) | undefined
  onOpenMemberSheet: (() => void) | undefined
  onPinMessage: ((messageId: string) => void) | undefined
  onSearchChange: ((value: string) => void) | undefined
  onUnpinMessage: ((messageId: string) => void) | undefined
  pinnedDropdownRef: RefObject<HTMLDivElement | null>
  pinnedJumpLoadingId: string | null
  pinnedMessages: Message[]
  pinnedOpen: boolean
  scrollToMessageId: (messageId: string, behavior?: ScrollBehavior) => void
  searchDropdownRef: RefObject<HTMLDivElement | null>
  searchHelpRef: RefObject<HTMLDetailsElement | null>
  searchInputRef: RefObject<HTMLInputElement | null>
  searchOpen: boolean
  searchQuery: string
  searchTriggerRef: RefObject<HTMLButtonElement | null>
  setPinnedOpen: Dispatch<SetStateAction<boolean>>
  setSearchOpen: Dispatch<SetStateAction<boolean>>
  showMemberSheetButton: boolean
}

export default function ChatHeader({
  activeChannel,
  applySearchFilter,
  closeSearch,
  formatPinnedDate,
  headerActions,
  isDm,
  isGroupDm,
  memberButtonLabel,
  memberPanelOpen,
  onGoToPinnedMessage,
  onOpenChannelList,
  onOpenMemberSheet,
  onPinMessage,
  onSearchChange,
  onUnpinMessage,
  pinnedDropdownRef,
  pinnedJumpLoadingId,
  pinnedMessages,
  pinnedOpen,
  scrollToMessageId,
  searchDropdownRef,
  searchHelpRef,
  searchInputRef,
  searchOpen,
  searchQuery,
  searchTriggerRef,
  setPinnedOpen,
  setSearchOpen,
  showMemberSheetButton,
}: ChatHeaderProps) {
  return (
    <>
      <div className={`chat-header${searchOpen ? ' chat-header--searching' : ''}`}>
          {onOpenChannelList && (
              <button
                  type="button"
                  className="chat-header-member-btn chat-header-channels-btn"
                  onClick={onOpenChannelList}
                  title="Channels"
                  aria-label="Open channel list"
              >
                  <ChevronLeft size={20} />
              </button>
          )}
          <span className="channel-hash">
              {isDm ? (isGroupDm ? <Users size={20} aria-hidden="true" /> : <AtSign size={20} aria-hidden="true" />) : <Hash size={20} />}
          </span>
          <div className="channel-header-copy">
              <h1 className="channel-title">{activeChannel.name}</h1>
              {activeChannel.description?.trim() && (
                  <>
                      <span className="channel-description-separator" aria-hidden="true" />
                      <span className="channel-description">{activeChannel.description.trim()}</span>
                  </>
              )}
          </div>
          <div className="chat-header-right">
              {onSearchChange && (
                  <div
                      ref={searchDropdownRef}
                      className={`chat-header-search ${searchOpen ? 'chat-header-search-expanded' : ''}`}
                      onClick={(e) => e.stopPropagation()}
                  >
                      {!searchOpen ? (
                          <button
                              type="button"
                              className="chat-header-search-trigger"
                              ref={searchTriggerRef}
                              onClick={(e) => {
                                  e.stopPropagation()
                                  setPinnedOpen(false)
                                  setSearchOpen(true)
                                  setTimeout(() => searchInputRef.current?.focus(), 0)
                              }}
                              title="Search in conversation"
                              aria-label="Search in conversation"
                          >
                              <Search size={18} aria-hidden />
                          </button>
                      ) : (
                          <>
                              <Search size={16} className="chat-header-search-icon" aria-hidden />
                              <input
                                  ref={searchInputRef}
                                  type="text"
                                  className="chat-header-search-input"
                                  placeholder="Search messages"
                                  value={searchQuery}
                                  onChange={(e) => onSearchChange(e.target.value)}
                                  title="Search text. Filters: from:username, has:attachment"
                                  aria-label="Search messages"
                              />
                              <details ref={searchHelpRef} className="chat-header-search-help">
                                  <summary>Filters</summary>
                                  <div className="chat-header-search-help-panel" role="note">
                                      <button
                                          type="button"
                                          onClick={() => applySearchFilter('from:')}
                                          title="Add author filter"
                                          aria-label="Filter messages by author"
                                      >
                                          from:
                                      </button>
                                      <button
                                          type="button"
                                          onClick={() => applySearchFilter('has:attachment')}
                                          title="Only show messages with attachments"
                                          aria-label="Filter messages with attachments"
                                      >
                                          has:attachment
                                      </button>
                                  </div>
                              </details>
                              <button
                                  type="button"
                                  className="chat-header-search-close"
                                  onClick={(e) => {
                                      e.stopPropagation()
                                      closeSearch()
                                  }}
                                  title="Close search"
                                  aria-label="Close search"
                              >
                                  <X size={14} aria-hidden />
                              </button>
                          </>
                      )}
                  </div>
              )}
              {(onSearchChange != null || onPinMessage != null || (pinnedMessages?.length ?? 0) > 0) && (
              <div className="chat-header-pinned-wrap" ref={pinnedDropdownRef}>
                  <button
                      type="button"
                      className="chat-header-pinned-btn"
                      onClick={() => {
                          if (!pinnedOpen) {
                              onSearchChange?.('')
                              setSearchOpen(false)
                          }
                          setPinnedOpen((o) => !o)
                      }}
                      title="Pinned messages"
                      aria-label="Pinned messages"
                      aria-expanded={pinnedOpen}
                  >
                      <Pin size={18} />
                  </button>
                  {pinnedOpen && (
                      <div className="chat-header-pinned-dropdown">
                          <div className="chat-header-pinned-title">
                              <span className="chat-header-pinned-title-main">
                                  <Pin size={14} aria-hidden />
                                  Pinned messages
                              </span>
                              <span className="chat-header-pinned-title-count">
                                  {pinnedMessages.length}
                              </span>
                          </div>
                          {pinnedMessages.length === 0 ? (
                              <div className="chat-header-pinned-empty">No pinned messages yet</div>
                          ) : (
                              <ul className="chat-header-pinned-list">
                                  {pinnedMessages.map((m) => (
                                      <li key={m.id} className="chat-header-pinned-item">
                                          <div className="chat-header-pinned-item-meta">
                                              <div className="chat-header-pinned-item-head">
                                                  <span className="chat-header-pinned-item-author-group">
                                                      <span className="chat-header-pinned-item-author-label">From</span>
                                                      <span className="chat-header-pinned-item-author">{m.author?.username}</span>
                                                  </span>
                                                  {m.created_at && (
                                                      <span className="chat-header-pinned-item-date">{formatPinnedDate(m.created_at)}</span>
                                                  )}
                                              </div>
                                              <div className="chat-header-pinned-item-content-wrap">
                                                  <span className="chat-header-pinned-item-content-label">Message</span>
                                                  <span className="chat-header-pinned-item-content">{m.content.slice(0, 200)}{m.content.length > 200 ? '…' : ''}</span>
                                              </div>
                                          </div>
                                          <div className="chat-header-pinned-item-actions">
                                              <button
                                                  type="button"
                                                  className="chat-header-pinned-goto"
                                                  title="Go to message"
                                                  aria-label="Go to message"
                                                  disabled={pinnedJumpLoadingId !== null}
                                                  aria-busy={pinnedJumpLoadingId === m.id}
                                                  onClick={() => {
                                                      setPinnedOpen(false)
                                                      if (onGoToPinnedMessage) onGoToPinnedMessage(m.id)
                                                      else scrollToMessageId(m.id)
                                                  }}
                                              >
                                                  <ChevronRight size={18} aria-hidden />
                                              </button>
                                              {onUnpinMessage && (
                                                  <button
                                                      type="button"
                                                      className="chat-header-pinned-unpin"
                                                      title="Unpin"
                                                      onClick={() => onUnpinMessage(m.id)}
                                                  >
                                                      <PinOff size={14} />
                                                  </button>
                                              )}
                                          </div>
                                      </li>
                                  ))}
                              </ul>
                          )}
                      </div>
                  )}
              </div>
              )}
              {showMemberSheetButton && onOpenMemberSheet && (
                  <button
                      type="button"
                      className="chat-header-member-btn"
                      onClick={onOpenMemberSheet}
                      title={memberButtonLabel}
                      aria-label={memberButtonLabel}
                      aria-pressed={memberPanelOpen}
                  >
                      <Users size={17} />
                  </button>
              )}
              {headerActions}
          </div>
      </div>
    </>
  )
}
