import { Check, RotateCcw } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import {
  createCustomThemePalette,
  DEFAULT_THEME,
  formatHexColorDraft,
  getStoredThemePreference,
  getThemeOption,
  normalizeHexColor,
  setThemePreference,
  THEME_OPTIONS,
  type ThemeId,
  type ThemePreference,
} from '../theme'

const THEME_GRID_OPTIONS = [
  THEME_OPTIONS.find((option) => option.id === 'voxpery')!,
  'custom',
  THEME_OPTIONS.find((option) => option.id === 'dark')!,
  THEME_OPTIONS.find((option) => option.id === 'light')!,
] as const

const ACCENT_SWATCHES = [
  { label: 'Default blue', color: '#4f7fd8' },
  { label: 'Emerald', color: '#2f9b78' },
  { label: 'Rose', color: '#c9578f' },
  { label: 'Amber', color: '#d9771c' },
  { label: 'Violet', color: '#7955c7' },
  { label: 'Coral', color: '#d65f5f' },
] as const

function getHexColorError(value: string): string {
  const draft = formatHexColorDraft(value)
  if (draft === '#') return 'Enter six hex digits after #.'
  if (/^#[0-9a-f]+$/i.test(draft) && draft.length < 7) return 'Hex colors need six digits.'
  if (/^#[0-9a-f]+$/i.test(draft) && draft.length > 7) return 'Hex colors use exactly six digits.'
  return 'Use only the numbers 0-9 and letters A-F.'
}

interface HexColorControlProps {
  draft: string
  error: string | null
  fallbackColor: string
  pickerLabel: string
  inputLabel: string
  onDraftChange: (value: string) => void
  onCommit: (value: string) => void
  onReset?: () => void
  resetDisabled?: boolean
}

function HexColorControl({
  draft,
  error,
  fallbackColor,
  pickerLabel,
  inputLabel,
  onDraftChange,
  onCommit,
  onReset,
  resetDisabled,
}: HexColorControlProps) {
  const limitDraft = (value: string) => formatHexColorDraft(value).slice(0, 7)

  return (
    <div className={`theme-hex-control ${onReset ? 'has-reset' : ''}`}>
      <label className="theme-color-picker" title={pickerLabel}>
        <input
          type="color"
          value={normalizeHexColor(draft) ?? fallbackColor}
          onChange={(event) => onCommit(event.target.value)}
          aria-label={pickerLabel}
        />
      </label>
      <input
        className={`theme-accent-input ${error ? 'is-invalid' : ''}`}
        value={draft}
        maxLength={7}
        onChange={(event) => onDraftChange(limitDraft(event.target.value))}
        onPaste={(event) => {
          event.preventDefault()
          const pasted = limitDraft(event.clipboardData.getData('text'))
          onDraftChange(pasted)
          if (normalizeHexColor(pasted)) onCommit(pasted)
        }}
        onBlur={() => onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onCommit(draft)
          }
        }}
        aria-label={inputLabel}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputLabel.replace(/\s+/g, '-').toLowerCase()}-error` : undefined}
        spellCheck={false}
        autoCapitalize="none"
      />
      {onReset && (
        <button
          type="button"
          className="theme-accent-reset"
          onClick={onReset}
          disabled={resetDisabled}
          title="Use the theme accent"
          aria-label="Reset accent color"
        >
          <RotateCcw size={14} aria-hidden />
        </button>
      )}
    </div>
  )
}

export default function ThemeSettings() {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredThemePreference())
  const activeTheme = getThemeOption(preference.theme)
  const [themeColorDraft, setThemeColorDraft] = useState(preference.customThemeColor ?? activeTheme.defaultAccent)
  const [themeColorError, setThemeColorError] = useState<string | null>(null)
  const customThemePalette = createCustomThemePalette(
    normalizeHexColor(themeColorDraft) ?? activeTheme.defaultAccent,
    'dark',
  )
  const automaticAccent = preference.customThemeColor
    ? customThemePalette.accentColor
    : activeTheme.defaultAccent
  const [accentDraft, setAccentDraft] = useState(preference.customAccent ?? automaticAccent)
  const [accentError, setAccentError] = useState<string | null>(null)
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
      customThemeColor: null,
      customThemeMode: nextTheme.colorScheme,
    })
    setThemeColorError(null)
    setThemeColorDraft(nextTheme.defaultAccent)
    setAccentError(null)
    if (!saved.customAccent) setAccentDraft(nextTheme.defaultAccent)
    return saved
  }

  const selectCustomThemeColor = (color: string) => {
    const normalized = normalizeHexColor(color)
    if (!normalized) {
      setThemeColorError(getHexColorError(color))
      return
    }
    setThemeColorError(null)
    setThemeColorDraft(normalized)
    savePreference({
      ...preference,
      customThemeColor: normalized,
      customThemeMode: 'dark',
    })
  }

  const selectAccent = (color: string) => {
    const normalized = normalizeHexColor(color)
    if (!normalized) {
      setAccentError(getHexColorError(color))
      return
    }
    setAccentError(null)
    setAccentDraft(normalized)
    savePreference({ ...preference, customAccent: normalized })
  }

  const resetAccent = () => {
    setAccentError(null)
    setAccentDraft(automaticAccent)
    savePreference({ ...preference, customAccent: null })
  }

  const resetDefaults = () => {
    const defaultTheme = getThemeOption(DEFAULT_THEME)
    setThemeColorError(null)
    setAccentError(null)
    setThemeColorDraft(defaultTheme.defaultAccent)
    setAccentDraft(defaultTheme.defaultAccent)
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
          <span>Choose how Voxpery looks.</span>
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
        {THEME_GRID_OPTIONS.map((option) => {
          if (option === 'custom') {
            return (
              <button
                key="custom"
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
                </span>
              </button>
            )
          }
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
              </span>
            </button>
          )
        })}
      </div>

      {preference.customThemeColor && <div className="theme-custom-panel is-active" aria-label="Custom theme controls">
        <div className="theme-custom-panel-copy">
          <strong>Custom theme color</strong>
        </div>
        <HexColorControl
          draft={themeColorDraft}
          error={themeColorError}
          fallbackColor={activeTheme.defaultAccent}
          pickerLabel="Choose custom theme color"
          inputLabel="Custom theme hex color"
          onDraftChange={(value) => {
            setThemeColorDraft(value)
            setThemeColorError(null)
          }}
          onCommit={selectCustomThemeColor}
        />
      </div>}
      {themeColorError && <div className="theme-accent-error" id="custom-theme-hex-color-error" role="alert">{themeColorError}</div>}

      <div className="theme-accent-panel" aria-labelledby="theme-accent-title">
        <div className="theme-custom-panel-copy">
          <strong id="theme-accent-title">Accent color</strong>
          <span>Changes buttons, links, and selections.</span>
        </div>
        <div className="theme-accent-controls">
          <div className="theme-accent-swatches" role="group" aria-label="Accent color presets">
            {ACCENT_SWATCHES.map(({ label, color }) => {
              const selected = preference.customAccent === color
              return <button
                key={color}
                type="button"
                className={`theme-accent-swatch ${selected ? 'is-selected' : ''}`}
                style={{ '--accent-swatch-color': color } as CSSProperties}
                onClick={() => selectAccent(color)}
                title={`${label} (${color})`}
                aria-label={`Use ${label} accent`}
                aria-pressed={selected}
              />
            })}
          </div>
          <HexColorControl
            draft={accentDraft}
            error={accentError}
            fallbackColor={automaticAccent}
            pickerLabel="Choose accent color"
            inputLabel="Custom accent hex color"
            onDraftChange={(value) => {
              setAccentDraft(value)
              setAccentError(null)
            }}
            onCommit={selectAccent}
            onReset={resetAccent}
            resetDisabled={!preference.customAccent}
          />
        </div>
        {accentError && <div className="theme-accent-error" id="custom-accent-hex-color-error" role="alert">{accentError}</div>}
      </div>
    </section>
  )
}
