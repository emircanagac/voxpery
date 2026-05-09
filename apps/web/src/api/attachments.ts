import { isTauri } from '../secureStorage'
import { apiMultipartFetch } from './client'
import type { AuthToken, UploadedAttachment } from './contracts'

export async function resolveAttachmentUrl(url: string, token: string | null): Promise<string> {
    // Desktop attachments are protected by Bearer auth, so <img src="..."> cannot
    // load them directly. Resolve them through the same Tauri HTTP path in both
    // dev and packaged builds, then render the returned blob in-app.
    if (!isTauri() || !token) return url
    const res = await (await import('@tauri-apps/plugin-http')).fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
        timeout: 60,
    } as RequestInit & { timeout?: number })
    if (!res.ok) {
        throw new Error(`Attachment request failed with HTTP ${res.status}`)
    }
    const blob = await res.blob()
    return URL.createObjectURL(blob)
}

export const attachmentApi = {
    uploadFiles: (files: File[], token: AuthToken) => {
        const form = new FormData()
        for (const file of files) form.append('files', file, file.name)
        return apiMultipartFetch<UploadedAttachment[]>('/api/attachments/upload', form, token)
    },
}
