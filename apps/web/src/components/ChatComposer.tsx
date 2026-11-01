import type { KeyboardEvent } from 'react'
import type { DraftAttachmentItem } from '../draftAttachments'
import type { Channel } from '../types'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { Send, Paperclip, X, Smile, ArrowDown, LoaderCircle } from 'lucide-react'
import { hasPendingDraftAttachments } from '../draftAttachments'
import EmojiPicker from './EmojiPicker'
import DraftAttachmentCard from './DraftAttachmentCard'
import { setLastExpressionMode } from '../expressionPreferences'
import { messageBodyLimit } from '../messageLength'

export type MentionUser = {
    user_id: string
    username: string
    avatar_url?: string | null
    status?: string | null
}

export type MessagePickerMode = 'emoji' | 'gif' | 'sticker'

function mentionStatusTone(status?: string | null): 'online' | 'dnd' | 'offline' {
  const normalized = (status ?? 'offline').toLowerCase()
  if (normalized === 'online') return 'online'
  if (normalized === 'dnd') return 'dnd'
  return 'offline'
}

interface ChatComposerProps {
  activeChannel: Channel
  applyMention: (member: MentionUser) => void
  attachmentInputRef: RefObject<HTMLInputElement | null>
  canSendMessages: boolean
  closeMentionMenu: () => void
  composerBlockedMessage: string | null
  draftAttachments: DraftAttachmentItem[]
  emojiOpen: boolean
  emojiPickerAnchorRef: RefObject<HTMLButtonElement | null>
  emojiPickerPosition: { top: number; left: number; width: number; height: number; } | null
  emojiPickerRef: RefObject<HTMLDivElement | null>
  handleInputChange: (value: string, cursor: number | null) => void
  handleKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  inputWasShortened: boolean
  insertEmoji: (emoji: string) => void
  isDm: boolean
  isGroupDm: boolean
  mentionActiveIndex: number
  mentionOpen: boolean
  mentionSuggestions: MentionUser[]
  messageInput: string
  messageInputWrapperRef: RefObject<HTMLDivElement | null>
  messagePickerMode: MessagePickerMode
  newWhileReadingCount: number
  olderMessagesAnchorRef: RefObject<{ scrollTop: number; scrollHeight: number; messageId?: string; messageIndex?: number; offsetTop?: number; } | null>
  onCancelReply: (() => void) | undefined
  onPickAttachments: (files: FileList | null) => void
  onRemoveAttachment: (index: number) => void
  onRetryAttachment: ((localId: string) => void) | undefined
  onReturnToLatest: (() => void) | undefined
  preservingOlderMessagesRef: RefObject<boolean>
  remainingCharacters: number
  replyingTo: { id: string; username: string; contentSnippet: string; } | null | undefined
  returningToLatest: boolean
  setEmojiOpen: Dispatch<SetStateAction<boolean>>
  setMessagePickerMode: Dispatch<SetStateAction<MessagePickerMode>>
  shouldAutoScrollRef: RefObject<boolean>
  showJumpToLatest: boolean
  snapToBottom: (expectedChannelId?: string | null) => false
  submitMessage: (forceContent?: string) => void
  syncMentionMenu: (value: string, cursor: number | null) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  toggleMessagePicker: (anchor: HTMLButtonElement) => void
  useCompactMobileTimestamp: boolean
  useMobileMessageLayout: boolean
  userReadingHistoryRef: RefObject<boolean>
  userScrollIntentUntilRef: RefObject<number>
}

export default function ChatComposer({
  activeChannel,
  applyMention,
  attachmentInputRef,
  canSendMessages,
  closeMentionMenu,
  composerBlockedMessage,
  draftAttachments,
  emojiOpen,
  emojiPickerAnchorRef,
  emojiPickerPosition,
  emojiPickerRef,
  handleInputChange,
  handleKeyDown,
  handlePaste,
  inputWasShortened,
  insertEmoji,
  isDm,
  isGroupDm,
  mentionActiveIndex,
  mentionOpen,
  mentionSuggestions,
  messageInput,
  messageInputWrapperRef,
  messagePickerMode,
  newWhileReadingCount,
  olderMessagesAnchorRef,
  onCancelReply,
  onPickAttachments,
  onRemoveAttachment,
  onRetryAttachment,
  onReturnToLatest,
  preservingOlderMessagesRef,
  remainingCharacters,
  replyingTo,
  returningToLatest,
  setEmojiOpen,
  setMessagePickerMode,
  shouldAutoScrollRef,
  showJumpToLatest,
  snapToBottom,
  submitMessage,
  syncMentionMenu,
  textareaRef,
  toggleMessagePicker,
  useCompactMobileTimestamp,
  useMobileMessageLayout,
  userReadingHistoryRef,
  userScrollIntentUntilRef,
}: ChatComposerProps) {
  return (
    <>
      <div className="message-input-container">
          {(showJumpToLatest || onReturnToLatest) && (
              <button
                  type="button"
                  className="chat-jump-to-latest"
                  disabled={returningToLatest}
                  onClick={() => {
                      if (onReturnToLatest) {
                          onReturnToLatest()
                          return
                      }
                      userReadingHistoryRef.current = false
                      userScrollIntentUntilRef.current = 0
                      shouldAutoScrollRef.current = true
                      preservingOlderMessagesRef.current = false
                      olderMessagesAnchorRef.current = null
                      snapToBottom()
                      requestAnimationFrame(() => {
                          snapToBottom()
                      })
                  }}
                  aria-label={newWhileReadingCount > 0
                      ? `${newWhileReadingCount} new message${newWhileReadingCount === 1 ? '' : 's'}, jump to latest`
                      : 'Jump to latest messages'}
                  title={returningToLatest ? 'Loading latest messages' : 'Jump to latest messages'}
                  aria-busy={returningToLatest}
                  data-new-messages={newWhileReadingCount > 0 ? 'true' : undefined}
              >
                  {returningToLatest ? <LoaderCircle size={20} aria-hidden="true" /> : <ArrowDown size={20} aria-hidden="true" />}
                  {!returningToLatest && newWhileReadingCount > 0 && (
                      <span className="chat-jump-to-latest-label" aria-hidden="true">
                          {newWhileReadingCount > 99 ? '99+' : newWhileReadingCount} new {newWhileReadingCount === 1 ? 'message' : 'messages'}
                      </span>
                  )}
              </button>
          )}
          {replyingTo && onCancelReply && (
              <div className="message-reply-bar">
                  <span className="message-reply-bar-label">Replying to @{replyingTo.username}</span>
                  <span className="message-reply-bar-snippet">{replyingTo.contentSnippet}</span>
                  <button type="button" className="message-reply-bar-cancel" onClick={onCancelReply} aria-label="Cancel reply">
                      <X size={14} />
                  </button>
              </div>
          )}
          {mentionOpen && mentionSuggestions.length > 0 && (
              <div id="mention-suggestions" className="mention-suggest-menu" role="listbox" aria-label="Mention suggestions">
                  {mentionSuggestions.map((member, index) => (
                      <button
                          key={`${member.user_id}-${member.username}`}
                          type="button"
                          className={`mention-suggest-item ${index === mentionActiveIndex ? 'active' : ''}`}
                          id={`mention-option-${index}`}
                          role="option"
                          aria-selected={index === mentionActiveIndex}
                          tabIndex={-1}
                          onMouseDown={(e) => {
                              e.preventDefault()
                              applyMention(member)
                          }}
                      >
                          {member.user_id !== '__all__' && (
                              <span
                                  className={`mention-suggest-status mention-suggest-status--${mentionStatusTone(member.status)}`}
                                  aria-hidden="true"
                              />
                          )}
                          <span className="mention-suggest-name">@{member.username}</span>
                          {member.user_id === '__all__' && (
                              <span className="mention-suggest-hint">Notify everyone</span>
                          )}
                      </button>
                  ))}
              </div>
          )}
          {draftAttachments.length > 0 && (
              <div className="dm-draft-attachments">
                  {draftAttachments.map((att, i) => <DraftAttachmentCard
                      key={att.localId}
                      attachment={att}
                      onRemove={() => onRemoveAttachment(i)}
                      onRetry={onRetryAttachment ? () => onRetryAttachment(att.localId) : undefined}
                  />)}
              </div>
          )}
          <div className="message-input-wrapper" ref={messageInputWrapperRef}>
              <button type="button" className="dm-attach-btn" title="Attach files" aria-label="Attach files" disabled={!canSendMessages} onClick={() => attachmentInputRef.current?.click()}>
                  <Paperclip size={18} aria-hidden="true" />
              </button>
              <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  accept="*/*"
                  style={{ display: 'none' }}
                  disabled={!canSendMessages}
                  onChange={(e) => {
                      onPickAttachments(e.target.files)
                      e.currentTarget.value = ''
                  }}
              />
              <button
                  type="button"
                  className="chat-emoji-btn"
                  disabled={!canSendMessages}
                  title="Emoji, GIFs and stickers"
                  aria-label="Emoji, GIFs and stickers"
                  aria-expanded={emojiOpen}
                  aria-controls={emojiOpen ? 'message-expression-picker' : undefined}
                  aria-haspopup="dialog"
                  onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      toggleMessagePicker(e.currentTarget)
                  }}
              >
                  <Smile size={18} aria-hidden="true" />
              </button>
              {emojiOpen && emojiPickerPosition && createPortal(
                  <div
                      ref={emojiPickerRef}
                      id="message-expression-picker"
                      role="dialog"
                      aria-label="Emoji, GIFs and stickers"
                      className="chat-emoji-picker-shell chat-emoji-picker-portal"
                      style={{
                          top: emojiPickerPosition.top,
                          left: emojiPickerPosition.left,
                          width: emojiPickerPosition.width,
                          height: emojiPickerPosition.height,
                      }}
                      onClick={(e) => e.stopPropagation()}
                  >
                      <EmojiPicker initialMode={messagePickerMode} onSelect={insertEmoji} autoFocus onClose={() => {
                          setEmojiOpen(false)
                          emojiPickerAnchorRef.current?.focus({ preventScroll: true })
                      }} onModeChange={mode => {
                          setMessagePickerMode(mode)
                          setLastExpressionMode(mode)
                      }} />
                  </div>,
                  document.body
              )}
              <textarea
                  ref={textareaRef}
                  className="message-input"
                  aria-label={isDm ? (isGroupDm ? `Message ${activeChannel.name}` : `Message @${activeChannel.name}`) : `Message #${activeChannel.name}`}
                  aria-autocomplete="list"
                  aria-controls={mentionOpen && mentionSuggestions.length > 0 ? 'mention-suggestions' : undefined}
                  aria-activedescendant={mentionOpen && mentionSuggestions.length > 0 ? `mention-option-${mentionActiveIndex}` : undefined}
                  value={messageInput}
                  maxLength={messageBodyLimit(replyingTo) * 2}
                  disabled={!canSendMessages}
                  onChange={(e) => handleInputChange(e.target.value, e.target.selectionStart)}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => syncMentionMenu(messageInput, e.currentTarget.selectionStart)}
                  onKeyUp={(e) => {
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return
                      syncMentionMenu(messageInput, e.currentTarget.selectionStart)
                  }}
                  onBlur={() => {
                      window.setTimeout(() => {
                          closeMentionMenu()
                      }, 120)
                  }}
                  onPaste={handlePaste}
                  placeholder={canSendMessages
                      ? (useCompactMobileTimestamp ? 'Message' : (isDm ? (isGroupDm ? `Message ${activeChannel.name}` : `Message @${activeChannel.name}`) : `Message #${activeChannel.name}`))
                      : (composerBlockedMessage ?? (useCompactMobileTimestamp ? 'Read only' : `You don't have permission to send messages in #${activeChannel.name}`))}
                  rows={1}
              />
              {canSendMessages && (!useMobileMessageLayout || remainingCharacters <= 200) && (
                  <span className={`message-character-count${remainingCharacters < 0 ? ' is-over-limit' : remainingCharacters === 0 ? ' is-at-limit' : ''}`} aria-label="Characters remaining">
                      {remainingCharacters < 0 ? `${-remainingCharacters} over limit` : remainingCharacters}
                  </span>
              )}
              {canSendMessages && inputWasShortened && (
                  <span className="message-truncation-note" role="status">
                      Shortened to {messageBodyLimit(replyingTo)} characters
                  </span>
              )}
              <div className="message-input-actions" aria-label="Message actions">
                  <button
                      type="button"
                      className={`message-send-btn ${(messageInput.trim() || draftAttachments.length > 0) ? 'is-ready' : ''}`}
                      disabled={!canSendMessages || hasPendingDraftAttachments(draftAttachments) || (!messageInput.trim() && draftAttachments.length === 0)}
                      title="Send message"
                      aria-label="Send message"
                      onClick={() => {
                          if (!canSendMessages) return
                          submitMessage()
                      }}
                  >
                      <Send size={18} />
                  </button>
              </div>
          </div>
      </div>
    </>
  )
}
