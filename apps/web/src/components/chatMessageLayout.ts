import type { Attachment } from '../types'
import { type MessageWithAuthor } from '../api'
import { cleanReplyQuotePreview } from '../replyPreview'
import { isImageAttachment } from './chatAttachmentCache'

/** Message list layout: grouping, row height estimates and embedded media parsing. */
export type UiMessage = MessageWithAuthor & {
    clientId?: string
    clientStatus?: 'sending' | 'failed'
    clientError?: string
}

export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000

// Includes the virtual item's 1px bottom padding. Keep these values aligned with
// the desktop and max-width: 1023px message/divider rules in index.css.
export const MESSAGE_ROW_METRICS = {
    desktop: {
        grouped: 23,
        group: 53,
        firstDayDivider: 34,
        dayDivider: 46,
        unreadDivider: 38,
        typing: 27,
    },
    mobile: {
        grouped: 23,
        group: 44,
        firstDayDivider: 28,
        dayDivider: 24,
        unreadDivider: 28,
        typing: 27,
    },
} as const

export const ESTIMATED_ATTACHMENT_ROW_PX = 36

export const ESTIMATED_MEDIA_ROW_PX = 228

export const ESTIMATED_STICKER_ROW_PX = 128

export const ESTIMATED_TEXT_CHARS_PER_LINE = 92

export const ESTIMATED_REACTION_LINE_PX = 30

export function extractEmbeddedMediaMarkdown(content: string): { text: string; gifUrls: string[]; stickerUrls: string[] } {
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

export const EMOJI_ONLY_CONTENT = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u200D|\u20E3|\s)+$/u

export const EMOJI_CODE_POINT = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

export function getEmojiOnlyCount(content: string): number {
    const parsed = parseReplyContent(content)
    if (parsed) return 0
    const { text, gifUrls, stickerUrls } = extractEmbeddedMediaMarkdown(content)
    const visibleText = text.trim()
    if (!visibleText || gifUrls.length > 0 || stickerUrls.length > 0 || !EMOJI_ONLY_CONTENT.test(visibleText)) return 0
    const count = Array.from(visibleText).filter((character) => EMOJI_CODE_POINT.test(character)).length
    return count > 0 && count <= 4 ? count : 0
}

export function getMessageAuthorKey(msg: UiMessage | undefined) {
    if (!msg?.author) return ''
    return msg.author.user_id || msg.author.username || ''
}

export function isNewMessageDayAt(messages: UiMessage[], index: number) {
    if (index <= 0) return true
    const current = messages[index]
    const previous = messages[index - 1]
    if (!current?.created_at || !previous?.created_at) return false
    return new Date(current.created_at).toDateString() !== new Date(previous.created_at).toDateString()
}

export function isMessageGroupedAt(messages: UiMessage[], index: number, firstUnreadIndex: number) {
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

export function estimateTextExtraHeight(content: string) {
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

export function estimateEmbeddedMediaHeight(content: string) {
    const { gifUrls, stickerUrls } = extractEmbeddedMediaMarkdown(content)
    let extra = 0
    if (gifUrls.length > 0) extra += ESTIMATED_MEDIA_ROW_PX * Math.ceil(gifUrls.length / 2)
    if (stickerUrls.length > 0) extra += ESTIMATED_STICKER_ROW_PX * Math.ceil(stickerUrls.length / 2)
    return extra
}

export function estimateAttachmentHeight(attachments?: Attachment[]) {
    if (!Array.isArray(attachments) || attachments.length === 0) return 0
    const hasImage = attachments.some(isImageAttachment)
    if (hasImage) return ESTIMATED_MEDIA_ROW_PX
    return ESTIMATED_ATTACHMENT_ROW_PX * Math.ceil(attachments.length / 2)
}

/** Parses "> @username: quote\n\nreply" into { replyUsername, replyQuote, replyBody } or null. */
export function parseReplyContent(content: string): { replyUsername: string; replyQuote: string; replyBody: string } | null {
    if (!content.startsWith('> @')) return null
    const doubleNewline = content.indexOf('\n\n')
    if (doubleNewline < 0) return null
    const quotePart = content.slice(0, doubleNewline).trim()
    const replyBody = content.slice(doubleNewline + 2).trim()
    const match = quotePart.match(/^>\s*@([^:]+):\s*(.*)$/s)
    if (!match) return null
    return { replyUsername: match[1].trim(), replyQuote: cleanReplyQuotePreview(match[2]), replyBody }
}

export function estimateMessageRowHeight(
    messages: UiMessage[],
    index: number,
    firstUnreadIndex: number,
    hasTypingRow: boolean,
    mobileLayout: boolean = false,
) {
    const metrics = mobileLayout ? MESSAGE_ROW_METRICS.mobile : MESSAGE_ROW_METRICS.desktop
    if (hasTypingRow && index === messages.length) return metrics.typing
    const message = messages[index]
    if (!message) return metrics.group

    const isGrouped = isMessageGroupedAt(messages, index, firstUnreadIndex)
    let estimate = isGrouped ? metrics.grouped : metrics.group
    if (isNewMessageDayAt(messages, index)) {
        estimate += index === 0 ? metrics.firstDayDivider : metrics.dayDivider
    }
    if (firstUnreadIndex >= 0 && index === firstUnreadIndex) estimate += metrics.unreadDivider
    if (message.edited_at || message.clientStatus === 'failed') estimate += 8
    estimate += estimateTextExtraHeight(message.content ?? '')
    estimate += estimateEmbeddedMediaHeight(message.content ?? '')
    estimate += estimateAttachmentHeight(message.attachments)
    const reactionCount = Array.isArray(message.reactions) ? message.reactions.length : 0
    if (reactionCount > 0) {
        const reactionsPerLine = mobileLayout ? 4 : 8
        estimate += Math.ceil(reactionCount / reactionsPerLine) * ESTIMATED_REACTION_LINE_PX
    }
    return Math.max(metrics.grouped, estimate)
}

export function captureVisibleMessageAnchor(element: HTMLDivElement): { messageId: string; offsetTop: number } | null {
    const scrollerRect = element.getBoundingClientRect()
    const candidate = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]'))
        .map((item) => ({ item, rect: item.getBoundingClientRect() }))
        .filter(({ rect }) => rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom)
        .sort((left, right) => Math.abs(left.rect.top - scrollerRect.top) - Math.abs(right.rect.top - scrollerRect.top))[0]
    const messageId = candidate?.item.dataset.messageId
    return messageId
        ? { messageId, offsetTop: candidate.rect.top - scrollerRect.top }
        : null
}
