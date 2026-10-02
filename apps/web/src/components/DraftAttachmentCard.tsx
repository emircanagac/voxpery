import { useEffect, useState } from 'react'
import { Check, CircleAlert, FileArchive, FileText, Image, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { resolveAttachmentUrl } from '../api'
import type { DraftAttachmentItem } from '../draftAttachments'
import { useAuthStore } from '../stores/auth'

type Props = {
  attachment: DraftAttachmentItem
  onRemove: () => void
  onRetry?: () => void
}

const previewTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

function fileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export default function DraftAttachmentCard({ attachment, onRemove, onRetry }: Props) {
  const { file, name, size, type, url, uploadStatus, uploadError } = attachment
  const token = useAuthStore(state => state.token)
  const canPreview = previewTypes.has(type.toLowerCase())
  const [preview, setPreview] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)

  useEffect(() => {
    let active = true
    let ownedUrl: string | null = null
    setPreview(null)
    setPreviewFailed(false)
    if (canPreview) {
      if (file) {
        ownedUrl = URL.createObjectURL(file)
        setPreview(ownedUrl)
      } else if (url) {
        // Uploaded previews use the existing authenticated desktop resolver.
        void resolveAttachmentUrl(url, token ?? null, { fallbackMimeType: type }).then(resolved => {
          if (resolved.startsWith('blob:')) ownedUrl = resolved
          if (active) setPreview(resolved)
          else if (ownedUrl) URL.revokeObjectURL(ownedUrl)
        }).catch(() => { if (active) setPreviewFailed(true) })
      }
    }
    return () => {
      active = false
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    }
  }, [canPreview, file, token, type, url])

  const uploading = uploadStatus === 'uploading'
  const failed = uploadStatus === 'failed'
  const FileIcon = canPreview ? Image : /zip|compressed|archive/i.test(type) ? FileArchive : FileText

  return (
    <div className={`dm-draft-attachment is-${uploadStatus}`} role="group" aria-label={`Attachment ${name}`}>
      <div className="dm-draft-attachment-preview">
        {preview && !previewFailed
          ? <img src={preview} alt={`Preview of ${name}`} draggable={false} onError={() => setPreviewFailed(true)} />
          : <FileIcon size={36} aria-hidden="true" />}
      </div>
      <div className="dm-draft-attachment-controls">
        {failed && onRetry && <button type="button" onClick={onRetry} aria-label={`Retry upload of ${name}`} title="Retry upload"><RotateCcw size={16} aria-hidden="true" /></button>}
        <button type="button" onClick={onRemove} aria-label={`Remove attachment ${name}`} title="Remove attachment"><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="dm-draft-attachment-meta">
        <span className="dm-draft-attachment-name" title={name}>{name}</span>
        <span className="dm-draft-attachment-size">{fileSize(size)}</span>
        <span className="dm-draft-attachment-state" role="status">
          {uploading ? <LoaderCircle size={14} className="dm-draft-attachment-spinner" aria-hidden="true" />
            : failed ? <CircleAlert size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
          {uploading ? 'Uploading...' : failed ? 'Upload failed' : 'Ready to send'}
        </span>
        {failed && <span className="dm-draft-attachment-error">{uploadError || 'Remove this file or retry the upload.'}</span>}
      </div>
      {uploading && <div className="dm-draft-attachment-progress" role="progressbar" aria-label={`Uploading ${name}`}><span /></div>}
    </div>
  )
}
