import { useEffect, type RefObject } from 'react'

type ElementRef = RefObject<HTMLElement | null>
type DialogScope = { root: HTMLElement; owned?: ElementRef }
const scopes: DialogScope[] = []
const backgroundInert = new Map<HTMLElement, string | null>()
const focusableSelector = 'button, a[href], input, select, textarea, [tabindex]'

function roots(scope: DialogScope) {
  return [scope.root, scope.owned?.current].filter((root): root is HTMLElement => !!root?.isConnected)
}

function contains(scope: DialogScope, target: Node | null) {
  return !!target && roots(scope).some(root => root.contains(target))
}

function focusable(scope: DialogScope) {
  return roots(scope).flatMap(root => Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)))
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled')
      && !element.closest('[inert]') && element.getClientRects().length > 0)
}

function focusFirst(scope: DialogScope) {
  ;(focusable(scope)[0] ?? scope.root).focus({ preventScroll: true })
}

function restoreInert() {
  for (const [element, original] of backgroundInert) {
    if (original === null) element.removeAttribute('inert')
    else element.setAttribute('inert', original)
  }
  backgroundInert.clear()
}

// The top dialog owns focus and its portals; nested cleanup must not leave the app inert.
function updateBackground() {
  restoreInert()
  const scope = scopes.at(-1)
  if (!scope) return
  const allowed = roots(scope)
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || allowed.some(root => child.contains(root))) continue
    backgroundInert.set(child, child.getAttribute('inert'))
    child.setAttribute('inert', '')
  }
}

function handleTab(event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.defaultPrevented) return
  const scope = scopes.at(-1)
  if (!scope) return
  const elements = focusable(scope)
  const first = elements[0]
  const last = elements.at(-1)
  const active = document.activeElement
  if (!first || !contains(scope, active) || !elements.includes(active as HTMLElement)
    || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault()
    ;(event.shiftKey ? last ?? scope.root : first ?? scope.root).focus({ preventScroll: true })
  }
}

function handleFocus(event: FocusEvent) {
  const scope = scopes.at(-1)
  if (scope && !contains(scope, event.target as Node | null)) focusFirst(scope)
}

export function useDialogFocus(ref: ElementRef, enabled: boolean, owned?: ElementRef, fallback?: ElementRef) {
  useEffect(() => {
    const root = ref.current
    if (!enabled || !root) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallbackTarget = fallback?.current
    const scope: DialogScope = { root, owned }
    scopes.push(scope)
    updateBackground()
    focusFirst(scope)
    document.addEventListener('keydown', handleTab)
    document.addEventListener('focusin', handleFocus)
    const observer = new MutationObserver(updateBackground)
    observer.observe(document.body, { childList: true })
    return () => {
      observer.disconnect()
      const wasTop = scopes.at(-1) === scope
      scopes.splice(scopes.indexOf(scope), 1)
      updateBackground()
      if (!scopes.length) {
        document.removeEventListener('keydown', handleTab)
        document.removeEventListener('focusin', handleFocus)
      }
      if (!wasTop) return
      const parent = scopes.at(-1)
      if (previousFocus?.isConnected && previousFocus !== document.body && previousFocus.getClientRects().length > 0 && !previousFocus.closest('[inert]')
        && (!parent || contains(parent, previousFocus))) {
        previousFocus.focus({ preventScroll: true })
      } else if (parent) focusFirst(parent)
      else if (fallbackTarget?.isConnected && !fallbackTarget.closest('[inert]')) {
        fallbackTarget.focus({ preventScroll: true })
      }
    }
  }, [enabled, fallback, owned, ref])
}
