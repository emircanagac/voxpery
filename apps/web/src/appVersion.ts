export function formatAppVersionBadge(rawVersion: string | null | undefined): string | null {
  const version = rawVersion?.trim()
  if (!version) return null

  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return `v${version}`
  }

  const shortSha = version.match(/^sha-([0-9a-f]{7})[0-9a-f]+$/i)
  if (shortSha?.[1]) {
    return `sha-${shortSha[1]}`
  }

  return version
}
