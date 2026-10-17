import { useRef, type HTMLAttributes, type FormEventHandler, type KeyboardEvent, type RefObject } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'

type Props = Omit<HTMLAttributes<HTMLElement>, 'onSubmit'> & {
  as?: 'div' | 'form'
  name: string
  onSubmit?: FormEventHandler<HTMLFormElement>
  /** Called when Escape is pressed inside the dialog. */
  onEscape?: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

export default function ModalSurface({ as = 'div', name, onSubmit, onEscape, onKeyDown, returnFocusRef, ...props }: Props) {
  const ref = useRef<HTMLFormElement & HTMLDivElement>(null)
  useDialogFocus(ref, true, undefined, returnFocusRef)
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event)
    if (onEscape && event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      event.stopPropagation()
      onEscape()
    }
  }
  const dialogProps = { ...props, ref, role: 'dialog', 'aria-modal': true as const, 'aria-label': name, tabIndex: -1, onKeyDown: handleKeyDown }
  return as === 'form'
    ? <form {...dialogProps} onSubmit={onSubmit} />
    : <div {...dialogProps} />
}
