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

export function revokeAttachmentUrl(url: string) {
    URL.revokeObjectURL(url)
    decodedAttachmentImageCache.delete(url)
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

export function decodeAttachmentImage(url: string): Promise<void> {
    if (decodedAttachmentImageCache.has(url)) return Promise.resolve()
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
        rememberDecodedAttachmentImage(url)
        return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.decoding = 'async'
        image.onload = () => {
            rememberDecodedAttachmentImage(url)
            resolve()
        }
        image.onerror = () => reject(new Error('Image decode failed'))
        image.src = url
        const decode = image.decode?.()
        if (decode) {
            decode
                .then(() => {
                    rememberDecodedAttachmentImage(url)
                    resolve()
                })
                .catch(() => {
                    if (image.complete && image.naturalWidth > 0) {
                        rememberDecodedAttachmentImage(url)
                        resolve()
                        return
                    }
                    reject(new Error('Image decode failed'))
                })
        }
    })
}
