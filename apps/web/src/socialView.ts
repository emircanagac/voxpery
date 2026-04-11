export type SocialView = 'friends' | 'dm' | 'saved'

const SOCIAL_VIEW_KEY = 'voxpery-social-view'

export function getPersistedSocialView(): SocialView | null {
  try {
    const v = sessionStorage.getItem(SOCIAL_VIEW_KEY)
    if (v === 'friends' || v === 'dm' || v === 'saved') return v
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
