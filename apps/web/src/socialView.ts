export type SocialView = 'friends' | 'dm'

const SOCIAL_VIEW_KEY = 'voxpery-social-view'

export function getPersistedSocialView(): SocialView | null {
  try {
    const v = sessionStorage.getItem(SOCIAL_VIEW_KEY)
    if (v === 'friends' || v === 'dm') return v
    return null
  } catch {
    return null
  }
}

export function setPersistedSocialView(view: SocialView): void {
  try {
    sessionStorage.setItem(SOCIAL_VIEW_KEY, view)
  } catch {
    // ignore
  }
}

export function isSocialDmViewVisible(pathname: string): boolean {
  return pathname === '/' && getPersistedSocialView() === 'dm'
}
