import { Circle, BellOff, Ghost } from 'lucide-react'

export type StatusValue = 'online' | 'dnd' | 'offline'

const STATUS_ICONS: Record<StatusValue, typeof Circle> = {
  online: Circle,
  dnd: BellOff,
  offline: Ghost,
}

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
  const iconSize = size ?? (variant === 'badge' ? 'var(--status-badge-size)' : 'var(--status-inline-icon-size)')
  const isCssVar = typeof iconSize === 'string' && iconSize.startsWith('var(')
  const wrapperStyle = isCssVar ? { width: iconSize, height: iconSize, display: 'inline-flex' as const, alignItems: 'center', justifyContent: 'center' } : undefined

  if (variant === 'badge') {
    return (
      <span
        className={`status-icon status-icon-badge status-icon-badge-dot status-icon-badge-dot-${status} ${className}`.trim()}
        aria-hidden={ariaHidden}
        style={wrapperStyle}
      />
    )
  }

  const iconEl = <Icon size={isCssVar ? '100%' : iconSize} strokeWidth={2.5} style={isCssVar ? { width: '100%', height: '100%' } : undefined} />
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
