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
  const isCssVar = typeof iconSize === 'string' && iconSize.startsWith('var(')
  const wrapperStyle = isCssVar ? { width: iconSize, height: iconSize, display: 'inline-flex' as const, alignItems: 'center', justifyContent: 'center' } : undefined

  const iconEl = <Icon size={isCssVar ? '100%' : iconSize} strokeWidth={2.5} style={isCssVar ? { width: '100%', height: '100%' } : undefined} />

  if (variant === 'inline') {
    return (
      <span
        className={`status-icon status-icon-inline status-icon-${status} ${className}`.trim()}
        aria-hidden={ariaHidden}
        style={wrapperStyle}
      >
        {iconEl}
      </span>
    )
  }

  return (
    <span
      className={`status-icon status-icon-badge status-icon-${status} ${className}`.trim()}
      aria-hidden={ariaHidden}
      style={wrapperStyle}
    >
      {iconEl}
    </span>
  )
}
