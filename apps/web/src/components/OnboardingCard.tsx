import type { ReactNode } from 'react'

/** A short call to action with buttons, shown on empty Home views. */
export default function OnboardingCard({
  title,
  description,
  actions,
  actionsLayout = 'default',
}: {
  title: string
  description: string
  actions: Array<{ label: string; onClick: () => void; variant?: 'primary' | 'secondary'; icon?: ReactNode }>
  actionsLayout?: 'default' | 'equal'
}) {
  return (
    <div className="home-onboarding-card">
      <div className="home-onboarding-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className={`home-onboarding-actions ${actionsLayout === 'equal' ? 'home-onboarding-actions--equal' : ''}`}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`home-onboarding-btn ${action.variant === 'secondary' ? 'home-onboarding-btn--secondary' : ''}`}
            onClick={action.onClick}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
