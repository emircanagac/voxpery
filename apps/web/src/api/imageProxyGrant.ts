// The image proxy serves only server-signed addresses. Signed-in clients get a grant from the
// session snapshot and refresh it while the app stays open. Kept apart from the URL helpers so
// the startup bundle carries only this state.
let imageProxyGrant: string | null = null

export function setImageProxyGrant(grant: string | null | undefined) {
  imageProxyGrant = grant || null
}

export function getImageProxyGrant(): string | null {
  return imageProxyGrant
}
