interface GlobalLoadingProps {
  label?: string
  /** Optional subtitle (e.g. same as ConnectionGate for a single loading experience). */
  description?: string
}

export default function GlobalLoading({ label = 'Loading…', description }: GlobalLoadingProps) {
  return (
    <div className="connection-gate">
      <div className="connection-gate-card">
        <div className="connection-gate-logo">
          <img src="/1024.png" alt="Voxpery" width={72} height={72} />
        </div>
        <div className="connection-gate-spinner" />
        <h2 className="connection-gate-title">{label}</h2>
        {description && <p className="connection-gate-desc">{description}</p>}
      </div>
    </div>
  )
}
