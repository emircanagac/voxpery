import { clearAttachmentCaches } from './components/chatAttachmentCache'

export const LAST_CHANNELS_STORAGE_KEY = 'voxpery-last-channel-ids'
export const ACTIVE_SERVER_STORAGE_KEY = 'voxpery-active-server-id'
const DRAFT_MENTION_STORAGE_KEY = 'voxpery-draft-mention'

/** Forgets what the signed-out account left in this tab, so the next one cannot see it. */
export function clearLocalSessionData() {
  clearAttachmentCaches()
  try {
    sessionStorage.removeItem(LAST_CHANNELS_STORAGE_KEY)
    sessionStorage.removeItem(ACTIVE_SERVER_STORAGE_KEY)
    sessionStorage.removeItem(DRAFT_MENTION_STORAGE_KEY)
  } catch { /* Storage may be unavailable; there is then nothing to clear. */ }
}
