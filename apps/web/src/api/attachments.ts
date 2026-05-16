import { getSecureToken, isTauri } from '../secureStorage'
import { apiMultipartFetch } from './client'
import type { AuthToken, UploadedAttachment } from './contracts'

function isLoopbackAttachmentUrl(url: string): boolean {
    try {
        const parsed = new URL(url, typeof window === 'undefined' ? undefined : window.location.href)
        return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1'
    } catch {
        return false
    }
}

export async function resolveAttachmentUrl(
    url: string,
    token: string | null,
    options?: { forceAuthenticatedFetch?: boolean; fallbackMimeType?: string }
): Promise<string> {
    // Desktop production attachments need Bearer auth, while local desktop dev can
    // rely on the same localhost cookie path as the web app. In both cases we
    // resolve to a blob URL so the chat preview stays in-app.
    const isDesktop = isTauri()
    const shouldUseBrowserFetch = !isDesktop || isLoopbackAttachmentUrl(url)
    if (!isDesktop && !options?.forceAuthenticatedFetch) return url
    if (shouldUseBrowserFetch) {
        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`
        const res = await fetch(url, {
            method: 'GET',
            headers,
            credentials: 'include',
        })
        if (!res.ok) {
            throw new Error(`Attachment request failed with HTTP ${res.status}`)
        }
        const blob = new Blob([await res.arrayBuffer()], {
            type: res.headers.get('content-type') || options?.fallbackMimeType || 'application/octet-stream',
        })
        return URL.createObjectURL(blob)
    }
    const desktopToken = token ?? await getSecureToken()
    if (!desktopToken) return url
    const res = await (await import('@tauri-apps/plugin-http')).fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${desktopToken}`,
        },
        timeout: 60,
    } as RequestInit & { timeout?: number })
    if (!res.ok) {
        throw new Error(`Attachment request failed with HTTP ${res.status}`)
    }
    const blob = new Blob([await res.arrayBuffer()], {
        type: res.headers.get('content-type') || options?.fallbackMimeType || 'application/octet-stream',
    })
    return URL.createObjectURL(blob)
}

export const attachmentApi = {
    uploadFiles: (files: File[], token: AuthToken) => {
        const form = new FormData()
        for (const file of files) form.append('files', file, file.name)
        return apiMultipartFetch<UploadedAttachment[]>('/api/attachments/upload', form, token)
    },
}
