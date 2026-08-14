export const REMOTE_PLAYBACK_VOLUME_STORAGE_KEY = 'voxpery-voice-peer-volume'
export const REMOTE_PLAYBACK_VOLUME_CHANGED_EVENT = 'voxpery-voice-peer-volume-changed'
export const DEFAULT_REMOTE_PLAYBACK_VOLUME = 100
export const MAX_REMOTE_PLAYBACK_VOLUME = 100

export function normalizeRemotePlaybackVolume(
  value: unknown,
  fallback = DEFAULT_REMOTE_PLAYBACK_VOLUME,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_REMOTE_PLAYBACK_VOLUME, Math.max(0, Math.round(value)))
}

export function parseRemotePlaybackVolumes(raw: string | null): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const volumes: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      volumes[key] = normalizeRemotePlaybackVolume(value)
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
    Object.entries(volumes).map(([key, value]) => [key, normalizeRemotePlaybackVolume(value)]),
  )
  storage.setItem(REMOTE_PLAYBACK_VOLUME_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}
