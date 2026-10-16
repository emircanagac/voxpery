import { apiFetch } from './client'
import { setImageProxyGrant } from './imageProxyGrant'

/**
 * Fetches a fresh image proxy grant for the current sign-in. A grant belongs to one token
 * version, so call this after anything that changes it while the app stays open.
 */
export async function refreshImageProxyGrant(token: string | null | undefined): Promise<void> {
  const { grant } = await apiFetch<{ grant: string }>('/api/images/grant', { token: token ?? undefined })
  setImageProxyGrant(grant)
}
