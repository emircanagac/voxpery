import { useRef, useEffect, useMemo, useState, useCallback, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Hash, Volume2, Send, Paperclip, X, Trash2, Reply, Edit3, Save, Share2 } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Attachment } from '../types'
import type { MessageWithAuthor, Channel, Friend } from '../api'
import { openExternalUrl } from '../openExternalUrl'

type UiMessage = MessageWithAuthor & {
    clientId?: string
    clientStatus?: 'sending' | 'failed'
    clientError?: string
}

type MentionUser = {
    user_id: string
    username: string
    avatar_url?: string | null
}

/** Synthetic entry for @all mention (server-wide). Shown at top when user types @. */
const MENTION_ALL: MentionUser = { user_id: '__all__', username: 'all' }

interface ChatAreaProps {
    activeChannel: Channel | undefined
    messages: UiMessage[]
    draftAttachments: Array<{ name: string; url: string; size: number; type: string }>
    messageInput: string
    onPickAttachments: (files: FileList | null) => void
    onRemoveAttachment: (index: number) => void
    onMessageInputChange: (value: string) => void
    onSendMessage: (e?: FormEvent) => void
    onRetryMessage: (clientId: string) => void
    onDeleteMessage?: (messageId: string) => void
    onReplyToMessage?: (msg: { id: string; author?: { username?: string }; content: string }) => void
    replyingTo?: { id: string; username: string; contentSnippet: string } | null
    onCancelReply?: () => void
    onForwardMessage?: (msg: { author?: { username?: string }; content: string }, targetChannelId: string) => void
    onForwardToFriend?: (msg: { author?: { username?: string }; content: string }, friendId: string) => void
    channelsForForward?: Channel[]
    friendsForForward?: Friend[]
    editingMessageId?: string | null
    editingContent?: string
    onEditMessage?: (msg: { id: string; content: string; contentToEdit?: string; replyQuotePart?: string }) => void
    onEditingContentChange?: (value: string) => void
    onSaveEdit?: () => void
    onCancelEdit?: () => void
    currentUserId?: string | null
    canModerate?: boolean
    mentionUsers?: MentionUser[]
    /** When true, placeholder shows Message @name; header still uses #name like server */
    isDm?: boolean
    /** When true, the Messages/DM view is active (e.g. user switched back from Servers); used to scroll to bottom on re-enter */
    isViewActive?: boolean
    /** Pagination: more messages can be loaded above (older) */
    hasMoreOlder?: boolean
    loadingOlder?: boolean
    onLoadOlder?: () => void
    onScrollRefReady?: (el: HTMLDivElement | null) => void
}

export default function ChatArea({
    activeChannel,
    messages,
    draftAttachments,
    messageInput,
    onPickAttachments,
    onRemoveAttachment,
    onMessageInputChange,
    onSendMessage,
    onRetryMessage,
    onDeleteMessage,
    onReplyToMessage,
    replyingTo,
    onCancelReply,
    onForwardMessage,
    onForwardToFriend,
    channelsForForward,
    friendsForForward,
    editingMessageId,
    editingContent = '',
    onEditMessage,
    onEditingContentChange,
    onSaveEdit,
    onCancelEdit,
    currentUserId,
    canModerate = false,
    mentionUsers = [],
    isDm = false,
    isViewActive,
    hasMoreOlder = false,
    loadingOlder = false,
    onLoadOlder,
    onScrollRefReady,
}: ChatAreaProps) {
    const messagesScrollRef = useRef<HTMLDivElement>(null)
    const setMessagesScrollRef = useCallback(
        (el: HTMLDivElement | null) => {
            (messagesScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el
            onScrollRefReady?.(el)
        },
        [onScrollRefReady]
    )
    const shouldAutoScrollRef = useRef(true)
    const prevViewActiveRef = useRef(isViewActive)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const [forwardPickerMessageId, setForwardPickerMessageId] = useState<string | null>(null)
    const [mentionOpen, setMentionOpen] = useState(false)
    const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null)
    const [mentionQuery, setMentionQuery] = useState('')
    const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
    const [clickedLink, setClickedLink] = useState<string | null>(null)

    const textChannelsForForward = channelsForForward?.filter((c) => c.channel_type === 'text' && c.id !== activeChannel?.id) ?? []
    const mentionCandidates = useMemo(() => {
        const seen = new Set<string>()
        return mentionUsers.filter((member) => {
            const key = member.username.trim().toLowerCase()
            if (!key || seen.has(key)) return false
            if (key === 'all') return false
            seen.add(key)
            return true
        })
    }, [mentionUsers])
    const mentionSuggestions = useMemo(() => {
        if (!mentionOpen) return []
        const query = mentionQuery.trim().toLowerCase()
        const filtered = query.length === 0
            ? mentionCandidates
            : mentionCandidates.filter((member) => member.username.toLowerCase().includes(query))
        const showAll = query.length === 0 || 'all'.startsWith(query)
        const withAll = showAll ? [MENTION_ALL, ...filtered] : filtered
        return withAll.slice(0, 9)
    }, [mentionCandidates, mentionOpen, mentionQuery])

    const rowVirtualizer = useVirtualizer({
        count: messages.length,
        getScrollElement: () => messagesScrollRef.current,
        getItemKey: (index) => messages[index]?.id ?? index,
        // Keep server chat row height tight even before first measurement.
        estimateSize: () => 64,
        measureElement: (el) => el?.getBoundingClientRect().height ?? 64,
        overscan: 8,
    })

    /* When switching channel/DM, reset auto-scroll and scroll to bottom so user sees latest messages */
    useEffect(() => {
        shouldAutoScrollRef.current = true
    }, [activeChannel?.id])

    /* Scroll to bottom when opening a chat or when messages load (e.g. DM opened from Messages view) */
    useEffect(() => {
        if (messages.length === 0) return
        if (!shouldAutoScrollRef.current) return
        /* Short delay so virtualizer has laid out after async message load (e.g. DM from Messages) */
        const t = setTimeout(() => {
            rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
        }, 50)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only scroll when channel or message count changes
    }, [activeChannel?.id, messages.length])

    /* When user switches back from Servers to Messages/DM, scroll to bottom so latest messages are visible */
    useEffect(() => {
        const becameVisible = isViewActive === true && prevViewActiveRef.current === false
        prevViewActiveRef.current = isViewActive ?? true
        if (!becameVisible || messages.length === 0) return
        shouldAutoScrollRef.current = true
        const t = setTimeout(() => {
            rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
        }, 50)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only when view becomes visible
    }, [isViewActive, messages.length])

    /* When replying to a message, scroll so the replied-to message stays visible above the reply bar */
    useEffect(() => {
        if (!replyingTo?.id || messages.length === 0) return
        const index = messages.findIndex((m) => m.id === replyingTo.id)
        if (index < 0) return
        rowVirtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' })
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only scroll when reply target is set
    }, [replyingTo?.id])

    const getInitial = (name: string) => (name || '?').charAt(0).toUpperCase()
    const getAuthorAvatarUrl = (author: { avatar_url?: string | null; avatarUrl?: string | null }) => {
        const url = author?.avatar_url ?? author?.avatarUrl ?? ''
        return typeof url === 'string' ? url.trim() : ''
    }

    const formatTime = (dateStr: string) => {
        const d = new Date(dateStr)
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr)
        const today = new Date()
        if (d.toDateString() === today.toDateString()) return `Today at ${formatTime(dateStr)}`
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + formatTime(dateStr)
    }

    const closeMentionMenu = () => {
        setMentionOpen(false)
        setMentionStartIndex(null)
        setMentionQuery('')
        setMentionActiveIndex(0)
    }

    const getMentionContext = (value: string, cursor: number | null) => {
        if (cursor == null || cursor < 0) return null
        const left = value.slice(0, cursor)
        const atIndex = left.lastIndexOf('@')
        if (atIndex < 0) return null
        const prefixChar = atIndex === 0 ? ' ' : left[atIndex - 1]
        if (!/\s/.test(prefixChar)) return null
        const query = left.slice(atIndex + 1)
        if (/\s/.test(query) || query.length > 32) return null
        return { start: atIndex, query }
    }

    const syncMentionMenu = (value: string, cursor: number | null) => {
        const ctx = getMentionContext(value, cursor)
        if (!ctx) {
            closeMentionMenu()
            return
        }
        setMentionOpen(true)
        setMentionStartIndex(ctx.start)
        setMentionQuery(ctx.query)
        setMentionActiveIndex(0)
    }

    const applyMention = (member: MentionUser) => {
        if (mentionStartIndex == null || !textareaRef.current) return
        const input = textareaRef.current
        const cursor = input.selectionStart ?? messageInput.length
        const before = messageInput.slice(0, mentionStartIndex)
        const after = messageInput.slice(cursor)
        const mentionText = `@${member.username} `
        const next = `${before}${mentionText}${after}`
        onMessageInputChange(next)
        closeMentionMenu()
        requestAnimationFrame(() => {
            textareaRef.current?.focus()
            const pos = before.length + mentionText.length
            textareaRef.current?.setSelectionRange(pos, pos)
        })
    }

    const handleInputChange = (value: string, cursor: number | null) => {
        onMessageInputChange(value)
        syncMentionMenu(value, cursor)
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (mentionOpen && mentionSuggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMentionActiveIndex((idx) => (idx + 1) % mentionSuggestions.length)
                return
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionActiveIndex((idx) => (idx - 1 + mentionSuggestions.length) % mentionSuggestions.length)
                return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                applyMention(mentionSuggestions[mentionActiveIndex] ?? mentionSuggestions[0])
                return
            }
            if (e.key === 'Escape') {
                e.preventDefault()
                closeMentionMenu()
                return
            }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSendMessage()
        }
    }

    useEffect(() => {
        if (!mentionOpen) return
        if (mentionSuggestions.length === 0) {
            setMentionActiveIndex(0)
            return
        }
        if (mentionActiveIndex >= mentionSuggestions.length) {
            setMentionActiveIndex(0)
        }
    }, [mentionActiveIndex, mentionOpen, mentionSuggestions.length])

    useEffect(() => {
        closeMentionMenu()
    }, [activeChannel?.id])

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const dt = e.clipboardData
        if (!dt) return
        const files: File[] = []
        if (dt.files) {
            for (let i = 0; i < dt.files.length; i++) files.push(dt.files[i])
        }
        if (files.length === 0 && dt.items) {
            for (let i = 0; i < dt.items.length; i++) {
                const item = dt.items[i]
                if (item.kind === 'file') {
                    const file = item.getAsFile()
                    if (file) files.push(file)
                }
            }
        }
        if (files.length === 0) return
        e.preventDefault()
        const dataTransfer = new DataTransfer()
        files.forEach((f) => dataTransfer.items.add(f))
        onPickAttachments(dataTransfer.files)
    }

    const renderMessageWithMentions = (content: string) => {
        // Split by mentions OR direct http/https URLs
        // We match mentions: @[^\s@]{2,32} or @all or @everyone
        // And we match urls: https?:\/\/[^\s]+
        const parts = content.split(/(@[^\s@]{2,32}|@all|@everyone|https?:\/\/[^\s]+)/g)
        return parts.map((part, idx) => {
            if (!part) return null
            if (part === '@all') {
                return <span key={idx} className="mention-pill mention-pill-all">{part}</span>
            }
            if (part === '@everyone') {
                return <span key={idx}>{part}</span>
            }
            if (part.startsWith('http://') || part.startsWith('https://')) {

                return (
                    <a
                        key={idx}
                        href="#"
                        className="chat-link"
                        onClick={(e) => {
                            e.preventDefault()
                            setClickedLink(part)
                        }}
                    >
                        {part}
                    </a>
                )
            }
            if (part.startsWith('@')) {
                const username = part.slice(1).toLowerCase()
                const isValid = mentionUsers.some((u) => u.username.toLowerCase() === username)
                if (isValid) {
                    return <span key={idx} className="mention-pill">{part}</span>
                }
                return <span key={idx}>{part}</span>
            }
            return <span key={idx}>{part}</span>
        })
    }

    /** Parses "[Forwarded from @username]: body" into { forwardFrom, body } or null. */
    const parseForwardedContent = (content: string): { forwardFrom: string; body: string } | null => {
        const match = content.match(/^\[Forwarded from @([^\]]+)\]:\s*([\s\S]*)$/)
        if (!match) return null
        return { forwardFrom: match[1].trim(), body: match[2] }
    }

    /** Parses "> @username: quote\n\nreply" into { replyUsername, replyQuote, replyBody } or null. */
    const parseReplyContent = (content: string): { replyUsername: string; replyQuote: string; replyBody: string } | null => {
        if (!content.startsWith('> @')) return null
        const doubleNewline = content.indexOf('\n\n')
        if (doubleNewline < 0) return null
        const quotePart = content.slice(0, doubleNewline).trim()
        const replyBody = content.slice(doubleNewline + 2).trim()
        const match = quotePart.match(/^>\s*@([^:]+):\s*(.*)$/s)
        if (!match) return null
        return { replyUsername: match[1].trim(), replyQuote: match[2].trim(), replyBody }
    }

    const renderMessageContent = (content: string) => {
        const forwarded = parseForwardedContent(content)
        if (forwarded) {
            return (
                <div className="message-forwarded-block">
                    <div className="message-forwarded-quote">
                        <span className="message-forwarded-label">Forwarded from @{forwarded.forwardFrom}</span>
                        {forwarded.body ? <div className="message-forwarded-body">{renderMessageContent(forwarded.body)}</div> : null}
                    </div>
                </div>
            )
        }
        const parsed = parseReplyContent(content)
        if (parsed) {
            return (
                <div className="message-reply-block">
                    <div className="message-reply-quote">
                        <span className="message-reply-quote-label">Reply to @{parsed.replyUsername}</span>
                        <span className="message-reply-quote-text">{parsed.replyQuote}</span>
                    </div>
                    {parsed.replyBody ? <div className="message-reply-body">{renderMessageWithMentions(parsed.replyBody)}</div> : null}
                </div>
            )
        }
        return <div className="message-text">{renderMessageWithMentions(content)}</div>
    }

    if (!activeChannel) {
        return (
            <div className="chat-area">
                <div className="core-landing">
                    <h2>Welcome to Voxpery</h2>
                    <p>Simple communication focused on what matters most.</p>
                    <div className="core-pillars">
                        <div className="core-pillar">
                            <div className="core-pillar-title">Messaging</div>
                            <div className="core-pillar-desc">Fast channel chat and direct conversation flow.</div>
                        </div>
                        <div className="core-pillar">
                            <div className="core-pillar-title">Voice Chat</div>
                            <div className="core-pillar-desc">Low-latency voice with clean controls.</div>
                        </div>
                        <div className="core-pillar">
                            <div className="core-pillar-title">Screen Sharing</div>
                            <div className="core-pillar-desc">Share your screen in voice rooms when needed.</div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    if (activeChannel.channel_type === 'voice') {
        return (
            <div className="chat-area">
                <div className="chat-header">
                    <span className="channel-hash">
                        <Volume2 size={20} />
                    </span>
                    <span className="channel-title">{activeChannel.name}</span>
                </div>
                <div className="voice-focus-panel voice-focus-panel-stage" />
            </div>
        )
    }

    return (
        <div className="chat-area">
            <div className="chat-header">
                <span className="channel-hash">
                    <Hash size={20} />
                </span>
                <span className="channel-title">{activeChannel.name}</span>
            </div>

            <div
                className="chat-messages chat-messages-virtual"
                ref={setMessagesScrollRef}
                onScroll={() => {
                    const el = messagesScrollRef.current
                    if (!el) return
                    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
                    shouldAutoScrollRef.current = distanceToBottom < 120
                }}
            >
                {hasMoreOlder && messages.length > 0 && (
                    <div className="chat-load-older">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={loadingOlder}
                            onClick={() => onLoadOlder?.()}
                        >
                            {loadingOlder ? 'Loading…' : 'Load older messages'}
                        </button>
                    </div>
                )}
                {messages.length === 0 ? (
                    <div className="welcome-screen">
                        <div className="welcome-icon">
                            <Hash size={36} />
                        </div>
                        <h2>Welcome to #{activeChannel.name}!</h2>
                        <p>This is the beginning of the channel. Start the conversation!</p>
                    </div>
                ) : (
                    <div
                        className="virtual-list-spacer"
                        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                    >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const msg = messages[virtualRow.index]
                            return (
                                <div
                                    key={msg.id}
                                    data-index={virtualRow.index}
                                    ref={rowVirtualizer.measureElement}
                                    className="virtual-list-item"
                                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                                >
                                    <div className="message">
                                        <div className="message-avatar">
                                            {getAuthorAvatarUrl(msg.author || {}) ? (
                                                <img src={getAuthorAvatarUrl(msg.author || {})} alt="" />
                                            ) : (
                                                getInitial(msg.author?.username ?? '?')
                                            )}
                                        </div>
                                        <div className="message-content">
                                            <div className="message-header">
                                                <span className="message-author">{msg.author.username}</span>
                                                <span className="message-timestamp">{formatDate(msg.created_at)}</span>
                                                {msg.edited_at && <span className="message-edited" title="Edited">(edited)</span>}
                                                {(onReplyToMessage || onForwardMessage || onDeleteMessage || (msg.author?.user_id === currentUserId && onEditMessage)) && !msg.clientId && (
                                                    <div className="message-inline-actions">
                                                        {onReplyToMessage && (
                                                            <button type="button" className="message-inline-action-btn" title="Reply" aria-label="Reply" onClick={(e) => { e.stopPropagation(); onReplyToMessage(msg); setTimeout(() => textareaRef.current?.focus(), 0) }}>
                                                                <Reply size={14} />
                                                            </button>
                                                        )}
                                                        {onForwardMessage && (
                                                            <button type="button" className="message-inline-action-btn" title="Forward" aria-label="Forward" onClick={(e) => { e.stopPropagation(); setForwardPickerMessageId(forwardPickerMessageId === msg.id ? null : msg.id) }}>
                                                                <Share2 size={14} />
                                                            </button>
                                                        )}
                                                        {msg.author?.user_id === currentUserId && onEditMessage && onSaveEdit && onCancelEdit && (
                                                            <button
                                                                type="button"
                                                                className="message-inline-action-btn"
                                                                title="Edit"
                                                                aria-label="Edit"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    const parsed = parseReplyContent(msg.content)
                                                                    if (parsed) {
                                                                        const quotePart = msg.content.slice(0, msg.content.indexOf('\n\n'))
                                                                        onEditMessage({ id: msg.id, content: msg.content, contentToEdit: parsed.replyBody, replyQuotePart: quotePart })
                                                                    } else {
                                                                        onEditMessage({ id: msg.id, content: msg.content })
                                                                    }
                                                                }}
                                                            >
                                                                <Edit3 size={14} />
                                                            </button>
                                                        )}
                                                        {onDeleteMessage && (msg.author?.user_id === currentUserId || canModerate) && (
                                                            <button type="button" className="message-inline-action-btn danger" title="Delete" aria-label="Delete" onClick={(e) => { e.stopPropagation(); onDeleteMessage(msg.id) }}>
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                                {msg.clientStatus === 'sending' && (
                                                    <span className="message-send-state">Sending...</span>
                                                )}
                                                {msg.clientStatus === 'failed' && (
                                                    <span className="message-send-state is-failed">Failed</span>
                                                )}
                                            </div>
                                            {editingMessageId === msg.id ? (
                                                <div className="dm-edit-row">
                                                    <input
                                                        className="home-search"
                                                        value={editingContent}
                                                        onChange={(e) => onEditingContentChange?.(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault()
                                                                onSaveEdit?.()
                                                            }
                                                            if (e.key === 'Escape') {
                                                                e.preventDefault()
                                                                onCancelEdit?.()
                                                            }
                                                        }}
                                                    />
                                                    <button type="button" className="message-menu-btn dm-msg-btn" onClick={onSaveEdit} title="Save">
                                                        <Save size={12} />
                                                    </button>
                                                    <button type="button" className="message-menu-btn dm-msg-btn" onClick={onCancelEdit} title="Cancel">
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ) : (
                                                renderMessageContent(msg.content)
                                            )}
                                            {msg.clientStatus === 'failed' && msg.clientId && (
                                                <div className="message-retry-row">
                                                    <button
                                                        type="button"
                                                        className="message-retry-btn"
                                                        onClick={() => {
                                                            if (!msg.clientId) return
                                                            onRetryMessage(msg.clientId)
                                                        }}
                                                    >
                                                        Retry
                                                    </button>
                                                    {msg.clientError && (
                                                        <span className="message-retry-error">{msg.clientError}</span>
                                                    )}
                                                </div>
                                            )}
                                            {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                                                <div className="dm-attachments">
                                                    {msg.attachments.map((att: Attachment, i: number) => {
                                                        const isImage = typeof att?.type === 'string' && att.type.startsWith('image/')
                                                        if (isImage) {
                                                            return (
                                                                <a key={i} href={att.url} target="_blank" rel="noreferrer" className="chat-image-link">
                                                                    <img src={att.url} alt={att.name || `Attachment ${i + 1}`} className="chat-image-attachment" />
                                                                </a>
                                                            )
                                                        }
                                                        return (
                                                            <a key={i} href={att.url} target="_blank" rel="noreferrer" className="dm-attachment-link">
                                                                {att.name || `Attachment ${i + 1}`}
                                                            </a>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <div className="message-input-container">
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
                    <div className="mention-suggest-menu" role="listbox" aria-label="Mention suggestions">
                        {mentionSuggestions.map((member, index) => (
                            <button
                                key={`${member.user_id}-${member.username}`}
                                type="button"
                                className={`mention-suggest-item ${index === mentionActiveIndex ? 'active' : ''}`}
                                onMouseDown={(e) => {
                                    e.preventDefault()
                                    applyMention(member)
                                }}
                            >
                                <span className="mention-suggest-name">@{member.username}</span>
                                {member.user_id === '__all__' && (
                                    <span className="mention-suggest-hint">Notify everyone</span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
                <div className="message-input-wrapper">
                    <label className="dm-attach-btn" title="Attach files">
                        <Paperclip size={16} />
                        <input
                            type="file"
                            multiple
                            accept="*/*"
                            style={{ display: 'none' }}
                            onChange={(e) => onPickAttachments(e.target.files)}
                        />
                    </label>
                    <textarea
                        ref={textareaRef}
                        className="message-input"
                        value={messageInput}
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
                        placeholder={isDm ? `Message @${activeChannel.name}` : `Message #${activeChannel.name}`}
                        rows={1}
                    />
                    <Send
                        size={18}
                        style={{
                            color: (messageInput.trim() || draftAttachments.length > 0) ? 'var(--accent-primary)' : 'var(--text-muted)',
                            cursor: (messageInput.trim() || draftAttachments.length > 0) ? 'pointer' : 'default',
                            flexShrink: 0,
                        }}
                        onClick={() => onSendMessage()}
                    />
                </div>
                {draftAttachments.length > 0 && (
                    <div className="dm-draft-attachments">
                        {draftAttachments.map((att, i) => (
                            <div key={`${att.name}-${i}`} className="dm-draft-attachment">
                                <span>{att.name}</span>
                                <button
                                    type="button"
                                    className="dm-msg-btn"
                                    onClick={() => onRemoveAttachment(i)}
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {forwardPickerMessageId && onForwardMessage && (() => {
                const msg = messages.find((m) => m.id === forwardPickerMessageId)
                if (!msg) return null
                const hasOptions = textChannelsForForward.length > 0 || (friendsForForward && friendsForForward.length > 0)
                return createPortal(
                    <div className="modal-overlay" onClick={() => setForwardPickerMessageId(null)}>
                        <div className="modal forward-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="forward-modal-title">
                            <h2 id="forward-modal-title">Forward to?</h2>
                            {hasOptions ? (
                                <div className="forward-modal-list">
                                    {textChannelsForForward.length > 0 && (
                                        <div className="forward-modal-section">
                                            <div className="forward-modal-section-title">{isDm ? 'Direct Messages' : 'Channels'}</div>
                                            {textChannelsForForward.map((ch) => (
                                                <button key={ch.id} type="button" className="forward-modal-item" onClick={() => { onForwardMessage(msg, ch.id); setForwardPickerMessageId(null) }}>
                                                    # {ch.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {friendsForForward && friendsForForward.length > 0 && onForwardToFriend && (
                                        <div className="forward-modal-section">
                                            <div className="forward-modal-section-title">Friends</div>
                                            {friendsForForward.map((friend) => (
                                                <button key={friend.id} type="button" className="forward-modal-item" onClick={() => { onForwardToFriend(msg, friend.id); setForwardPickerMessageId(null) }}>
                                                    {friend.username}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="forward-modal-empty">No channel or friend to forward to.</p>
                            )}
                        </div>
                    </div>,
                    document.body
                )
            })()}

            {clickedLink && createPortal(
                <div className="modal-overlay" onClick={() => setClickedLink(null)}>
                    <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>External Link Warning</h2>
                        <p style={{ marginTop: '0.5rem', marginBottom: '1.5rem', wordBreak: 'break-all' }}>
                            You are about to leave Voxpery. Are you sure you want to visit:<br /><br />
                            <strong>{clickedLink}</strong>
                        </p>
                        <div className="modal-actions" style={{ marginTop: 'auto' }}>
                            <button type="button" className="btn btn-secondary" onClick={() => setClickedLink(null)}>Cancel</button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => {
                                    void openExternalUrl(clickedLink)
                                    setClickedLink(null)
                                }}
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
