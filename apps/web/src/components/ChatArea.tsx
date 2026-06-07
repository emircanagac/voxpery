import { useRef, useEffect, useMemo, useState, useCallback, useLayoutEffect, type FormEvent, type KeyboardEvent, type ReactNode, type TouchEvent, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { Hash, Volume2, Send, Paperclip, X, Save, Search, ChevronRight, Smile, Pin, PinOff, Users, ArrowDown, Sticker } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Attachment } from '../types'
import { resolveAttachmentUrl, resolveAvatarUrl, type MessageWithAuthor, type Channel } from '../api'
import type { DraftAttachmentItem } from '../draftAttachments'
import { openExternalUrl } from '../openExternalUrl'
import { cleanReplyQuotePreview } from '../replyPreview'
import EmojiPicker from './EmojiPicker'
import InlineMediaImage from './InlineMediaImage'
import MessageInlineActions from './MessageInlineActions'
import { useAuthStore } from '../stores/auth'

type UiMessage = MessageWithAuthor & {
    clientId?: string
    clientStatus?: 'sending' | 'failed'
    clientError?: string
}

type MentionUser = {
    user_id: string
    username: string
    avatar_url?: string | null
    status?: string | null
}

type MessagePickerMode = 'emoji' | 'gif' | 'sticker'

/** Synthetic entry for @all mention (server-wide). Shown at top when user types @. */
const MENTION_ALL: MentionUser = { user_id: '__all__', username: 'all' }
const TOP_AUTO_LOAD_THRESHOLD_PX = 96
const USER_SCROLL_INTENT_WINDOW_MS = 1200
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000
const ESTIMATED_GROUPED_MESSAGE_ROW_PX = 24
const ESTIMATED_MESSAGE_GROUP_ROW_PX = 52
const ESTIMATED_DAY_DIVIDER_PX = 36
const ESTIMATED_UNREAD_DIVIDER_PX = 30
const ESTIMATED_ATTACHMENT_ROW_PX = 36
const ESTIMATED_MEDIA_ROW_PX = 228
const ESTIMATED_STICKER_ROW_PX = 128
const ESTIMATED_TEXT_CHARS_PER_LINE = 92

function mentionPresenceRank(status?: string | null): number {
    const normalized = (status ?? 'offline').toLowerCase()
    if (normalized === 'online' || normalized === 'dnd') return 0
    if (normalized === 'invisible') return 2
    return 1
}

function mentionStatusTone(status?: string | null): 'online' | 'dnd' | 'offline' {
    const normalized = (status ?? 'offline').toLowerCase()
    if (normalized === 'online') return 'online'
    if (normalized === 'dnd') return 'dnd'
    return 'offline'
}

function extractEmbeddedMediaMarkdown(content: string): { text: string; gifUrls: string[]; stickerUrls: string[] } {
    const gifUrls: string[] = []
    const stickerUrls: string[] = []
    const text = content
        .replace(/!\[gif\]\((https?:\/\/[^\s)]+)\)/gi, (_match, url: string) => {
        gifUrls.push(url)
        return ''
    })
        .replace(/!\[sticker\]\((https?:\/\/[^\s)]+)\)/gi, (_match, url: string) => {
            stickerUrls.push(url)
            return ''
        })
        .trim()
    return { text, gifUrls, stickerUrls }
}

function AttachmentImagePreviewModal({
    src,
    title,
    onClose,
    onImageLoadError,
}: {
    src: string
    title: string
    onClose: () => void
    onImageLoadError: () => void
}) {
    useEffect(() => {
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose])

    if (typeof document === 'undefined') return null

    return createPortal(
        <div
            className="chat-image-preview-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose()
            }}
        >
            <div className="chat-image-preview-modal">
                <div className="chat-image-preview-toolbar">
                    <button
                        type="button"
                        className="chat-image-preview-close"
                        onClick={onClose}
                        aria-label="Close image preview"
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="chat-image-preview-stage">
                    <img
                        src={src}
                        alt={title}
                        className="chat-image-preview-image"
                        onError={onImageLoadError}
                    />
                </div>
            </div>
        </div>,
        document.body
    )
}

function isImageAttachment(attachment: Attachment): boolean {
    if (typeof attachment?.type === 'string' && attachment.type.startsWith('image/')) return true
    const name = attachment.name ?? ''
    const path = (() => {
        try {
            return new URL(attachment.url).pathname
        } catch {
            return attachment.url
        }
    })()
    return /\.(apng|avif|gif|jpe?g|png|webp)$/i.test(`${name} ${path}`)
}

function getMessageAuthorKey(msg: UiMessage | undefined) {
    if (!msg?.author) return ''
    return msg.author.user_id || msg.author.username || ''
}

function isNewMessageDayAt(messages: UiMessage[], index: number) {
    if (index <= 0) return true
    const current = messages[index]
    const previous = messages[index - 1]
    if (!current?.created_at || !previous?.created_at) return false
    return new Date(current.created_at).toDateString() !== new Date(previous.created_at).toDateString()
}

function isMessageGroupedAt(messages: UiMessage[], index: number, firstUnreadIndex: number) {
    if (index <= 0) return false
    if (isNewMessageDayAt(messages, index)) return false
    if (firstUnreadIndex >= 0 && index === firstUnreadIndex) return false

    const current = messages[index]
    const previous = messages[index - 1]
    if (!current || !previous) return false
    if (current.edited_at || current.clientStatus === 'failed') return false

    const currentAuthor = getMessageAuthorKey(current)
    if (!currentAuthor || currentAuthor !== getMessageAuthorKey(previous)) return false

    const currentTime = new Date(current.created_at).getTime()
    const previousTime = new Date(previous.created_at).getTime()
    const diff = currentTime - previousTime
    return Number.isFinite(diff) && diff >= 0 && diff <= MESSAGE_GROUP_WINDOW_MS
}

function estimateTextExtraHeight(content: string) {
    const parsed = parseReplyContent(content)
    const text = parsed ? parsed.replyBody : content
    const { text: visibleText } = extractEmbeddedMediaMarkdown(text)
    const normalized = visibleText.trim()
    if (!normalized) return 0
    const explicitLines = normalized.split('\n').length
    const wrappedLines = Math.ceil(normalized.length / ESTIMATED_TEXT_CHARS_PER_LINE)
    const estimatedLines = Math.max(explicitLines, wrappedLines, 1)
    return Math.max(0, estimatedLines - 1) * 20
}

function estimateEmbeddedMediaHeight(content: string) {
    const { gifUrls, stickerUrls } = extractEmbeddedMediaMarkdown(content)
    let extra = 0
    if (gifUrls.length > 0) extra += ESTIMATED_MEDIA_ROW_PX * Math.ceil(gifUrls.length / 2)
    if (stickerUrls.length > 0) extra += ESTIMATED_STICKER_ROW_PX * Math.ceil(stickerUrls.length / 2)
    return extra
}

function estimateAttachmentHeight(attachments?: Attachment[]) {
    if (!Array.isArray(attachments) || attachments.length === 0) return 0
    const hasImage = attachments.some(isImageAttachment)
    if (hasImage) return ESTIMATED_MEDIA_ROW_PX
    return ESTIMATED_ATTACHMENT_ROW_PX * Math.ceil(attachments.length / 2)
}

type AttachmentResolutionState = {
    sourceUrl: string
    resolvedUrl: string
    loadFailed: boolean
    triedDirectFallback: boolean
}

const MAX_ATTACHMENT_RESOLUTION_CACHE_ENTRIES = 160
const attachmentResolutionCache = new Map<string, AttachmentResolutionState>()
const decodedAttachmentImageCache = new Set<string>()

function defaultAttachmentResolution(sourceUrl: string): AttachmentResolutionState {
    return {
        sourceUrl,
        resolvedUrl: sourceUrl,
        loadFailed: false,
        triedDirectFallback: false,
    }
}

function getAttachmentResolutionCacheKey(attachment: Attachment, token: string | null) {
    return [attachment.url, attachment.type ?? '', token ?? 'cookie-auth'].join('\n')
}

function rememberAttachmentResolution(cacheKey: string, resolution: AttachmentResolutionState) {
    const previous = attachmentResolutionCache.get(cacheKey)
    if (previous?.resolvedUrl.startsWith('blob:') && previous.resolvedUrl !== resolution.resolvedUrl) {
        URL.revokeObjectURL(previous.resolvedUrl)
    }
    attachmentResolutionCache.delete(cacheKey)
    attachmentResolutionCache.set(cacheKey, resolution)
    while (attachmentResolutionCache.size > MAX_ATTACHMENT_RESOLUTION_CACHE_ENTRIES) {
        const oldestKey = attachmentResolutionCache.keys().next().value
        if (!oldestKey) break
        const oldest = attachmentResolutionCache.get(oldestKey)
        if (oldest?.resolvedUrl.startsWith('blob:')) URL.revokeObjectURL(oldest.resolvedUrl)
        attachmentResolutionCache.delete(oldestKey)
    }
}

function decodeAttachmentImage(url: string): Promise<void> {
    if (decodedAttachmentImageCache.has(url)) return Promise.resolve()
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
        decodedAttachmentImageCache.add(url)
        return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.decoding = 'async'
        image.onload = () => {
            decodedAttachmentImageCache.add(url)
            resolve()
        }
        image.onerror = () => reject(new Error('Image decode failed'))
        image.src = url
        const decode = image.decode?.()
        if (decode) {
            decode
                .then(() => {
                    decodedAttachmentImageCache.add(url)
                    resolve()
                })
                .catch(() => {
                    if (image.complete && image.naturalWidth > 0) {
                        decodedAttachmentImageCache.add(url)
                        resolve()
                        return
                    }
                    reject(new Error('Image decode failed'))
                })
        }
    })
}

/** Parses "> @username: quote\n\nreply" into { replyUsername, replyQuote, replyBody } or null. */
function parseReplyContent(content: string): { replyUsername: string; replyQuote: string; replyBody: string } | null {
    if (!content.startsWith('> @')) return null
    const doubleNewline = content.indexOf('\n\n')
    if (doubleNewline < 0) return null
    const quotePart = content.slice(0, doubleNewline).trim()
    const replyBody = content.slice(doubleNewline + 2).trim()
    const match = quotePart.match(/^>\s*@([^:]+):\s*(.*)$/s)
    if (!match) return null
    return { replyUsername: match[1].trim(), replyQuote: cleanReplyQuotePreview(match[2]), replyBody }
}

function estimateMessageRowHeight(messages: UiMessage[], index: number, firstUnreadIndex: number, hasTypingRow: boolean) {
    if (hasTypingRow && index === messages.length) return 34
    const message = messages[index]
    if (!message) return ESTIMATED_MESSAGE_GROUP_ROW_PX

    const isGrouped = isMessageGroupedAt(messages, index, firstUnreadIndex)
    let estimate = isGrouped ? ESTIMATED_GROUPED_MESSAGE_ROW_PX : ESTIMATED_MESSAGE_GROUP_ROW_PX
    if (isNewMessageDayAt(messages, index)) estimate += ESTIMATED_DAY_DIVIDER_PX
    if (firstUnreadIndex >= 0 && index === firstUnreadIndex) estimate += ESTIMATED_UNREAD_DIVIDER_PX
    if (message.edited_at || message.clientStatus === 'failed') estimate += 8
    estimate += estimateTextExtraHeight(message.content ?? '')
    estimate += estimateEmbeddedMediaHeight(message.content ?? '')
    estimate += estimateAttachmentHeight(message.attachments)
    return Math.max(ESTIMATED_GROUPED_MESSAGE_ROW_PX, estimate)
}

function AttachmentLink({ attachment, index }: { attachment: Attachment; index: number }) {
    const token = useAuthStore((s) => s.token)
    const [previewOpen, setPreviewOpen] = useState(false)
    const fallbackInFlightRef = useRef(false)
    const isImage = isImageAttachment(attachment)
    const cacheKey = getAttachmentResolutionCacheKey(attachment, token ?? null)
    const [resolution, setResolution] = useState<AttachmentResolutionState>(() => (
        attachmentResolutionCache.get(cacheKey) ?? defaultAttachmentResolution(attachment.url)
    ))
    const currentResolution = resolution.sourceUrl === attachment.url
        ? resolution
        : attachmentResolutionCache.get(cacheKey) ?? defaultAttachmentResolution(attachment.url)
    const [imageDecoded, setImageDecoded] = useState(() => (
        !isImage || decodedAttachmentImageCache.has(currentResolution.resolvedUrl)
    ))

    useEffect(() => {
        let cancelled = false
        const cached = attachmentResolutionCache.get(cacheKey)
        if (cached) {
            setResolution(cached)
            return () => {
                cancelled = true
            }
        }

        resolveAttachmentUrl(attachment.url, token ?? null, {
            fallbackMimeType: attachment.type,
        })
            .then((nextUrl) => {
                if (cancelled) {
                    if (nextUrl.startsWith('blob:')) URL.revokeObjectURL(nextUrl)
                    return
                }
                const nextResolution = {
                    sourceUrl: attachment.url,
                    resolvedUrl: nextUrl,
                    loadFailed: false,
                    triedDirectFallback: false,
                }
                rememberAttachmentResolution(cacheKey, nextResolution)
                setResolution(nextResolution)
            })
            .catch(() => {
                if (!cancelled) {
                    const nextResolution = {
                        sourceUrl: attachment.url,
                        resolvedUrl: attachment.url,
                        loadFailed: isImage,
                        triedDirectFallback: true,
                    }
                    rememberAttachmentResolution(cacheKey, nextResolution)
                    setResolution(nextResolution)
                }
            })

        return () => {
            cancelled = true
        }
    }, [attachment.type, attachment.url, cacheKey, isImage, token])

    useEffect(() => {
        fallbackInFlightRef.current = false
    }, [attachment.url])

    useEffect(() => {
        if (!isImage || currentResolution.loadFailed) {
            setImageDecoded(false)
            return
        }
        const imageUrl = currentResolution.resolvedUrl
        if (decodedAttachmentImageCache.has(imageUrl)) {
            setImageDecoded(true)
            return
        }
        let cancelled = false
        setImageDecoded(false)
        decodeAttachmentImage(imageUrl)
            .then(() => {
                if (!cancelled) setImageDecoded(true)
            })
            .catch(() => {
                if (!cancelled) setImageDecoded(true)
            })
        return () => {
            cancelled = true
        }
    }, [currentResolution.loadFailed, currentResolution.resolvedUrl, isImage])

    if (isImage) {
        const alt = attachment.name || `Attachment ${index + 1}`
        const handleImageLoadError = () => {
            const shouldTryAuthenticatedFallback =
                !currentResolution.triedDirectFallback &&
                !currentResolution.resolvedUrl.startsWith('blob:') &&
                !fallbackInFlightRef.current

            if (shouldTryAuthenticatedFallback) {
                fallbackInFlightRef.current = true
                setResolution((current) => {
                    if (current.sourceUrl !== attachment.url) return current
                    return {
                        ...current,
                        triedDirectFallback: true,
                    }
                })
                void resolveAttachmentUrl(attachment.url, token ?? null, {
                    forceAuthenticatedFetch: true,
                    fallbackMimeType: attachment.type,
                })
                    .then((nextUrl) => {
                        setResolution((current) => {
                            if (current.sourceUrl !== attachment.url) {
                                if (nextUrl.startsWith('blob:')) URL.revokeObjectURL(nextUrl)
                                return current
                            }
                            const nextResolution = {
                                sourceUrl: attachment.url,
                                resolvedUrl: nextUrl,
                                loadFailed: false,
                                triedDirectFallback: true,
                            }
                            rememberAttachmentResolution(cacheKey, nextResolution)
                            return nextResolution
                        })
                    })
                    .catch(() => {
                        setResolution((current) => {
                            if (current.sourceUrl !== attachment.url) return current
                            const nextResolution = {
                                ...current,
                                loadFailed: true,
                                triedDirectFallback: true,
                            }
                            rememberAttachmentResolution(cacheKey, nextResolution)
                            return nextResolution
                        })
                    })
                    .finally(() => {
                        fallbackInFlightRef.current = false
                    })
                return
            }

            setResolution((current) => {
                if (current.sourceUrl !== attachment.url) return current
                const nextResolution = {
                    ...current,
                    loadFailed: true,
                    triedDirectFallback: true,
                }
                rememberAttachmentResolution(cacheKey, nextResolution)
                return nextResolution
            })
        }
        if (currentResolution.loadFailed) {
            return (
                <span className="dm-attachment-link chat-image-unavailable" title="Image preview could not be loaded">
                    {attachment.name || `Image attachment ${index + 1}`}
                </span>
            )
        }
        return (
            <>
                {imageDecoded ? (
                    <button
                        type="button"
                        className="chat-image-link chat-image-preview-trigger"
                        onClick={() => setPreviewOpen(true)}
                        aria-label={`Preview ${alt}`}
                    >
                        <img
                            src={currentResolution.resolvedUrl}
                            alt=""
                            className="chat-image-attachment"
                            loading="eager"
                            decoding="async"
                            width={320}
                            height={180}
                            onLoad={() => {
                                decodedAttachmentImageCache.add(currentResolution.resolvedUrl)
                            }}
                            onError={handleImageLoadError}
                        />
                    </button>
                ) : (
                    <span
                        className="chat-image-link chat-image-preview-trigger chat-image-preview-trigger--pending"
                        aria-hidden="true"
                    />
                )}
                {previewOpen && (
                    <AttachmentImagePreviewModal
                        src={currentResolution.resolvedUrl}
                        title={alt}
                        onClose={() => setPreviewOpen(false)}
                        onImageLoadError={handleImageLoadError}
                    />
                )}
            </>
        )
    }

    return (
        <a href={currentResolution.resolvedUrl} target="_blank" rel="noreferrer" className="dm-attachment-link">
            {attachment.name || `Attachment ${index + 1}`}
        </a>
    )
}
interface ChatAreaProps {
    activeChannel: Channel | undefined
    messages: UiMessage[]
    draftAttachments: DraftAttachmentItem[]
    messageInput: string
    onPickAttachments: (files: FileList | null) => void
    onRemoveAttachment: (index: number) => void
    onRetryAttachment?: (localId: string) => void
    onMessageInputChange: (value: string) => void
    onSendMessage: (e?: FormEvent, forceContent?: string) => void
    onRetryMessage: (clientId: string) => void
    onDeleteMessage?: (messageId: string) => void
    onReportMessage?: (msg: { id: string; author?: { user_id?: string; username?: string }; content: string }) => void
    onReplyToMessage?: (msg: { id: string; author?: { username?: string }; content: string }) => void
    replyingTo?: { id: string; username: string; contentSnippet: string } | null
    onCancelReply?: () => void
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
    /** When set, show search in header and filter/search is handled by parent (e.g. displayedMessages) */
    searchQuery?: string
    onSearchChange?: (value: string) => void
    /** Pinned messages for this channel; shown in header dropdown */
    pinnedMessages?: MessageWithAuthor[]
    onPinMessage?: (messageId: string) => void
    onUnpinMessage?: (messageId: string) => void
    onToggleReaction?: (messageId: string, emoji: string, reacted: boolean) => void
    canSendMessages?: boolean
    typingIndicatorLabel?: string | null
    seenMessageId?: string | null
    showMemberSheetButton?: boolean
    onOpenMemberSheet?: () => void
    unreadDividerCount?: number
    loading?: boolean
    topContent?: ReactNode
    emptyStateTitle?: string
    emptyStateDescription?: string
    emptyStateActions?: Array<{ label: string; onClick: () => void; variant?: 'primary' | 'secondary' }>
    jumpToMessageId?: string | null
    onJumpToMessageHandled?: () => void
}

export default function ChatArea({
    activeChannel,
    messages,
    draftAttachments,
    messageInput,
    onPickAttachments,
    onRemoveAttachment,
    onRetryAttachment,
    onMessageInputChange,
    onSendMessage,
    onRetryMessage,
    onDeleteMessage,
    onReportMessage,
    onReplyToMessage,
    replyingTo,
    onCancelReply,
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
    searchQuery = '',
    onSearchChange,
    pinnedMessages = [],
    onPinMessage,
    onUnpinMessage,
    onToggleReaction,
    canSendMessages = true,
    typingIndicatorLabel = null,
    seenMessageId = null,
    showMemberSheetButton = false,
    onOpenMemberSheet,
    unreadDividerCount = 0,
    loading = false,
    topContent,
    emptyStateTitle,
    emptyStateDescription,
    emptyStateActions,
    jumpToMessageId = null,
    onJumpToMessageHandled,
}: ChatAreaProps) {
    const [useCompactMobileTimestamp, setUseCompactMobileTimestamp] = useState(
        () => typeof window !== 'undefined' ? window.innerWidth <= 520 : false
    )
    const chatAreaRef = useRef<HTMLDivElement | null>(null)
    const messagesScrollRef = useRef<HTMLDivElement>(null)
    const virtualListSpacerRef = useRef<HTMLDivElement | null>(null)
    const currentChatChannelId = activeChannel?.id ?? null
    const currentChatChannelIdRef = useRef<string | null>(currentChatChannelId)
    const setMessagesScrollRef = useCallback(
        (el: HTMLDivElement | null) => {
            (messagesScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el
            onScrollRefReady?.(el)
        },
        [onScrollRefReady]
    )
    const shouldAutoScrollRef = useRef(true)
    const pendingSubmitAutoScrollRef = useRef(false)
    const lastBottomAnchoredChannelIdRef = useRef<string | null>(null)
    const pendingLatestAnchorChannelIdRef = useRef<string | null>(null)
    const latestAnchorCleanupRef = useRef<(() => void) | null>(null)
    const programmaticScrollRef = useRef(0)
    const resizeAutoScrollRafRef = useRef<number | null>(null)
    const userReadingHistoryRef = useRef(false)
    const userScrollIntentUntilRef = useRef(0)
    const lastKnownScrollTopRef = useRef(0)
    const touchStartYRef = useRef<number | null>(null)
    const preservingOlderMessagesRef = useRef(false)
    const olderLoadRequestedRef = useRef(false)
    const olderMessagesAnchorRef = useRef<{
        scrollTop: number
        scrollHeight: number
        messageId?: string
        messageIndex?: number
        offsetTop?: number
    } | null>(null)
    const prevViewActiveRef = useRef(isViewActive)
    const [showJumpToLatest, setShowJumpToLatest] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const [pinnedOpen, setPinnedOpen] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
    const pinnedDropdownRef = useRef<HTMLDivElement | null>(null)
    const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const searchInputRef = useRef<HTMLInputElement | null>(null)
    const searchDropdownRef = useRef<HTMLDivElement | null>(null)
    const searchHelpRef = useRef<HTMLDetailsElement | null>(null)
    const applySearchFilter = useCallback((token: 'from:' | 'has:attachment') => {
        const parts = searchQuery.trim().split(/\s+/).filter(Boolean)
        const nextParts = parts.filter((part) => {
            const normalized = part.toLowerCase()
            if (token === 'from:') return !normalized.startsWith('from:')
            return normalized !== 'has:attachment' && normalized !== 'has:attachments'
        })
        nextParts.push(token)
        const nextQuery = nextParts.join(' ')
        onSearchChange?.(nextQuery)
        if (searchHelpRef.current) searchHelpRef.current.open = false
        requestAnimationFrame(() => {
            searchInputRef.current?.focus()
            searchInputRef.current?.setSelectionRange(nextQuery.length, nextQuery.length)
        })
    }, [onSearchChange, searchQuery])
    const [mentionOpen, setMentionOpen] = useState(false)
    const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null)
    const [mentionQuery, setMentionQuery] = useState('')
    const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
    const [clickedLink, setClickedLink] = useState<string | null>(null)
    const [emojiOpen, setEmojiOpen] = useState(false)
    const [messagePickerMode, setMessagePickerMode] = useState<MessagePickerMode>('emoji')
    const emojiPickerRef = useRef<HTMLDivElement | null>(null)
    const emojiPickerAnchorRef = useRef<HTMLButtonElement | null>(null)
    const messageInputWrapperRef = useRef<HTMLDivElement | null>(null)
    const [emojiPickerPosition, setEmojiPickerPosition] = useState<{ top: number; left: number } | null>(null)
    const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null)
    const reactionPickerRef = useRef<HTMLDivElement | null>(null)
    const reactionPickerAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [reactionPickerPosition, setReactionPickerPosition] = useState<{ top: number; left: number } | null>(null)

    const pinnedMessageIds = useMemo(() => new Set(pinnedMessages.map((m) => m.id)), [pinnedMessages])
    const mentionCandidates = useMemo(() => {
        const seen = new Set<string>()
        return mentionUsers
            .filter((member) => {
                const key = member.username.trim().toLowerCase()
                if (!key || seen.has(key)) return false
                if (key === 'all') return false
                seen.add(key)
                return true
            })
            .sort((a, b) => {
                const rankDiff = mentionPresenceRank(a.status) - mentionPresenceRank(b.status)
                if (rankDiff !== 0) return rankDiff
                return a.username.localeCompare(b.username)
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

    const firstUnreadIndex = useMemo(() => {
        if (!Number.isFinite(unreadDividerCount) || unreadDividerCount <= 0) return -1
        if (messages.length === 0) return -1
        return Math.max(0, messages.length - unreadDividerCount)
    }, [messages.length, unreadDividerCount])

    const virtualCount = messages.length + (typingIndicatorLabel ? 1 : 0)

    const isAtBottom = useCallback((el: HTMLDivElement) => {
        const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        return distanceToBottom <= 4
    }, [])

    const runProgrammaticScroll = useCallback((fn: () => void) => {
        programmaticScrollRef.current += 1
        try {
            fn()
        } finally {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    programmaticScrollRef.current = Math.max(0, programmaticScrollRef.current - 1)
                })
            })
        }
    }, [])

    const cancelLatestAnchor = useCallback(() => {
        latestAnchorCleanupRef.current?.()
        latestAnchorCleanupRef.current = null
        pendingLatestAnchorChannelIdRef.current = null
    }, [])

    const completeLatestAnchor = useCallback((channelId?: string | null) => {
        if (channelId && pendingLatestAnchorChannelIdRef.current !== channelId) return
        latestAnchorCleanupRef.current?.()
        latestAnchorCleanupRef.current = null
        pendingLatestAnchorChannelIdRef.current = null
    }, [])

    const noteUserScrollIntent = useCallback(() => {
        userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_WINDOW_MS
    }, [])

    const markUserReadingHistory = useCallback(() => {
        noteUserScrollIntent()
        cancelLatestAnchor()
        userReadingHistoryRef.current = true
        shouldAutoScrollRef.current = false
        setShowJumpToLatest((prev) => (messages.length > 0 ? true : prev))
    }, [cancelLatestAnchor, messages.length, noteUserScrollIntent])

    const rowVirtualizer = useVirtualizer({
        count: virtualCount,
        getScrollElement: () => messagesScrollRef.current,
        getItemKey: (index) => messages[index]?.id ?? (index === messages.length ? 'typing-indicator' : index),
        // Keep newly-added rows close to their final measured height so bottom-locked
        // chats do not visibly settle after the virtualizer's first measurement.
        estimateSize: (index) => estimateMessageRowHeight(messages, index, firstUnreadIndex, !!typingIndicatorLabel),
        measureElement: (el) => el?.getBoundingClientRect().height ?? 64,
        overscan: 8,
    })

    useLayoutEffect(() => {
        currentChatChannelIdRef.current = currentChatChannelId
    }, [currentChatChannelId])

    const restoreOlderMessagesAnchor = useCallback(() => {
        const el = messagesScrollRef.current
        const anchor = olderMessagesAnchorRef.current
        if (!el || !anchor) return
        if (anchor.messageId && typeof anchor.offsetTop === 'number') {
            const anchorIndex = messages.findIndex((message) => message.id === anchor.messageId)
            const anchoredMessage = Array
                .from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
                .find((item) => item.dataset.messageId === anchor.messageId)
            if (!anchoredMessage && anchorIndex >= 0) {
                runProgrammaticScroll(() => {
                    rowVirtualizer.scrollToIndex(anchorIndex, { align: 'start' })
                    el.scrollTop = Math.max(0, el.scrollTop - Math.max(0, anchor.offsetTop ?? 0))
                    lastKnownScrollTopRef.current = el.scrollTop
                })
                shouldAutoScrollRef.current = false
                setShowJumpToLatest(true)
                return
            }
            if (anchoredMessage) {
                const currentOffsetTop = anchoredMessage.getBoundingClientRect().top - el.getBoundingClientRect().top
                const delta = currentOffsetTop - anchor.offsetTop
                if (Math.abs(delta) > 1) {
                    runProgrammaticScroll(() => {
                        el.scrollTop += delta
                        lastKnownScrollTopRef.current = el.scrollTop
                    })
                }
                shouldAutoScrollRef.current = false
                setShowJumpToLatest(true)
                return
            }
        }
        runProgrammaticScroll(() => {
            el.scrollTop = anchor.scrollTop + Math.max(0, el.scrollHeight - anchor.scrollHeight)
            lastKnownScrollTopRef.current = el.scrollTop
        })
        shouldAutoScrollRef.current = false
        setShowJumpToLatest(true)
    }, [messages, rowVirtualizer, runProgrammaticScroll])

    const captureOlderMessagesAnchor = useCallback(() => {
        const el = messagesScrollRef.current
        if (!el) return null
        const scrollerRect = el.getBoundingClientRect()
        const messageItems = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
        const firstVisibleItem = messageItems
            .map((item) => ({ item, rect: item.getBoundingClientRect() }))
            .filter(({ rect }) => rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom)
            .sort((a, b) => Math.abs(a.rect.top - scrollerRect.top) - Math.abs(b.rect.top - scrollerRect.top))[0]?.item
        const messageId = firstVisibleItem?.dataset.messageId
        const messageIndex = Number(firstVisibleItem?.dataset.index)
        return {
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            messageId,
            messageIndex: Number.isFinite(messageIndex) ? messageIndex : undefined,
            offsetTop: firstVisibleItem ? firstVisibleItem.getBoundingClientRect().top - scrollerRect.top : undefined,
        }
    }, [])

    const startOlderMessagesLoad = useCallback(() => {
        if (!hasMoreOlder || loadingOlder || olderLoadRequestedRef.current) return
        if (!onLoadOlder || messages.length === 0) return
        olderLoadRequestedRef.current = true
        olderMessagesAnchorRef.current = captureOlderMessagesAnchor()
        cancelLatestAnchor()
        userReadingHistoryRef.current = true
        preservingOlderMessagesRef.current = true
        shouldAutoScrollRef.current = false
        setShowJumpToLatest(true)
        onLoadOlder()
    }, [cancelLatestAnchor, captureOlderMessagesAnchor, hasMoreOlder, loadingOlder, messages.length, onLoadOlder])

    /* Jump to bottom before paint when opening/switching chats so the user does
       not see a visible "top -> bottom" scroll animation on first render. */
    const snapToBottom = useCallback((expectedChannelId?: string | null) => {
        if (expectedChannelId && currentChatChannelIdRef.current !== expectedChannelId) return false
        if (preservingOlderMessagesRef.current) return false
        const el = messagesScrollRef.current
        if (!el || el.clientHeight <= 0) return false
        let snapped = false
        runProgrammaticScroll(() => {
            userReadingHistoryRef.current = false
            shouldAutoScrollRef.current = true
            setShowJumpToLatest(false)
            const lastIndex = virtualCount - 1
            el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
            lastKnownScrollTopRef.current = el.scrollTop
            if (lastIndex >= 0) {
                rowVirtualizer.scrollToIndex(lastIndex, { align: 'end' })
            }
            snapped = true
        })
        requestAnimationFrame(() => {
            if (expectedChannelId && currentChatChannelIdRef.current !== expectedChannelId) return
            if (expectedChannelId && pendingLatestAnchorChannelIdRef.current !== expectedChannelId) return
            const latest = messagesScrollRef.current
            if (!latest || latest.clientHeight <= 0) return
            runProgrammaticScroll(() => {
                userReadingHistoryRef.current = false
                shouldAutoScrollRef.current = true
                setShowJumpToLatest(false)
                latest.scrollTop = Math.max(0, latest.scrollHeight - latest.clientHeight)
                lastKnownScrollTopRef.current = latest.scrollTop
                const lastIndex = virtualCount - 1
                if (lastIndex >= 0) {
                    rowVirtualizer.scrollToIndex(lastIndex, { align: 'end' })
                }
            })
        })
        return snapped
    }, [rowVirtualizer, runProgrammaticScroll, virtualCount])
    const snapToBottomRef = useRef(snapToBottom)
    snapToBottomRef.current = snapToBottom

    const scheduleLatestAnchor = useCallback((channelId: string) => {
        cancelLatestAnchor()
        pendingLatestAnchorChannelIdRef.current = channelId
        let cancelled = false
        const rafIds: number[] = []
        const timeoutIds: number[] = []
        const snapIfCurrent = () => {
            if (cancelled) return
            if (currentChatChannelIdRef.current !== channelId) return
            if (pendingLatestAnchorChannelIdRef.current !== channelId) return
            shouldAutoScrollRef.current = true
            setShowJumpToLatest(false)
            snapToBottomRef.current(channelId)
        }
        const queueRaf = (remaining: number) => {
            const id = window.requestAnimationFrame(() => {
                snapIfCurrent()
                if (remaining > 0) queueRaf(remaining - 1)
            })
            rafIds.push(id)
        }
        snapIfCurrent()
        queueRaf(2)
        for (const delay of [96]) {
            timeoutIds.push(window.setTimeout(snapIfCurrent, delay))
        }
        latestAnchorCleanupRef.current = () => {
            cancelled = true
            for (const id of rafIds) window.cancelAnimationFrame(id)
            for (const id of timeoutIds) window.clearTimeout(id)
        }
    }, [cancelLatestAnchor])

    const syncAutoScrollState = useCallback(() => {
        if (activeChannel?.id && pendingLatestAnchorChannelIdRef.current === activeChannel.id) {
            shouldAutoScrollRef.current = true
            setShowJumpToLatest(false)
            return
        }
        if (preservingOlderMessagesRef.current) {
            shouldAutoScrollRef.current = false
            setShowJumpToLatest((prev) => (messages.length > 0 ? true : prev))
            return
        }
        const el = messagesScrollRef.current
        if (!el) return
        if (userReadingHistoryRef.current) {
            if (isAtBottom(el)) {
                userReadingHistoryRef.current = false
                shouldAutoScrollRef.current = true
                setShowJumpToLatest(false)
                return
            }
            shouldAutoScrollRef.current = false
            setShowJumpToLatest((prev) => (messages.length > 0 ? true : prev))
            return
        }
        const atBottom = isAtBottom(el)
        shouldAutoScrollRef.current = atBottom
        const nextShowJump = !atBottom && messages.length > 0
        setShowJumpToLatest((prev) => (prev === nextShowJump ? prev : nextShowJump))
    }, [activeChannel?.id, isAtBottom, messages.length])

    const handleMessagesScroll = useCallback(() => {
        const el = messagesScrollRef.current
        if (el) {
            const previousScrollTop = lastKnownScrollTopRef.current
            const currentScrollTop = el.scrollTop
            const hasRecentUserScrollIntent = Date.now() <= userScrollIntentUntilRef.current
            const movedUp = currentScrollTop < previousScrollTop - 1
            const pendingLatestForActiveChannel =
                !!activeChannel?.id && pendingLatestAnchorChannelIdRef.current === activeChannel.id
            const likelyScrollbarDragUp =
                movedUp &&
                messages.length > 0 &&
                !preservingOlderMessagesRef.current &&
                currentScrollTop < Math.max(0, el.scrollHeight - el.clientHeight - 4)
            const isUserInitiatedScroll =
                programmaticScrollRef.current === 0 ||
                hasRecentUserScrollIntent ||
                (likelyScrollbarDragUp && (!pendingLatestForActiveChannel || currentScrollTop < previousScrollTop - 4))
            if (currentScrollTop <= TOP_AUTO_LOAD_THRESHOLD_PX) {
                startOlderMessagesLoad()
            }
            if (pendingLatestForActiveChannel && !isUserInitiatedScroll) {
                lastKnownScrollTopRef.current = currentScrollTop
                syncAutoScrollState()
                return
            }
            if (movedUp && isUserInitiatedScroll) {
                markUserReadingHistory()
            }
            lastKnownScrollTopRef.current = currentScrollTop
        }
        syncAutoScrollState()
    }, [activeChannel?.id, markUserReadingHistory, messages.length, startOlderMessagesLoad, syncAutoScrollState])

    const handleWheelScrollIntent = useCallback((event: WheelEvent<HTMLDivElement>) => {
        noteUserScrollIntent()
        if (event.deltaY < 0) {
            markUserReadingHistory()
        }
    }, [markUserReadingHistory, noteUserScrollIntent])

    const handlePointerDownScrollIntent = useCallback(() => {
        noteUserScrollIntent()
    }, [noteUserScrollIntent])

    const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
        noteUserScrollIntent()
        touchStartYRef.current = event.touches[0]?.clientY ?? null
    }, [noteUserScrollIntent])

    const handleTouchMoveScrollIntent = useCallback((event: TouchEvent<HTMLDivElement>) => {
        noteUserScrollIntent()
        const startY = touchStartYRef.current
        const nextY = event.touches[0]?.clientY ?? null
        if (startY != null && nextY != null && nextY > startY + 2) {
            markUserReadingHistory()
        }
        touchStartYRef.current = nextY
    }, [markUserReadingHistory, noteUserScrollIntent])

    /* When switching channel/DM, anchor to the latest visible content so
       returning to a previously read chat does not keep an older
       scroll position. Do not run this for pagination prepends; loading older
       messages must preserve the user's scroll anchor. */
    useLayoutEffect(() => {
        const channelId = activeChannel?.id ?? null
        if (lastBottomAnchoredChannelIdRef.current === channelId) return
        lastBottomAnchoredChannelIdRef.current = channelId
        if (!channelId) return
        userReadingHistoryRef.current = false
        userScrollIntentUntilRef.current = 0
        lastKnownScrollTopRef.current = messagesScrollRef.current?.scrollTop ?? 0
        preservingOlderMessagesRef.current = false
        olderMessagesAnchorRef.current = null
        shouldAutoScrollRef.current = true
        scheduleLatestAnchor(channelId)
        return () => {
            cancelLatestAnchor()
        }
    }, [activeChannel?.id, cancelLatestAnchor, scheduleLatestAnchor])

    /* Scroll to bottom when opening a chat or when messages load (e.g. DM opened
       from Messages view). useLayoutEffect keeps the first painted frame already
       anchored to the latest message. */
    useLayoutEffect(() => {
        if (messages.length === 0) return
        const pendingLatest = !!activeChannel?.id && pendingLatestAnchorChannelIdRef.current === activeChannel.id
        if (!pendingLatest && !shouldAutoScrollRef.current) return
        shouldAutoScrollRef.current = true
        const snapped = snapToBottom(pendingLatest ? activeChannel.id : undefined)
        if (pendingLatest && snapped && activeChannel?.id) {
            const channelId = activeChannel.id
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    completeLatestAnchor(channelId)
                })
            })
        }
    }, [activeChannel?.id, completeLatestAnchor, messages.length, unreadDividerCount, snapToBottom])

    /* If user sends while reading older messages, force snap to newest after the new row mounts. */
    useLayoutEffect(() => {
        if (!pendingSubmitAutoScrollRef.current) return
        if (messages.length === 0) return
        shouldAutoScrollRef.current = true
        snapToBottom()
        requestAnimationFrame(() => {
            snapToBottom()
            pendingSubmitAutoScrollRef.current = false
        })
    }, [messages.length, snapToBottom])

    useLayoutEffect(() => {
        if (draftAttachments.length === 0) return
        if (!shouldAutoScrollRef.current) return
        snapToBottom()
    }, [draftAttachments.length, snapToBottom])

    useLayoutEffect(() => {
        if (!preservingOlderMessagesRef.current) return
        restoreOlderMessagesAnchor()
        requestAnimationFrame(() => {
            restoreOlderMessagesAnchor()
            requestAnimationFrame(() => {
                restoreOlderMessagesAnchor()
                if (!loadingOlder) {
                    preservingOlderMessagesRef.current = false
                    olderMessagesAnchorRef.current = null
                }
            })
        })
    }, [loadingOlder, messages.length, restoreOlderMessagesAnchor])

    useEffect(() => {
        if (loadingOlder) return
        olderLoadRequestedRef.current = false
    }, [activeChannel?.id, loadingOlder, messages.length])

    useEffect(() => {
        const spacer = virtualListSpacerRef.current
        if (!spacer || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => {
            if (!shouldAutoScrollRef.current) return
            if (userReadingHistoryRef.current) return
            if (preservingOlderMessagesRef.current) return
            const el = messagesScrollRef.current
            if (el && Date.now() <= userScrollIntentUntilRef.current && !isAtBottom(el)) return
            if (resizeAutoScrollRafRef.current != null) return
            resizeAutoScrollRafRef.current = window.requestAnimationFrame(() => {
                resizeAutoScrollRafRef.current = null
                if (!shouldAutoScrollRef.current || userReadingHistoryRef.current || preservingOlderMessagesRef.current) return
                snapToBottom()
            })
        })
        observer.observe(spacer)
        return () => {
            observer.disconnect()
            if (resizeAutoScrollRafRef.current != null) {
                window.cancelAnimationFrame(resizeAutoScrollRafRef.current)
                resizeAutoScrollRafRef.current = null
            }
        }
    }, [activeChannel?.id, isAtBottom, messages.length, snapToBottom])

    /* When user switches back from Servers to Messages/DM, scroll to bottom so latest messages are visible */
    useLayoutEffect(() => {
        const becameVisible = isViewActive === true && prevViewActiveRef.current === false
        prevViewActiveRef.current = isViewActive ?? true
        if (!becameVisible || messages.length === 0) return
        shouldAutoScrollRef.current = true
        snapToBottom()
        requestAnimationFrame(() => {
            snapToBottom()
            requestAnimationFrame(() => {
                snapToBottom()
            })
        })
        const timeoutId = window.setTimeout(() => {
            snapToBottom()
        }, 48)
        return () => {
            window.clearTimeout(timeoutId)
        }
    }, [isViewActive, messages.length, snapToBottom])

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
        return typeof url === 'string' ? resolveAvatarUrl(url) : null
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

    const formatPinnedDate = (dateStr: string) => {
        const d = new Date(dateStr)
        const today = new Date()
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        const time = formatTime(dateStr)
        if (d.toDateString() === today.toDateString()) return `Today, ${time}`
        if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + time
    }

    const formatMessageTimestamp = (dateStr: string) => {
        if (useCompactMobileTimestamp) return formatTime(dateStr)
        return formatDate(dateStr)
    }

    const formatDayDivider = (dateStr: string) => {
        const d = new Date(dateStr)
        const today = new Date()
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        if (d.toDateString() === today.toDateString()) return 'Today'
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
        return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
    }

    const isSeenMessage = (messageId: string) => {
        if (!seenMessageId) return false
        const messageIndex = messages.findIndex((message) => message.id === messageId)
        const seenIndex = messages.findIndex((message) => message.id === seenMessageId)
        return messageIndex >= 0 && seenIndex >= 0 && messageIndex <= seenIndex
    }

    const isNewMessageDay = (index: number) => {
        if (index <= 0) return true
        const current = messages[index]
        const previous = messages[index - 1]
        if (!current?.created_at || !previous?.created_at) return false
        return new Date(current.created_at).toDateString() !== new Date(previous.created_at).toDateString()
    }

    const isGroupedMessage = (index: number) => {
        return isMessageGroupedAt(messages, index, firstUnreadIndex)
    }

    const scrollToMessageId = useCallback((messageId: string) => {
        const index = messages.findIndex((m) => m.id === messageId)
        if (index >= 0) {
            rowVirtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' })
            if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
            setHighlightedMessageId(messageId)
            highlightTimeoutRef.current = setTimeout(() => {
                setHighlightedMessageId(null)
                highlightTimeoutRef.current = null
            }, 2500)
        }
        setPinnedOpen(false)
    }, [messages, rowVirtualizer])

    useEffect(() => () => {
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
    }, [])

    useEffect(() => {
        if (!jumpToMessageId || messages.length === 0) return
        const exists = messages.some((message) => message.id === jumpToMessageId)
        if (!exists) return
        shouldAutoScrollRef.current = false
        scrollToMessageId(jumpToMessageId)
        requestAnimationFrame(() => {
            syncAutoScrollState()
        })
        onJumpToMessageHandled?.()
    }, [jumpToMessageId, messages, onJumpToMessageHandled, scrollToMessageId, syncAutoScrollState])

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

    const submitMessage = useCallback((forceContent?: string) => {
        const hasForcedContent = typeof forceContent === 'string' && forceContent.trim().length > 0
        const hasText = messageInput.trim().length > 0
        const hasAttachments = draftAttachments.length > 0
        if (!hasForcedContent && !hasText && !hasAttachments) return
        userReadingHistoryRef.current = false
        preservingOlderMessagesRef.current = false
        olderMessagesAnchorRef.current = null
        pendingSubmitAutoScrollRef.current = true
        shouldAutoScrollRef.current = true
        onSendMessage(undefined, forceContent)
        snapToBottom()
        requestAnimationFrame(() => {
            snapToBottom()
        })
    }, [draftAttachments.length, messageInput, onSendMessage, snapToBottom])

    const insertEmoji = (emoji: string) => {
        if (!canSendMessages) return
        const isInstantMedia = /^!\[(gif|sticker)\]\(https?:\/\/[^\s)]+\)$/i.test(emoji.trim())
        if (isInstantMedia) {
            submitMessage(emoji.trim())
            setEmojiOpen(false)
            closeMentionMenu()
            return
        }
        const inputEl = textareaRef.current
        const start = inputEl?.selectionStart ?? messageInput.length
        const end = inputEl?.selectionEnd ?? start
        const next = `${messageInput.slice(0, start)}${emoji}${messageInput.slice(end)}`
        onMessageInputChange(next)
        setEmojiOpen(false)
        requestAnimationFrame(() => {
            const pos = start + emoji.length
            textareaRef.current?.focus()
            textareaRef.current?.setSelectionRange(pos, pos)
            syncMentionMenu(next, pos)
        })
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!canSendMessages) {
            e.preventDefault()
            return
        }
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
            submitMessage()
        }
    }

    const toggleMessagePicker = (mode: MessagePickerMode, anchor: HTMLButtonElement) => {
        if (!canSendMessages) return
        emojiPickerAnchorRef.current = anchor
        setMessagePickerMode(mode)
        setEmojiOpen((previousOpen) => !(previousOpen && messagePickerMode === mode))
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
        setEmojiOpen(false)
        setReactionPickerMessageId(null)
        setShowJumpToLatest(false)
        userReadingHistoryRef.current = false
        preservingOlderMessagesRef.current = false
        olderMessagesAnchorRef.current = null
    }, [activeChannel?.id])

    useEffect(() => {
        return () => {
            cancelLatestAnchor()
        }
    }, [cancelLatestAnchor])

    useLayoutEffect(() => {
        syncAutoScrollState()
    }, [messages.length, syncAutoScrollState])

    useEffect(() => {
        if (!pinnedOpen) return
        const close = (e: MouseEvent) => {
            if (pinnedDropdownRef.current?.contains(e.target as Node)) return
            setPinnedOpen(false)
        }
        document.addEventListener('click', close)
        return () => document.removeEventListener('click', close)
    }, [pinnedOpen])

    useEffect(() => {
        if (!searchOpen) return
        const onKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key !== 'Escape') return
            onSearchChange?.('')
            setSearchOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [onSearchChange, searchOpen])

    useEffect(() => {
        if (!onSearchChange) return
        const onKeyDown = (e: globalThis.KeyboardEvent) => {
            const target = e.target as HTMLElement | null
            const isFindShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f'
            if (!isFindShortcut) return
            if (target && searchDropdownRef.current?.contains(target)) return
            e.preventDefault()
            setPinnedOpen(false)
            setSearchOpen(true)
            requestAnimationFrame(() => searchInputRef.current?.focus())
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [onSearchChange])

    useEffect(() => {
        if (!emojiOpen) return
        const syncPosition = () => {
            const button = emojiPickerAnchorRef.current
            if (!button) return
            const chatAreaRect = chatAreaRef.current?.getBoundingClientRect()
            const messageInputRect = messageInputWrapperRef.current?.getBoundingClientRect()
            const rect = button.getBoundingClientRect()
            const pickerWidth = 232
            const pickerHeight = emojiPickerRef.current?.getBoundingClientRect().height ?? 336
            const viewportPadding = 16
            const containerPadding = 8
            const minLeft = Math.max(
                viewportPadding,
                (chatAreaRect?.left ?? viewportPadding) + containerPadding
            )
            const maxRight = Math.min(
                window.innerWidth - viewportPadding,
                (chatAreaRect?.right ?? (window.innerWidth - viewportPadding)) - containerPadding
            )
            const minTop = Math.max(
                viewportPadding,
                (chatAreaRect?.top ?? viewportPadding) + containerPadding
            )
            const maxBottom = Math.min(
                window.innerHeight - viewportPadding,
                (chatAreaRect?.bottom ?? (window.innerHeight - viewportPadding)) - containerPadding
            )
            const inputSafeTop = messageInputRect ? messageInputRect.top : maxBottom
            const boundedBottom = Math.min(maxBottom, inputSafeTop)

            const maxLeft = Math.max(minLeft, maxRight - pickerWidth)
            const preferredLeft = rect.right - pickerWidth
            const left = Math.max(minLeft, Math.min(preferredLeft, maxLeft))

            const maxTop = Math.max(minTop, boundedBottom - pickerHeight)
            const preferredTop = inputSafeTop - pickerHeight
            const top = Math.max(minTop, Math.min(preferredTop, maxTop))
            setEmojiPickerPosition({ top, left })
        }
        const close = (e: MouseEvent) => {
            if (emojiPickerRef.current?.contains(e.target as Node)) return
            if (emojiPickerAnchorRef.current?.contains(e.target as Node)) return
            setEmojiOpen(false)
        }
        const onKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key !== 'Escape') return
            setEmojiOpen(false)
        }
        syncPosition()
        document.addEventListener('click', close)
        document.addEventListener('keydown', onKeyDown)
        window.addEventListener('resize', syncPosition)
        window.addEventListener('scroll', syncPosition, true)
        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => {
                syncPosition()
            })
            : null
        if (resizeObserver && emojiPickerRef.current) {
            resizeObserver.observe(emojiPickerRef.current)
        }
        return () => {
            document.removeEventListener('click', close)
            document.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('resize', syncPosition)
            window.removeEventListener('scroll', syncPosition, true)
            resizeObserver?.disconnect()
        }
    }, [emojiOpen, messagePickerMode])


    useEffect(() => {
        if (!reactionPickerMessageId) return
        const syncReactionPickerPosition = () => {
            const anchor = reactionPickerAnchorRef.current
            if (!anchor) return
            const chatAreaRect = chatAreaRef.current?.getBoundingClientRect()
            const anchorRect = anchor.getBoundingClientRect()
            const pickerWidth = 240
            const pickerHeight = reactionPickerRef.current?.getBoundingClientRect().height ?? 280
            const viewportPadding = 12
            const containerPadding = 8
            const minLeft = Math.max(
                viewportPadding,
                (chatAreaRect?.left ?? viewportPadding) + containerPadding
            )
            const maxRight = Math.min(
                window.innerWidth - viewportPadding,
                (chatAreaRect?.right ?? (window.innerWidth - viewportPadding)) - containerPadding
            )
            const minTop = Math.max(
                viewportPadding,
                (chatAreaRect?.top ?? viewportPadding) + containerPadding
            )
            const maxBottom = Math.min(
                window.innerHeight - viewportPadding,
                (chatAreaRect?.bottom ?? (window.innerHeight - viewportPadding)) - containerPadding
            )
            const maxLeft = Math.max(minLeft, maxRight - pickerWidth)
            const preferredLeft = anchorRect.right - pickerWidth
            const left = Math.max(minLeft, Math.min(preferredLeft, maxLeft))
            const preferredAbove = anchorRect.top - pickerHeight - 8
            const preferredBelow = anchorRect.bottom + 8
            const canFitAbove = preferredAbove >= minTop
            const canFitBelow = preferredBelow + pickerHeight <= maxBottom + pickerHeight
            const top = canFitAbove
                ? preferredAbove
                : canFitBelow
                    ? Math.min(preferredBelow, maxBottom - pickerHeight)
                    : Math.max(minTop, Math.min(preferredAbove, maxBottom - pickerHeight))
            setReactionPickerPosition({ top, left })
        }
        const close = (e: MouseEvent) => {
            if (reactionPickerRef.current?.contains(e.target as Node)) return
            if (reactionPickerAnchorRef.current?.contains(e.target as Node)) return
            setReactionPickerMessageId(null)
            reactionPickerAnchorRef.current = null
        }
        const onKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key !== 'Escape') return
            setReactionPickerMessageId(null)
            reactionPickerAnchorRef.current = null
        }
        syncReactionPickerPosition()
        document.addEventListener('click', close)
        document.addEventListener('keydown', onKeyDown)
        window.addEventListener('resize', syncReactionPickerPosition)
        window.addEventListener('scroll', syncReactionPickerPosition, true)
        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => {
                syncReactionPickerPosition()
            })
            : null
        if (resizeObserver && reactionPickerRef.current) {
            resizeObserver.observe(reactionPickerRef.current)
        }
        return () => {
            document.removeEventListener('click', close)
            document.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('resize', syncReactionPickerPosition)
            window.removeEventListener('scroll', syncReactionPickerPosition, true)
            resizeObserver?.disconnect()
        }
    }, [reactionPickerMessageId])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const onResize = () => setUseCompactMobileTimestamp(window.innerWidth <= 520)
        onResize()
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [])

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (!canSendMessages) return
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
        const { text, gifUrls, stickerUrls } = extractEmbeddedMediaMarkdown(content)
        // Split by mentions OR direct http/https URLs
        // We match mentions: @[^\s@]{2,32} or @all or @everyone
        // And we match urls: https?:\/\/[^\s]+
        const parts = text.split(/(@[^\s@]{2,32}|@all|@everyone|https?:\/\/[^\s]+)/g)
        const rendered = parts.map((part, idx) => {
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
        if (gifUrls.length === 0 && stickerUrls.length === 0) return rendered
        return (
            <>
                {rendered}
                {stickerUrls.length > 0 && (
                    <div className="chat-inline-gif-list">
                        {stickerUrls.map((url, index) => {
                            return (
                                <div
                                    key={`${url}-${index}`}
                                    className="chat-inline-gif-link chat-inline-sticker-link"
                                    onClickCapture={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                    }}
                                >
                                    <InlineMediaImage src={url} alt="Sticker preview" className="chat-inline-sticker" />
                                </div>
                            )
                        })}
                    </div>
                )}
                {gifUrls.length > 0 && (
                    <div className="chat-inline-gif-list">
                        {gifUrls.map((url, index) => {
                            return (
                                <div
                                    key={`${url}-${index}`}
                                    className="chat-inline-gif-link"
                                    onClickCapture={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                    }}
                                >
                                    <InlineMediaImage src={url} alt="GIF preview" className="chat-inline-gif" />
                                </div>
                            )
                        })}
                    </div>
                )}
            </>
        )
    }

    const renderMessageContent = (content: string) => {
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
                {loading ? (
                    <div className="chat-loading-state chat-loading-state--centered" aria-hidden="true">
                        <div className="chat-loading-bubble" />
                        <div className="chat-loading-bubble short" />
                        <div className="chat-loading-bubble" />
                    </div>
                ) : (
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
                )}
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
                    <div className="channel-header-copy">
                        <span className="channel-title">{activeChannel.name}</span>
                        {activeChannel.description?.trim() && (
                            <>
                                <span className="channel-description-separator" aria-hidden="true" />
                                <span className="channel-description">{activeChannel.description.trim()}</span>
                            </>
                        )}
                    </div>
                    {showMemberSheetButton && onOpenMemberSheet && (
                        <div className="chat-header-right">
                            <button
                                type="button"
                                className="chat-header-member-btn"
                                onClick={onOpenMemberSheet}
                                title="View members"
                                aria-label="View members"
                            >
                                <Users size={17} />
                            </button>
                        </div>
                    )}
                </div>
                <div className="voice-focus-panel voice-focus-panel-stage" />
            </div>
        )
    }

    return (
        <div className={`chat-area${replyingTo ? ' chat-area-replying' : ''}`} ref={chatAreaRef}>
            <div className="chat-header">
                <span className="channel-hash">
                    <Hash size={20} />
                </span>
                <div className="channel-header-copy">
                    <span className="channel-title">{activeChannel.name}</span>
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
                                            >
                                                from:
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => applySearchFilter('has:attachment')}
                                                title="Only show messages with attachments"
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
                                            onSearchChange('')
                                            setSearchOpen(false)
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
                                                        onClick={() => scrollToMessageId(m.id)}
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
                            title="View members"
                            aria-label="View members"
                        >
                            <Users size={17} />
                        </button>
                    )}
                </div>
            </div>

            {topContent}

            <div
                className="chat-messages chat-messages-virtual"
                ref={setMessagesScrollRef}
                onWheel={handleWheelScrollIntent}
                onPointerDown={handlePointerDownScrollIntent}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMoveScrollIntent}
                onScroll={handleMessagesScroll}
            >
                {hasMoreOlder && messages.length > 0 && (
                    <div className="chat-load-older" aria-live="polite">
                        {loadingOlder ? 'Loading older messages…' : 'Scroll up for older messages'}
                    </div>
                )}
                {loading ? (
                    <div className="chat-loading-state" aria-hidden="true">
                        <div className="chat-loading-bubble" />
                        <div className="chat-loading-bubble short" />
                        <div className="chat-loading-bubble" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="welcome-screen">
                        <div className="welcome-icon">
                            <Hash size={36} />
                        </div>
                        <h2>{emptyStateTitle ?? `Welcome to #${activeChannel.name}!`}</h2>
                        <p>{emptyStateDescription ?? activeChannel.description?.trim() ?? 'This is the beginning of the channel. Start the conversation!'}</p>
                        {emptyStateActions && emptyStateActions.length > 0 && (
                            <div className="welcome-screen-actions">
                                {emptyStateActions.map((action) => (
                                    <button
                                        key={action.label}
                                        type="button"
                                        className={`home-onboarding-btn ${action.variant === 'secondary' ? 'home-onboarding-btn--secondary' : ''}`}
                                        onClick={action.onClick}
                                    >
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div
                        ref={virtualListSpacerRef}
                        className="virtual-list-spacer"
                        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                    >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const isTypingRow = typingIndicatorLabel && virtualRow.index === messages.length
                            if (isTypingRow) {
                                return (
                                    <div
                                        key="typing-row"
                                        data-index={virtualRow.index}
                                        ref={rowVirtualizer.measureElement}
                                        className="virtual-list-item"
                                        style={{ transform: `translateY(${Math.round(virtualRow.start)}px)` }}
                                    >
                                        <div className="typing-indicator">{typingIndicatorLabel}</div>
                                    </div>
                                )
                            }
                            const msg = messages[virtualRow.index]
                            const showDayDivider = isNewMessageDay(virtualRow.index)
                            const showUnreadDivider = firstUnreadIndex >= 0 && virtualRow.index === firstUnreadIndex
                            const isGrouped = isGroupedMessage(virtualRow.index)
                            const messageInlineActions = !msg.clientId ? (
                                <MessageInlineActions
                                    messageId={msg.id}
                                    currentUserId={currentUserId}
                                    authorUserId={msg.author?.user_id}
                                    canModerate={canModerate}
                                    canReact={!!onToggleReaction}
                                    reactionPickerOpen={reactionPickerMessageId === msg.id}
                                    onToggleReactionPicker={(messageId, anchorEl) => {
                                        reactionPickerAnchorRef.current = anchorEl
                                        setReactionPickerMessageId((prev) => (prev === messageId ? null : messageId))
                                    }}
                                    canPin={!!(onPinMessage || onUnpinMessage)}
                                    isPinned={pinnedMessageIds.has(msg.id)}
                                    onPin={onPinMessage}
                                    onUnpin={onUnpinMessage}
                                    onReply={onReplyToMessage ? () => {
                                        onReplyToMessage(msg)
                                        setTimeout(() => textareaRef.current?.focus(), 0)
                                    } : undefined}
                                    onReport={msg.author?.user_id !== currentUserId && onReportMessage ? () => onReportMessage(msg) : undefined}
                                    onEdit={msg.author?.user_id === currentUserId && onEditMessage && onSaveEdit && onCancelEdit ? () => {
                                        const parsed = parseReplyContent(msg.content)
                                        if (parsed) {
                                            const quotePart = msg.content.slice(0, msg.content.indexOf('\n\n'))
                                            onEditMessage({ id: msg.id, content: msg.content, contentToEdit: parsed.replyBody, replyQuotePart: quotePart })
                                        } else {
                                            onEditMessage({ id: msg.id, content: msg.content })
                                        }
                                    } : undefined}
                                    onDelete={onDeleteMessage ? () => onDeleteMessage(msg.id) : undefined}
                                />
                            ) : null
                            const failedState = msg.clientStatus === 'failed' ? (
                                <span className="message-send-state is-failed">Failed</span>
                            ) : null
                            return (
                                <div
                                    key={msg.id}
                                    data-index={virtualRow.index}
                                    data-message-id={msg.id}
                                    ref={rowVirtualizer.measureElement}
                                    className={`virtual-list-item ${virtualRow.index === 0 ? 'virtual-list-item-first' : ''}`}
                                    style={{ transform: `translateY(${Math.round(virtualRow.start)}px)` }}
                                >
                                    {showDayDivider && (
                                        <div className="message-day-divider" aria-label={`Messages from ${formatDayDivider(msg.created_at)}`}>
                                            <span>{formatDayDivider(msg.created_at)}</span>
                                        </div>
                                    )}
                                    {showUnreadDivider && (
                                        <div className="message-unread-divider" aria-label="New unread messages">
                                            <span>New messages</span>
                                        </div>
                                    )}
                                    <div className={`message${isGrouped ? ' message-compact' : ''}${highlightedMessageId === msg.id ? ' message-highlight-jump' : ''}`}>
                                        <div className="message-avatar" aria-hidden={isGrouped ? 'true' : undefined}>
                                            {!isGrouped && (
                                                getAuthorAvatarUrl(msg.author || {}) ? (
                                                    <img src={getAuthorAvatarUrl(msg.author || {}) ?? ''} alt="" />
                                                ) : (
                                                    getInitial(msg.author?.username ?? '?')
                                                )
                                            )}
                                        </div>
                                        <div className="message-content">
                                            {isGrouped && messageInlineActions}
                                            {!isGrouped && (
                                                <div className="message-header">
                                                    <span
                                                        className="message-author"
                                                        style={msg.author.role_color ? { color: msg.author.role_color } : undefined}
                                                    >
                                                        {msg.author.username}
                                                    </span>
                                                    <span className="message-timestamp" title={formatDate(msg.created_at)}>
                                                        {formatMessageTimestamp(msg.created_at)}
                                                    </span>
                                                    {msg.edited_at && <span className="message-edited" title="Edited">(edited)</span>}
                                                    {messageInlineActions}
                                                    {failedState}
                                                </div>
                                                )}
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
                                            {Array.isArray(msg.reactions) && msg.reactions.length > 0 && (
                                                <div className="message-reactions">
                                                    {msg.reactions.map((reaction) => (
                                                        <button
                                                            key={`${msg.id}-${reaction.emoji}`}
                                                            type="button"
                                                            className={`message-reaction-btn ${reaction.reacted ? 'is-reacted' : ''}`}
                                                            disabled={!onToggleReaction}
                                                            onClick={() => onToggleReaction?.(msg.id, reaction.emoji, !!reaction.reacted)}
                                                        >
                                                            <span>{reaction.emoji}</span>
                                                            <span>{reaction.count}</span>
                                                        </button>
                                                    ))}
                                                </div>
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
                                                        return (
                                                            <AttachmentLink key={`${att.url}-${i}`} attachment={att} index={i} />
                                                        )
                                                    })}
                                                </div>
                                            )}
                                            {isDm && msg.author?.user_id === currentUserId && isSeenMessage(msg.id) && (
                                                <div className="dm-seen">Seen</div>
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
                {showJumpToLatest && (
                    <button
                        type="button"
                        className="chat-jump-to-latest"
                        onClick={() => {
                            userReadingHistoryRef.current = false
                            preservingOlderMessagesRef.current = false
                            olderMessagesAnchorRef.current = null
                            snapToBottom()
                            requestAnimationFrame(() => {
                                snapToBottom()
                            })
                        }}
                        aria-label="Jump to latest messages"
                    >
                        <ArrowDown size={14} />
                        Newest
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
                        {draftAttachments.map((att, i) => (
                            <div
                                key={`${att.name}-${i}`}
                                className={`dm-draft-attachment is-${att.uploadStatus}`}
                            >
                                <div className="dm-draft-attachment-meta">
                                    <span title={att.name}>{att.name}</span>
                                    {att.uploadStatus === 'uploading' && (
                                        <span className="dm-draft-attachment-state">Uploading...</span>
                                    )}
                                    {att.uploadStatus === 'uploaded' && (
                                        <span className="dm-draft-attachment-state is-uploaded">Ready to send</span>
                                    )}
                                    {att.uploadStatus === 'failed' && (
                                        <span className="dm-draft-attachment-state is-failed">
                                            {att.uploadError || 'Upload failed'}
                                        </span>
                                    )}
                                </div>
                                {att.uploadStatus === 'failed' && onRetryAttachment && (
                                    <button
                                        type="button"
                                        className="dm-draft-attachment-retry"
                                        onClick={() => onRetryAttachment(att.localId)}
                                    >
                                        Retry
                                    </button>
                                )}
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
                <div className="message-input-wrapper" ref={messageInputWrapperRef}>
                    <label className="dm-attach-btn" title="Attach files">
                        <Paperclip size={16} />
                        <input
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
                    </label>
                    {emojiOpen && emojiPickerPosition && createPortal(
                        <div
                            ref={emojiPickerRef}
                            className="chat-emoji-picker-shell chat-emoji-picker-portal"
                            style={{
                                top: emojiPickerPosition.top,
                                left: emojiPickerPosition.left,
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <EmojiPicker initialMode={messagePickerMode} onSelect={insertEmoji} />
                        </div>,
                        document.body
                    )}
                    <textarea
                        ref={textareaRef}
                        className="message-input"
                        value={messageInput}
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
                        placeholder={canSendMessages ? (isDm ? `Message @${activeChannel.name}` : `Message #${activeChannel.name}`) : `You don't have permission to send messages in #${activeChannel.name}`}
                        rows={1}
                    />
                    <div className="message-input-actions" aria-label="Message actions">
                        <button
                            type="button"
                            className="chat-emoji-btn"
                            disabled={!canSendMessages}
                            title="Insert emoji"
                            aria-label="Insert emoji"
                            onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                toggleMessagePicker('emoji', e.currentTarget)
                            }}
                        >
                            <Smile size={16} />
                        </button>
                        <button
                            type="button"
                            className="chat-emoji-btn chat-media-action-btn"
                            disabled={!canSendMessages}
                            title="Browse GIFs"
                            aria-label="Browse GIFs"
                            onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                toggleMessagePicker('gif', e.currentTarget)
                            }}
                        >
                            <span className="chat-media-action-label" aria-hidden="true">GIF</span>
                        </button>
                        <button
                            type="button"
                            className="chat-emoji-btn"
                            disabled={!canSendMessages}
                            title="Browse stickers"
                            aria-label="Browse stickers"
                            onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                toggleMessagePicker('sticker', e.currentTarget)
                            }}
                        >
                            <Sticker size={16} />
                        </button>
                        <button
                            type="button"
                            className={`message-send-btn ${(messageInput.trim() || draftAttachments.length > 0) ? 'is-ready' : ''}`}
                            disabled={!canSendMessages}
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
            {reactionPickerMessageId && reactionPickerPosition && onToggleReaction && createPortal(
                <div
                    ref={reactionPickerRef}
                    className="message-reaction-picker message-reaction-picker-portal"
                    style={{
                        top: reactionPickerPosition.top,
                        left: reactionPickerPosition.left,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <EmojiPicker
                        compact
                        reactionMode
                        onSelect={(emoji) => {
                            onToggleReaction(reactionPickerMessageId, emoji, false)
                            setReactionPickerMessageId(null)
                            reactionPickerAnchorRef.current = null
                        }}
                    />
                </div>,
                document.body
            )}
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
