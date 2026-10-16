import { useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { X } from 'lucide-react'
import type { Attachment } from '../types'
import { resolveAttachmentUrl } from '../api'
import { useAuthStore } from '../stores/auth'
import type { AttachmentResolutionState } from './chatAttachmentCache'
import { attachmentResolutionCache, decodeAttachmentImage, decodedAttachmentImageCache, defaultAttachmentResolution, getAttachmentResolutionCacheKey, isImageAttachment, rememberAttachmentResolution, rememberDecodedAttachmentImage } from './chatAttachmentCache'

/** Message attachments: the image preview, the signed-URL resolution cache and attachment links. */
export function AttachmentImagePreviewModal({
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
    const dialogRef = useRef<HTMLDivElement>(null)
    useDialogFocus(dialogRef, true)
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
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
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

export function AttachmentLink({ attachment, index }: { attachment: Attachment; index: number }) {
    const token = useAuthStore((s) => s.token)
    const userId = useAuthStore((s) => s.user?.id ?? null)
    const [previewOpen, setPreviewOpen] = useState(false)
    const [downloadState, setDownloadState] = useState<'idle' | 'loading' | 'started' | 'error'>('idle')
    const downloadBusyRef = useRef(false)
    const downloadCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const fallbackInFlightRef = useRef(false)
    const isImage = isImageAttachment(attachment)
    const cacheKey = getAttachmentResolutionCacheKey(attachment, token ?? null, userId)
    const [resolution, setResolution] = useState<AttachmentResolutionState>(() => (
        attachmentResolutionCache.get(cacheKey) ?? defaultAttachmentResolution(attachment.url, cacheKey)
    ))
    const currentResolution = resolution.cacheKey === cacheKey
        ? resolution
        : attachmentResolutionCache.get(cacheKey) ?? defaultAttachmentResolution(attachment.url, cacheKey)
    const [imageDecoded, setImageDecoded] = useState(() => (
        !isImage || (currentResolution.resolved && decodedAttachmentImageCache.has(currentResolution.resolvedUrl))
    ))

    useEffect(() => {
        if (!isImage) return
        let cancelled = false
        const cached = attachmentResolutionCache.get(cacheKey)
        if (cached && (!cached.loadFailed || cached.sourceUrl === attachment.url)) {
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
                    cacheKey,
                    sourceUrl: attachment.url,
                    resolved: true,
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
                        cacheKey,
                        sourceUrl: attachment.url,
                        resolved: true,
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

    useEffect(() => () => {
        if (downloadCooldownRef.current) clearTimeout(downloadCooldownRef.current)
    }, [])

    const startDownload = async () => {
        if (downloadBusyRef.current) return
        downloadBusyRef.current = true
        setDownloadState('loading')
        try {
            const url = await resolveAttachmentUrl(attachment.url, token ?? null, {
                forceAuthenticatedFetch: true,
                fallbackMimeType: attachment.type,
            })
            const link = document.createElement('a')
            link.href = url
            link.download = attachment.name || 'attachment'
            document.body.appendChild(link)
            link.click()
            link.remove()
            if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60_000)
            setDownloadState('started')
            downloadCooldownRef.current = setTimeout(() => {
                downloadBusyRef.current = false
            }, 2000)
        } catch {
            downloadBusyRef.current = false
            setDownloadState('error')
        }
    }

    useEffect(() => {
        fallbackInFlightRef.current = false
    }, [attachment.url])

    useEffect(() => {
        if (!isImage || currentResolution.loadFailed || !currentResolution.resolved) {
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
    }, [currentResolution.loadFailed, currentResolution.resolved, currentResolution.resolvedUrl, isImage])

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
                    if (current.cacheKey !== cacheKey) return current
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
                            if (current.cacheKey !== cacheKey) {
                                if (nextUrl.startsWith('blob:')) URL.revokeObjectURL(nextUrl)
                                return current
                            }
                            const nextResolution = {
                                cacheKey,
                                sourceUrl: attachment.url,
                                resolved: true,
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
                            if (current.cacheKey !== cacheKey) return current
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
                if (current.cacheKey !== cacheKey) return current
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
                            onLoad={() => {
                                rememberDecodedAttachmentImage(currentResolution.resolvedUrl)
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
        <span className="chat-file-download">
            <a
                href={attachment.url}
                download={attachment.name || 'attachment'}
                className="dm-attachment-link"
                aria-disabled={downloadState === 'loading'}
                onClick={(event) => {
                    event.preventDefault()
                    void startDownload()
                }}
            >
                {attachment.name || `Attachment ${index + 1}`}
            </a>
            <span className="chat-file-download-status" role="status">
                {downloadState === 'loading' && 'Preparing download...'}
                {downloadState === 'started' && 'Download started'}
                {downloadState === 'error' && 'Download failed. Click to retry.'}
            </span>
        </span>
    )
}
