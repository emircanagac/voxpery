export default function GlobalLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="connection-gate">
      <div className="connection-gate-card">
        {/* Fox logo */}
        <div className="connection-gate-logo">
          <img src="/1024.png" alt="Voxpery" width={72} height={72} />
        </div>

        {/* Spinner */}
        <div className="connection-gate-spinner" />

        <h2 className="connection-gate-title">{label}</h2>
      </div>
    </div>
  )
}
