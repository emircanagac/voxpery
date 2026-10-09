import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ImagePlus } from 'lucide-react'
import {
  AVATAR_CROP_PREVIEW_SIZE,
  getAvatarCropGeometry,
  renderAvatarCrop,
  type AvatarCropOffset,
} from './avatarCrop'

type ProfileAvatarEditorProps = {
  file: File
  onChooseAnother: () => void
  onCancel: () => void
  onSave: (dataUrl: string) => Promise<boolean>
}

export default function ProfileAvatarEditor({ file, onChooseAnother, onCancel, onSave }: ProfileAvatarEditorProps) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [previewSize, setPreviewSize] = useState(AVATAR_CROP_PREVIEW_SIZE)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<AvatarCropOffset>({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => setPreviewSize(entry.contentRect.width))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const handleWheel = (event: WheelEvent) => {
      if (!dimensions.width || !dimensions.height || saving || !event.deltaY) return
      event.preventDefault()
      const nextZoom = Math.max(1, Math.min(3, Math.round((zoom - Math.sign(event.deltaY) * 0.1) * 20) / 20))
      setZoom(nextZoom)
      setOffset((current) => getAvatarCropGeometry(
        dimensions.width, dimensions.height, nextZoom, current, previewSize,
      ).offset)
    }
    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [dimensions, previewSize, saving, zoom])

  const geometry = dimensions.width && dimensions.height
    ? getAvatarCropGeometry(dimensions.width, dimensions.height, zoom, offset, previewSize)
    : null

  const move = (x: number, y: number) => {
    setOffset((current) => getAvatarCropGeometry(dimensions.width, dimensions.height, zoom,
      { x: current.x + x, y: current.y + y }, previewSize).offset)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!geometry || (event.pointerType === 'mouse' && event.button !== 0)) return
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    move(event.clientX - drag.x, event.clientY - drag.y)
    drag.x = event.clientX
    drag.y = event.clientY
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const amount = event.shiftKey ? 24 : 8
    const delta = { ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount] }[event.key]
    if (!delta || !geometry) return
    event.preventDefault()
    move(delta[0], delta[1])
  }

  const save = async () => {
    if (!imageRef.current || !geometry || saving) return
    setSaving(true)
    setError(null)
    try {
      const dataUrl = renderAvatarCrop(imageRef.current, zoom, offset, previewSize, file.type)
      if (!await onSave(dataUrl)) setError('Photo was not saved. Try again.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not edit this photo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="profile-avatar-editor">
      <div className="profile-avatar-editor__stage" ref={stageRef} tabIndex={0} role="group"
        aria-label="Move photo crop with arrow keys" onKeyDown={onKeyDown}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}>
        {sourceUrl && <img ref={imageRef} src={sourceUrl} alt="" draggable={false}
          onLoad={(event) => {
            setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
            stageRef.current?.focus()
          }}
          onError={() => setError('Could not load this image')}
          style={geometry ? {
            width: geometry.displayWidth,
            height: geometry.displayHeight,
            left: geometry.left,
            top: geometry.top,
          } : { visibility: 'hidden' }} />}
      </div>
      <div className="profile-avatar-editor__controls">
        <label htmlFor="profile-avatar-zoom">Zoom</label>
        <input id="profile-avatar-zoom" type="range" min="1" max="3" step="0.05" value={zoom}
          onChange={(event) => {
            const nextZoom = Number(event.target.value)
            setZoom(nextZoom)
            if (dimensions.width && dimensions.height) {
              setOffset((current) => getAvatarCropGeometry(dimensions.width, dimensions.height, nextZoom, current, previewSize).offset)
            }
          }} disabled={saving || !geometry} />
      </div>
      {file.type === 'image/gif' && <p className="profile-avatar-editor__note">Animated GIFs are saved as a still image.</p>}
      {error && <p className="profile-avatar-editor__error" role="alert">{error}</p>}
      <div className="profile-avatar-editor__actions">
        <button type="button" className="user-toggle" onClick={onChooseAnother} disabled={saving}>
          <ImagePlus size={15} aria-hidden="true" /> Choose another
        </button>
        <button type="button" className="user-toggle" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="user-toggle user-profile-save-button" onClick={() => void save()}
          disabled={!geometry || saving} aria-busy={saving}>
          {saving ? 'Saving...' : 'Save photo'}
        </button>
      </div>
    </div>
  )
}
