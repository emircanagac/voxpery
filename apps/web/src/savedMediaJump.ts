const SAVED_MEDIA_JUMP_KEY = 'voxpery-saved-media-jump'

export type PendingSavedMediaJump =
  | {
      source: 'dm'
      channelId: string
      messageId: string
    }
  | {
      source: 'server'
      channelId: string
      messageId: string
    }

export function getPendingSavedMediaJump(): PendingSavedMediaJump | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SAVED_MEDIA_JUMP_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingSavedMediaJump
    if (!parsed || typeof parsed !== 'object') return null
    if ((parsed.source !== 'dm' && parsed.source !== 'server') || !parsed.channelId || !parsed.messageId) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function setPendingSavedMediaJump(jump: PendingSavedMediaJump) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(SAVED_MEDIA_JUMP_KEY, JSON.stringify(jump))
  } catch {
    // ignore
  }
}

export function clearPendingSavedMediaJump() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(SAVED_MEDIA_JUMP_KEY)
  } catch {
    // ignore
  }
}
