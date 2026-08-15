export const REMOTE_PLAYBACK_VOLUME_STORAGE_KEY = 'voxpery-voice-peer-volume'
export const REMOTE_SCREEN_PREVIOUS_VOLUME_STORAGE_KEY = 'voxpery-screen-peer-previous-volume'
export const REMOTE_PLAYBACK_VOLUME_CHANGED_EVENT = 'voxpery-voice-peer-volume-changed'
export const DEFAULT_REMOTE_PLAYBACK_VOLUME = 100
export const MAX_REMOTE_VOICE_PLAYBACK_VOLUME = 200
export const MAX_REMOTE_SCREEN_PLAYBACK_VOLUME = 100

export type RemotePlaybackVolumeKind = 'voice' | 'screen'

export function remotePlaybackVolumeKey(kind: RemotePlaybackVolumeKind, userId: string): string {
  return `${kind}:${userId}`
}

export function normalizeRemotePlaybackVolume(
  value: unknown,
  fallback = DEFAULT_REMOTE_PLAYBACK_VOLUME,
  maximum = MAX_REMOTE_SCREEN_PLAYBACK_VOLUME,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(0, Math.round(value)))
}

export function normalizeRemoteVoicePlaybackVolume(
  value: unknown,
  fallback = DEFAULT_REMOTE_PLAYBACK_VOLUME,
): number {
  return normalizeRemotePlaybackVolume(value, fallback, MAX_REMOTE_VOICE_PLAYBACK_VOLUME)
}

export function normalizeRemoteScreenPlaybackVolume(
  value: unknown,
  fallback = DEFAULT_REMOTE_PLAYBACK_VOLUME,
): number {
  return normalizeRemotePlaybackVolume(value, fallback, MAX_REMOTE_SCREEN_PLAYBACK_VOLUME)
}

function normalizeStoredVolume(key: string, value: number): [string, number] {
  if (key.startsWith('screen:')) return [key, normalizeRemoteScreenPlaybackVolume(value)]
  if (key.startsWith('voice:')) return [key, normalizeRemoteVoicePlaybackVolume(value)]
  return [remotePlaybackVolumeKey('voice', key), normalizeRemoteVoicePlaybackVolume(value)]
}

export function parseRemotePlaybackVolumes(raw: string | null): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const volumes: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const [normalizedKey, normalizedValue] = normalizeStoredVolume(key, value)
      volumes[normalizedKey] = normalizedValue
    }
    return volumes
  } catch {
    return {}
  }
}

export function readRemotePlaybackVolumes(storage: Storage = localStorage): Record<string, number> {
  const raw = storage.getItem(REMOTE_PLAYBACK_VOLUME_STORAGE_KEY)
  const volumes = parseRemotePlaybackVolumes(raw)
  if (raw && raw !== JSON.stringify(volumes)) {
    storage.setItem(REMOTE_PLAYBACK_VOLUME_STORAGE_KEY, JSON.stringify(volumes))
  }
  return volumes
}

export function writeRemotePlaybackVolumes(
  volumes: Record<string, number>,
  storage: Storage = localStorage,
): Record<string, number> {
  const normalized = Object.fromEntries(
    Object.entries(volumes).map(([key, value]) => normalizeStoredVolume(key, value)),
  )
  storage.setItem(REMOTE_PLAYBACK_VOLUME_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function getRemotePlaybackVolume(
  volumes: Record<string, number>,
  kind: RemotePlaybackVolumeKind,
  userId: string,
): number {
  const value = volumes[remotePlaybackVolumeKey(kind, userId)]
  return kind === 'voice'
    ? normalizeRemoteVoicePlaybackVolume(value)
    : normalizeRemoteScreenPlaybackVolume(value)
}

function parsePreviousScreenVolumes(raw: string | null): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).flatMap(([userId, value]) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return []
      const normalized = normalizeRemoteScreenPlaybackVolume(value)
      return normalized > 0 ? [[userId, normalized]] : []
    }))
  } catch {
    return {}
  }
}

export function readPreviousScreenPlaybackVolume(
  userId: string,
  storage: Storage = localStorage,
): number {
  const volumes = parsePreviousScreenVolumes(storage.getItem(REMOTE_SCREEN_PREVIOUS_VOLUME_STORAGE_KEY))
  const saved = volumes[userId]
  if (saved !== undefined) return saved

  const legacyKey = `${remotePlaybackVolumeKey('screen', userId)}_prev`
  const legacyValue = Number(storage.getItem(legacyKey))
  storage.removeItem(legacyKey)
  if (!Number.isFinite(legacyValue) || legacyValue <= 0) return DEFAULT_REMOTE_PLAYBACK_VOLUME

  const normalized = normalizeRemoteScreenPlaybackVolume(legacyValue)
  writePreviousScreenPlaybackVolume(userId, normalized, storage)
  return normalized
}

export function writePreviousScreenPlaybackVolume(
  userId: string,
  volume: number,
  storage: Storage = localStorage,
): number {
  const normalized = normalizeRemoteScreenPlaybackVolume(volume)
  if (normalized <= 0) return DEFAULT_REMOTE_PLAYBACK_VOLUME
  const volumes = parsePreviousScreenVolumes(storage.getItem(REMOTE_SCREEN_PREVIOUS_VOLUME_STORAGE_KEY))
  volumes[userId] = normalized
  storage.setItem(REMOTE_SCREEN_PREVIOUS_VOLUME_STORAGE_KEY, JSON.stringify(volumes))
  return normalized
}
