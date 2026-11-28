import type { Attachment } from '../types'
import { getApiBase } from '../api'

/** Signed attachment URL resolution and decoded-image caches shared by message attachments. */
export function isImageAttachment(attachment: Attachment): boolean {
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

export type AttachmentResolutionState = {
    cacheKey: string
    sourceUrl: string
    resolvedUrl: string
    loadFailed: boolean
    triedDirectFallback: boolean
    /** False until resolveAttachmentUrl settles; unresolved signed URLs are never displayed. */
    resolved: boolean
}

export const MAX_ATTACHMENT_RESOLUTION_CACHE_ENTRIES = 160

export const attachmentResolutionCache = new Map<string, AttachmentResolutionState>()

export const decodedAttachmentImageCache = new Set<string>()

export const MAX_DECODED_ATTACHMENT_IMAGE_ENTRIES = MAX_ATTACHMENT_RESOLUTION_CACHE_ENTRIES * 2

/** Insertion-ordered and bounded; revoked blob URLs are forgotten in revokeAttachmentUrl. */
export function rememberDecodedAttachmentImage(url: string) {
    decodedAttachmentImageCache.delete(url)
    decodedAttachmentImageCache.add(url)
    while (decodedAttachmentImageCache.size > MAX_DECODED_ATTACHMENT_IMAGE_ENTRIES) {
        const oldest = decodedAttachmentImageCache.values().next().value
        if (oldest === undefined) break
        decodedAttachmentImageCache.delete(oldest)
    }
}

export type AttachmentImageSize = { width: number; height: number }

/** The largest box a message image is drawn in: `.chat-image-attachment` in social.css. */
export const ATTACHMENT_IMAGE_MAX_WIDTH_PX = 320
export const ATTACHMENT_IMAGE_MAX_HEIGHT_PX = 220

const ATTACHMENT_IMAGE_SIZE_STORAGE_KEY = 'voxpery-attachment-image-sizes'
export const MAX_ATTACHMENT_IMAGE_SIZE_ENTRIES = 300
const ATTACHMENT_IMAGE_SIZE_SAVE_DELAY_MS = 1000

let attachmentImageSizes: Map<string, AttachmentImageSize> | null = null
let attachmentImageSizeSaveTimer: ReturnType<typeof setTimeout> | null = null

function isImageDimension(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000
}

/**
 * Natural sizes of message images seen in this browser, so an image that is fetched again (after
 * a reload, or once its decoded copy is gone) is laid out at its final size before it arrives and
 * the conversation around it does not move. Kept per browser and cleared on sign-out.
 */
function attachmentImageSizeCache(): Map<string, AttachmentImageSize> {
    if (attachmentImageSizes) return attachmentImageSizes
    attachmentImageSizes = new Map()
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(ATTACHMENT_IMAGE_SIZE_STORAGE_KEY) ?? '[]')
        if (Array.isArray(stored)) {
            for (const entry of stored.slice(-MAX_ATTACHMENT_IMAGE_SIZE_ENTRIES)) {
                if (Array.isArray(entry) && typeof entry[0] === 'string' && isImageDimension(entry[1]) && isImageDimension(entry[2])) {
                    attachmentImageSizes.set(entry[0], { width: entry[1], height: entry[2] })
                }
            }
        }
    } catch { /* Storage may be unavailable or hold something else; start empty. */ }
    return attachmentImageSizes
}

function saveAttachmentImageSizesSoon() {
    if (attachmentImageSizeSaveTimer != null) return
    attachmentImageSizeSaveTimer = setTimeout(() => {
        attachmentImageSizeSaveTimer = null
        const entries = Array.from(attachmentImageSizeCache(), ([key, size]) => [key, size.width, size.height])
        try {
            localStorage.setItem(ATTACHMENT_IMAGE_SIZE_STORAGE_KEY, JSON.stringify(entries))
        } catch { /* Storage may be unavailable or full; sizes are then kept for this tab only. */ }
    }, ATTACHMENT_IMAGE_SIZE_SAVE_DELAY_MS)
}

/** The same image content has the same size, whichever message or signed URL carries it. */
export function getAttachmentImageSizeKey(attachment: Attachment) {
    return attachment.sha256 ? `sha256:${attachment.sha256}` : getAttachmentIdentity(attachment)
}

export function getAttachmentImageSize(key: string): AttachmentImageSize | null {
    return attachmentImageSizeCache().get(key) ?? null
}

/** Insertion-ordered and bounded, like the other attachment caches. */
export function rememberAttachmentImageSize(key: string, width: number, height: number) {
    if (!isImageDimension(width) || !isImageDimension(height)) return
    const cache = attachmentImageSizeCache()
    const previous = cache.get(key)
    if (previous?.width === width && previous.height === height) return
    cache.delete(key)
    cache.set(key, { width, height })
    while (cache.size > MAX_ATTACHMENT_IMAGE_SIZE_ENTRIES) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
    }
    saveAttachmentImageSizesSoon()
}

/** The size a message image is drawn at: scaled down to fit the box, never up. */
export function attachmentImageDisplaySize(size: AttachmentImageSize): AttachmentImageSize {
    const scale = Math.min(1, ATTACHMENT_IMAGE_MAX_WIDTH_PX / size.width, ATTACHMENT_IMAGE_MAX_HEIGHT_PX / size.height)
    return { width: size.width * scale, height: size.height * scale }
}

export function revokeAttachmentUrl(url: string) {
    URL.revokeObjectURL(url)
    decodedAttachmentImageCache.delete(url)
}

/** Drops every resolved attachment, including the blob URLs that hold its bytes. */
export function clearAttachmentCaches() {
    for (const { resolvedUrl } of attachmentResolutionCache.values()) {
        if (resolvedUrl.startsWith('blob:')) revokeAttachmentUrl(resolvedUrl)
    }
    attachmentResolutionCache.clear()
    decodedAttachmentImageCache.clear()
    if (attachmentImageSizeSaveTimer != null) {
        clearTimeout(attachmentImageSizeSaveTimer)
        attachmentImageSizeSaveTimer = null
    }
    attachmentImageSizes = new Map()
    try {
        localStorage.removeItem(ATTACHMENT_IMAGE_SIZE_STORAGE_KEY)
    } catch { /* Storage may be unavailable; there is then nothing to clear. */ }
}

export function defaultAttachmentResolution(sourceUrl: string, cacheKey: string): AttachmentResolutionState {
    return {
        cacheKey,
        sourceUrl,
        resolvedUrl: sourceUrl,
        loadFailed: false,
        triedDirectFallback: false,
        resolved: false,
    }
}

export function getAttachmentIdentity(attachment: Attachment) {
    if (attachment.id) {
        try {
            const url = new URL(attachment.url, window.location.href)
            const apiOrigin = new URL(getApiBase(), window.location.href).origin
            if ((url.origin === apiOrigin || url.origin === window.location.origin)
                && url.pathname === `/api/attachments/content/${attachment.id}`) {
                url.searchParams.delete('exp')
                url.searchParams.delete('sig')
                return [url.href, attachment.sha256 ?? ''].join('\n')
            }
        } catch { /* Legacy attachments retain their original URL identity. */ }
    }
    return attachment.url
}

export function getAttachmentResolutionCacheKey(attachment: Attachment, token: string | null, userId: string | null) {
    return [getAttachmentIdentity(attachment), attachment.type ?? '', userId ?? 'guest', token ?? 'cookie-auth'].join('\n')
}

export function rememberAttachmentResolution(cacheKey: string, resolution: AttachmentResolutionState) {
    const previous = attachmentResolutionCache.get(cacheKey)
    if (previous?.resolvedUrl.startsWith('blob:') && previous.resolvedUrl !== resolution.resolvedUrl) {
        revokeAttachmentUrl(previous.resolvedUrl)
    }
    attachmentResolutionCache.delete(cacheKey)
    attachmentResolutionCache.set(cacheKey, resolution)
    while (attachmentResolutionCache.size > MAX_ATTACHMENT_RESOLUTION_CACHE_ENTRIES) {
        const oldestKey = attachmentResolutionCache.keys().next().value
        if (!oldestKey) break
        const oldest = attachmentResolutionCache.get(oldestKey)
        if (oldest?.resolvedUrl.startsWith('blob:')) revokeAttachmentUrl(oldest.resolvedUrl)
        attachmentResolutionCache.delete(oldestKey)
    }
}

/** Resolves with the image's natural size once it is decoded, or null when that is unknown. */
export function decodeAttachmentImage(url: string): Promise<AttachmentImageSize | null> {
    if (decodedAttachmentImageCache.has(url)) return Promise.resolve(null)
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
        rememberDecodedAttachmentImage(url)
        return Promise.resolve(null)
    }
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.decoding = 'async'
        const naturalSize = () => (
            image.naturalWidth > 0 && image.naturalHeight > 0
                ? { width: image.naturalWidth, height: image.naturalHeight }
                : null
        )
        image.onload = () => {
            rememberDecodedAttachmentImage(url)
            resolve(naturalSize())
        }
        image.onerror = () => reject(new Error('Image decode failed'))
        image.src = url
        const decode = image.decode?.()
        if (decode) {
            decode
                .then(() => {
                    rememberDecodedAttachmentImage(url)
                    resolve(naturalSize())
                })
                .catch(() => {
                    if (image.complete && image.naturalWidth > 0) {
                        rememberDecodedAttachmentImage(url)
                        resolve(naturalSize())
                        return
                    }
                    reject(new Error('Image decode failed'))
                })
        }
    })
}
