/**
 * Single source of truth for Sensitivity threshold (0–100 slider).
 * Used by: speaking indicator (VAD), noise gate (send chain), and settings UI.
 * Lower slider = more sensitive (quieter sounds pass / are sent).
 */

export const SENSITIVITY_THRESHOLD_KEY = 'voxpery-settings-speaking-threshold'

/** Default slider value when not set (matches "Normal" preset). */
export const DEFAULT_SENSITIVITY_SLIDER = 25

/** Slider 0 → ~0.001 (-60dB), slider 100 → ~0.561 (-5dB). Exponential curve for natural feel. */
export function onThresholdFromSlider(slider: number): number {
  const s = Math.min(100, Math.max(0, Number(slider)))
  // Noise filtering keeps only clear voice. We use an exponential curve so sliders 10, 30, 60
  // map to functional volume thresholds rather than sitting at 2, 7, 15.
  // Formula: 0.001 + ( (slider/100)^2 * 0.56 )
  // At slider=100 → onThr ≈ 0.561 (-5dB), covering the full usable dB range.
  const normalized = s / 100
  return 0.001 + (normalized * normalized * 0.56)
}

/** Off-threshold for hysteresis: only treat as "quiet" when level is well below on-threshold. */
export function offThresholdFromOn(onThr: number): number {
  return Math.max(0.001, onThr * 0.1)
}

/** Read slider from storage (0–100), default DEFAULT_SENSITIVITY_SLIDER. */
export function getSliderFromStorage(): number {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SENSITIVITY_THRESHOLD_KEY) : null
  return Math.min(100, Math.max(0, Number(raw) || DEFAULT_SENSITIVITY_SLIDER))
}

/** Current on/off thresholds from storage. Use in VAD and noise gate. */
export function getThresholdsFromStorage(): { onThr: number; offThr: number } {
  const slider = getSliderFromStorage()
  const onThr = onThresholdFromSlider(slider)
  const offThr = offThresholdFromOn(onThr)
  return { onThr, offThr }
}
