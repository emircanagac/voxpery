const MEMBER_PANEL_OPEN_KEY = 'voxpery-member-panel-open-v1'

/** The desktop member panel is open until the user hides it. */
export function getMemberPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(MEMBER_PANEL_OPEN_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setMemberPanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(MEMBER_PANEL_OPEN_KEY, open ? 'true' : 'false')
  } catch {
    // Keep the current panel state even if device preferences cannot be stored.
  }
}
