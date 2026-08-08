import { Check, RotateCcw } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import {
  getStoredThemePreference,
  getThemeOption,
  normalizeHexColor,
  setThemePreference,
  THEME_OPTIONS,
  type ThemeId,
  type ThemePreference,
} from '../theme'

const ACCENT_SWATCHES = ['#4f7fd8', '#6078d4', '#c9578f', '#2d8f70', '#c56b22', '#7657cf'] as const

export default function ThemeSettings() {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredThemePreference())
  const activeTheme = getThemeOption(preference.theme)
  const [accentDraft, setAccentDraft] = useState(preference.customAccent ?? activeTheme.defaultAccent)
  const [accentError, setAccentError] = useState<string | null>(null)

  const savePreference = (next: ThemePreference) => {
    const saved = setThemePreference(next)
    setPreference(saved)
    return saved
  }

  const selectTheme = (theme: ThemeId) => {
    const saved = savePreference({ ...preference, theme })
    if (!saved.customAccent) setAccentDraft(getThemeOption(theme).defaultAccent)
  }

  const selectAccent = (accent: string) => {
    const normalized = normalizeHexColor(accent)
    if (!normalized) {
      setAccentError('Enter a six-digit hex color such as #4f7fd8.')
      return
    }
    setAccentError(null)
    setAccentDraft(normalized)
    savePreference({ ...preference, customAccent: normalized })
  }

  const resetAccent = () => {
    setAccentError(null)
    setAccentDraft(activeTheme.defaultAccent)
    savePreference({ ...preference, customAccent: null })
  }

  return (
    <section className="user-settings-section theme-settings" aria-labelledby="appearance-settings-title">
      <h3 className="user-settings-section-title" id="appearance-settings-title">Appearance</h3>
      <div className="theme-settings-copy">
        <strong>Theme</strong>
        <span>Choose a palette for Voxpery on this device.</span>
      </div>
      <div className="theme-option-grid" role="group" aria-label="Theme">
        {THEME_OPTIONS.map((option) => {
          const selected = preference.theme === option.id
          return (
            <button
              key={option.id}
              type="button"
              className={`theme-option ${selected ? 'is-selected' : ''}`}
              onClick={() => selectTheme(option.id)}
              aria-pressed={selected}
            >
              <span
                className="theme-option-preview"
                style={{
                  '--theme-preview-bg': option.backgroundColor,
                  '--theme-preview-surface': option.surfaceColor,
                  '--theme-preview-accent': preference.customAccent ?? option.defaultAccent,
                  '--theme-preview-text': option.textColor,
                } as CSSProperties}
                aria-hidden
              >
                <span className="theme-option-preview-sidebar" />
                <span className="theme-option-preview-content">
                  <span />
                  <span />
                </span>
              </span>
              <span className="theme-option-meta">
                <span className="theme-option-label">
                  {option.label}
                  {selected && <Check size={14} aria-hidden />}
                </span>
                <span className="theme-option-description">{option.description}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="theme-settings-divider" />

      <div className="theme-settings-copy">
        <strong>Accent color</strong>
        <span>Use a preset or enter any hex color. Button text adjusts for contrast automatically.</span>
      </div>
      <div className="theme-accent-controls">
        <div className="theme-accent-swatches" role="group" aria-label="Accent presets">
          {ACCENT_SWATCHES.map((accent) => {
            const selected = preference.customAccent === accent
            return (
              <button
                key={accent}
                type="button"
                className={`theme-accent-swatch ${selected ? 'is-selected' : ''}`}
                style={{ '--theme-swatch': accent } as CSSProperties}
                onClick={() => selectAccent(accent)}
                aria-label={`Use ${accent} accent`}
                aria-pressed={selected}
              >
                {selected && <Check size={13} aria-hidden />}
              </button>
            )
          })}
        </div>
        <div className="theme-accent-custom">
          <label className="theme-color-picker" title="Choose accent color">
            <input
              type="color"
              value={normalizeHexColor(accentDraft) ?? activeTheme.defaultAccent}
              onChange={(event) => selectAccent(event.target.value)}
              aria-label="Choose custom accent color"
            />
          </label>
          <input
            className={`theme-accent-input ${accentError ? 'is-invalid' : ''}`}
            value={accentDraft}
            onChange={(event) => setAccentDraft(event.target.value)}
            onBlur={() => selectAccent(accentDraft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                selectAccent(accentDraft)
              }
            }}
            aria-label="Custom accent hex color"
            aria-invalid={Boolean(accentError)}
            spellCheck={false}
            maxLength={7}
          />
          <button
            type="button"
            className="theme-accent-reset"
            onClick={resetAccent}
            disabled={!preference.customAccent}
            title="Use theme accent"
            aria-label="Use theme accent"
          >
            <RotateCcw size={15} aria-hidden />
          </button>
        </div>
      </div>
      {accentError && <div className="theme-accent-error" role="alert">{accentError}</div>}
    </section>
  )
}
