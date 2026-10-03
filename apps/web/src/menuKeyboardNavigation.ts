import type { KeyboardEvent } from 'react'

export function handleMenuKeyboardNavigation(event: KeyboardEvent<HTMLElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  if (target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return

  const menu = event.currentTarget
  const actions = Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).filter(button => {
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return false
    for (let node: HTMLElement | null = button; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || style.visibility === 'hidden') return false
      if (node === menu) break
    }
    return true
  })
  if (!actions.length) return

  const current = actions.indexOf(target.closest('button') as HTMLButtonElement)
  const index = event.key === 'Home' ? 0
    : event.key === 'End' ? actions.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % actions.length
        : current < 0 ? actions.length - 1 : (current + actions.length - 1) % actions.length
  event.preventDefault()
  event.stopPropagation()
  actions[index].focus()
}
