export const DEFAULT_BADGE_COUNT_MAX = 19

export function formatBadgeCount(count: number, max = DEFAULT_BADGE_COUNT_MAX): string {
  const safeMax = Number.isFinite(max) ? Math.max(1, Math.trunc(max)) : DEFAULT_BADGE_COUNT_MAX
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  if (safeCount <= safeMax) return String(safeCount)
  return `${safeMax}+`
}

// Backward-compatible alias for older imports.
export const formatUnreadBadgeCount = formatBadgeCount
