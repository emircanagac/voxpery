(function initializeVoxperyTheme() {
  var themeKey = 'voxpery-settings-theme'
  var accentKey = 'voxpery-settings-theme-accent'
  var themes = {
    voxpery: { scheme: 'dark', chrome: '#16213e' },
    dark: { scheme: 'dark', chrome: '#17191f' },
    rose: { scheme: 'dark', chrome: '#2a1a29' },
    light: { scheme: 'light', chrome: '#ffffff' },
  }
  var root = document.documentElement
  var theme = 'voxpery'
  var accent = null

  try {
    var storedTheme = localStorage.getItem(themeKey)
    if (storedTheme && themes[storedTheme]) theme = storedTheme
    var storedAccent = localStorage.getItem(accentKey)
    if (storedAccent && /^#[0-9a-f]{6}$/i.test(storedAccent)) accent = storedAccent.toLowerCase()
  } catch (_) {
    // Storage can be unavailable in hardened browser contexts.
  }

  root.dataset.theme = theme
  root.style.colorScheme = themes[theme].scheme

  if (accent) {
    var channel = function (offset) { return Number.parseInt(accent.slice(offset, offset + 2), 16) / 255 }
    var linear = function (value) { return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4) }
    var luminance = 0.2126 * linear(channel(1)) + 0.7152 * linear(channel(3)) + 0.0722 * linear(channel(5))
    var darkContrast = (luminance + 0.05) / 0.055
    var lightContrast = 1.05 / (luminance + 0.05)
    root.dataset.customAccent = 'true'
    root.style.setProperty('--user-accent', accent)
    root.style.setProperty('--user-accent-contrast', darkContrast >= lightContrast ? '#101217' : '#ffffff')
  }

  var themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) themeColor.setAttribute('content', themes[theme].chrome)
})()
