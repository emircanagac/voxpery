export function formatAppVersionBadge(rawVersion: string | null | undefined): string | null {
  const version = rawVersion?.trim()
  if (!version) return null

  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return `v${version}`
  }

  return version
}
