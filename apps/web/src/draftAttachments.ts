import type { UploadedAttachment } from './api'

export type DraftAttachmentItem = {
  localId: string
  id?: string
  name: string
  url: string
  size: number
  type: string
  file?: File
  uploadStatus: 'uploading' | 'uploaded' | 'failed'
  uploadError?: string
}

export function createUploadingDraftAttachments(files: File[]): DraftAttachmentItem[] {
  return files.map((file) => ({
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    url: '',
    size: file.size,
    type: file.type || 'application/octet-stream',
    file,
    uploadStatus: 'uploading',
  }))
}

export function applyUploadedDraftAttachments(
  current: DraftAttachmentItem[],
  localIds: string[],
  uploaded: UploadedAttachment[],
): DraftAttachmentItem[] {
  const uploadsById = new Map(
    localIds.map((localId, index) => [localId, uploaded[index]] as const),
  )

  return current.map((item) => {
    const uploadedItem = uploadsById.get(item.localId)
    if (!uploadedItem) return item
    return {
      ...item,
      id: uploadedItem.id,
      name: uploadedItem.name || item.name || 'attachment',
      url: uploadedItem.url,
      size: typeof uploadedItem.size === 'number' ? uploadedItem.size : item.size,
      type: uploadedItem.type || item.type || 'application/octet-stream',
      file: undefined,
      uploadStatus: 'uploaded',
      uploadError: undefined,
    }
  })
}

export function markDraftAttachmentsFailed(
  current: DraftAttachmentItem[],
  localIds: string[],
  error: string,
): DraftAttachmentItem[] {
  const failedIds = new Set(localIds)
  return current.map((item) =>
    failedIds.has(item.localId)
      ? {
          ...item,
          uploadStatus: 'failed',
          uploadError: error,
        }
      : item,
  )
}

export function setDraftAttachmentUploading(
  current: DraftAttachmentItem[],
  localId: string,
): DraftAttachmentItem[] {
  return current.map((item) =>
    item.localId === localId
      ? {
          ...item,
          uploadStatus: 'uploading',
          uploadError: undefined,
        }
      : item,
  )
}

export function hasPendingDraftAttachments(items: DraftAttachmentItem[]): boolean {
  return items.some((item) => item.uploadStatus !== 'uploaded')
}

export function getUploadedDraftAttachments(items: DraftAttachmentItem[]) {
  return items
    .filter((item) => item.uploadStatus === 'uploaded')
    .map(({ id, name, url, size, type }) => ({ id, name, url, size, type }))
}
