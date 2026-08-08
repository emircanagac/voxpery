import { Check, RotateCcw } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import {
  createCustomThemePalette,
  DEFAULT_THEME,
  getStoredThemePreference,
  getThemeOption,
  normalizeHexColor,
  setThemePreference,
  THEME_OPTIONS,
  type ThemeId,
  type ThemePreference,
} from '../theme'

const VISIBLE_THEME_OPTIONS = THEME_OPTIONS.filter((option) => option.id !== 'rose')

export default function ThemeSettings() {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredThemePreference())
  const activeTheme = getThemeOption(preference.theme)
  const [themeColorDraft, setThemeColorDraft] = useState(preference.customThemeColor ?? activeTheme.defaultAccent)
  const [themeColorError, setThemeColorError] = useState<string | null>(null)
  const customThemePalette = createCustomThemePalette(
    normalizeHexColor(themeColorDraft) ?? activeTheme.defaultAccent,
    'dark',
  )
  const isDefaultPreference = preference.theme === DEFAULT_THEME
    && !preference.customThemeColor
    && !preference.customAccent

  const savePreference = (next: ThemePreference) => {
    const saved = setThemePreference(next)
    setPreference(saved)
    return saved
  }

  const selectTheme = (theme: ThemeId) => {
    const nextTheme = getThemeOption(theme)
    const saved = savePreference({
      ...preference,
      theme,
      customAccent: null,
      customThemeColor: null,
      customThemeMode: nextTheme.colorScheme,
    })
    setThemeColorError(null)
    setThemeColorDraft(nextTheme.defaultAccent)
    return saved
  }

  const selectCustomThemeColor = (color: string) => {
    const normalized = normalizeHexColor(color)
    if (!normalized) {
      setThemeColorError('Enter a six-digit hex color such as #4f7fd8.')
      return
    }
    setThemeColorError(null)
    setThemeColorDraft(normalized)
    savePreference({
      ...preference,
      customAccent: null,
      customThemeColor: normalized,
      customThemeMode: 'dark',
    })
  }

  const resetDefaults = () => {
    const defaultTheme = getThemeOption(DEFAULT_THEME)
    setThemeColorError(null)
    setThemeColorDraft(defaultTheme.defaultAccent)
    savePreference({
      theme: DEFAULT_THEME,
      customAccent: null,
      customThemeColor: null,
      customThemeMode: defaultTheme.colorScheme,
    })
  }

  return (
    <section className="user-settings-section theme-settings" aria-labelledby="appearance-settings-title">
      <h3 className="user-settings-section-title" id="appearance-settings-title">Appearance</h3>
      <div className="theme-settings-heading">
        <div className="theme-settings-copy">
          <strong>Theme</strong>
          <span>Choose a ready-made look or create one from a color.</span>
        </div>
        <button
          type="button"
          className="theme-reset-defaults"
          onClick={resetDefaults}
          disabled={isDefaultPreference}
        >
          <RotateCcw size={14} aria-hidden />
          Reset defaults
        </button>
      </div>
      <div className="theme-option-grid" role="group" aria-label="Theme">
        {VISIBLE_THEME_OPTIONS.map((option) => {
          const selected = !preference.customThemeColor && preference.theme === option.id
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
                  '--theme-preview-accent': option.defaultAccent,
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
                  {option.id === 'voxpery' ? 'Default' : option.label}
                  {selected && <Check size={14} aria-hidden />}
                </span>
                <span className="theme-option-description">{option.description}</span>
              </span>
            </button>
          )
        })}
        <button
          type="button"
          className={`theme-option ${preference.customThemeColor ? 'is-selected' : ''}`}
          onClick={() => selectCustomThemeColor(themeColorDraft)}
          aria-pressed={Boolean(preference.customThemeColor)}
        >
          <span
            className="theme-option-preview"
            style={{
              '--theme-preview-bg': customThemePalette.backgroundColor,
              '--theme-preview-surface': customThemePalette.surfaceColor,
              '--theme-preview-accent': customThemePalette.accentColor,
              '--theme-preview-text': customThemePalette.textColor,
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
              Custom
              {preference.customThemeColor && <Check size={14} aria-hidden />}
            </span>
            <span className="theme-option-description">Pick one color and Voxpery handles the rest.</span>
          </span>
        </button>
      </div>

      {preference.customThemeColor && <div className="theme-custom-panel is-active" aria-label="Custom theme controls">
        <div className="theme-custom-panel-copy">
          <strong>Choose your color</strong>
          <span>Voxpery automatically creates a readable theme from it.</span>
        </div>
        <div className="theme-accent-custom theme-custom-color-controls">
          <label className="theme-color-picker" title="Choose custom theme color">
            <input
              type="color"
              value={normalizeHexColor(themeColorDraft) ?? activeTheme.defaultAccent}
              onChange={(event) => selectCustomThemeColor(event.target.value)}
              aria-label="Choose custom theme color"
            />
          </label>
          <input
            className={`theme-accent-input ${themeColorError ? 'is-invalid' : ''}`}
            value={themeColorDraft}
            onChange={(event) => setThemeColorDraft(event.target.value)}
            onBlur={() => selectCustomThemeColor(themeColorDraft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                selectCustomThemeColor(themeColorDraft)
              }
            }}
            aria-label="Custom theme hex color"
            aria-invalid={Boolean(themeColorError)}
            spellCheck={false}
            maxLength={7}
          />
        </div>
      </div>}
      {themeColorError && <div className="theme-accent-error" role="alert">{themeColorError}</div>}
    </section>
  )
}
