/**
 * Single source of truth for Sensitivity threshold (0–100 slider).
 * Used by: speaking indicator (VAD), noise gate (send chain), and settings UI.
 * Lower slider = more sensitive (quieter sounds pass / are sent).
 */

export const SENSITIVITY_THRESHOLD_KEY = 'voxpery-settings-speaking-threshold'
export const SPEAKING_PRESET_KEY = 'voxpery-settings-speaking-preset'

export type SpeakingPreset = 'normal' | 'noisy' | 'custom'
export const DEFAULT_SPEAKING_PRESET: Exclude<SpeakingPreset, 'custom'> = 'normal'

/** Default slider value when not set (matches "Balanced" preset). */
export const DEFAULT_SENSITIVITY_SLIDER = 42

/** Sensitivity threshold (0–100) per preset. Lower = more sensitive (quieter sounds pass / sent). */
export function thresholdByPreset(preset: Exclude<SpeakingPreset, 'custom'>): number {
  if (preset === 'noisy') return 54   // −46dB
  return 42                           // −58dB (balanced default)
}

export function getStoredSpeakingPreset(): SpeakingPreset {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SPEAKING_PRESET_KEY) : null
  if (raw === 'quiet') return 'normal'
  if (raw === 'normal' || raw === 'noisy' || raw === 'custom') return raw
  return DEFAULT_SPEAKING_PRESET
}

/** Slider 0 → ~0.00001 (-100dB), slider 100 → 1.0 (0dB). */
export function onThresholdFromSlider(slider: number): number {
  const s = Math.min(100, Math.max(0, Number(slider)))
  // Linear in dB so each slider step maps to a stable 1dB step (-100..0).
  const db = -100 + s
  return Math.pow(10, db / 20)
}

/** Off-threshold for hysteresis: only treat as "quiet" when level is well below on-threshold. */
export function offThresholdFromOn(onThr: number): number {
  return Math.max(0.000001, onThr * 0.14)
}

/** Read slider from storage (0–100), default DEFAULT_SENSITIVITY_SLIDER. */
export function getSliderFromStorage(): number {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SENSITIVITY_THRESHOLD_KEY) : null
  if (raw != null && raw.trim().length > 0) {
    return Math.min(100, Math.max(0, Number(raw) || DEFAULT_SENSITIVITY_SLIDER))
  }
  const preset = getStoredSpeakingPreset()
  if (preset === 'custom') return DEFAULT_SENSITIVITY_SLIDER
  return thresholdByPreset(preset)
}

/** Current on/off thresholds from storage. Use in VAD and noise gate. */
export function getThresholdsFromStorage(): { onThr: number; offThr: number } {
  const slider = getSliderFromStorage()
  const onThr = onThresholdFromSlider(slider)
  const offThr = offThresholdFromOn(onThr)
  return { onThr, offThr }
}
