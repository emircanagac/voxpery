import { useRef, type HTMLAttributes, type FormEventHandler, type RefObject } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'

type Props = Omit<HTMLAttributes<HTMLElement>, 'onSubmit'> & {
  as?: 'div' | 'form'
  name: string
  onSubmit?: FormEventHandler<HTMLFormElement>
  returnFocusRef?: RefObject<HTMLElement | null>
}

export default function ModalSurface({ as = 'div', name, onSubmit, returnFocusRef, ...props }: Props) {
  const ref = useRef<HTMLFormElement & HTMLDivElement>(null)
  useDialogFocus(ref, true, undefined, returnFocusRef)
  const dialogProps = { ...props, ref, role: 'dialog', 'aria-modal': true as const, 'aria-label': name, tabIndex: -1 }
  return as === 'form'
    ? <form {...dialogProps} onSubmit={onSubmit} />
    : <div {...dialogProps} />
}
