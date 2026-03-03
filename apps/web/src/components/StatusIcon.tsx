import { Circle, Star, BellOff, Ghost } from 'lucide-react'

export type StatusValue = 'online' | 'idle' | 'dnd' | 'offline'

const STATUS_ICONS = {
  online: Circle,
  idle: Star,
  dnd: BellOff,
  offline: Ghost,
} as const

interface StatusIconProps {
  status: StatusValue
  /** 'badge' = on avatar corner with circle bg; 'inline' = icon only next to text */
  variant: 'badge' | 'inline'
  /** Icon size in px (or CSS value). Defaults to CSS vars in index.css */
  size?: number | string
  className?: string
  ariaHidden?: boolean
}

export function StatusIcon({ status, variant, size, className = '', ariaHidden = true }: StatusIconProps) {
  const Icon = STATUS_ICONS[status]
  const iconSize = size ?? (variant === 'badge' ? 'var(--status-badge-icon-size)' : 'var(--status-inline-icon-size)')

  if (variant === 'inline') {
    return (
      <span
        className={`status-icon status-icon-inline status-icon-${status} ${className}`.trim()}
        aria-hidden={ariaHidden}
      >
        <Icon size={iconSize} strokeWidth={2.5} />
      </span>
    )
  }

  return (
    <span
      className={`status-icon status-icon-badge status-icon-${status} ${className}`.trim()}
      aria-hidden={ariaHidden}
    >
      <Icon size={iconSize} strokeWidth={2.5} />
    </span>
  )
}
