
/** Client-side checks for username and email edits (UX only; the server validates). */
export function hasOnlyUsernameChars(value: string) {
  if (value.length === 0) return false
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    const code = value.charCodeAt(i)
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    const isDigit = code >= 48 && code <= 57
    if (!isLetter && !isDigit && ch !== '_' && ch !== '.') return false
  }
  return true
}

export function hasUsernameBoundarySeparator(value: string) {
  return value.startsWith('_') || value.startsWith('.') || value.endsWith('_') || value.endsWith('.')
}

export function hasUsernameConsecutiveSeparator(value: string) {
  for (let i = 1; i < value.length; i += 1) {
    const prev = value[i - 1]
    const curr = value[i]
    if ((prev === '_' || prev === '.') && (curr === '_' || curr === '.')) return true
  }
  return false
}

export function isValidUsername(value: string) {
  if (value.length < 3 || !hasOnlyUsernameChars(value)) return false
  if (hasUsernameBoundarySeparator(value)) return false
  return !hasUsernameConsecutiveSeparator(value)
}

export function isValidEmailAddress(value: string) {
  const trimmed = value.trim()
  const atIndex = trimmed.indexOf('@')
  return trimmed.length <= 255 && atIndex > 0 && atIndex < trimmed.length - 1
}
