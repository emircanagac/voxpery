import { RefreshCw } from 'lucide-react'
import { useFeatureStore } from '../stores/features'

interface AuthIntegrationStatusProps {
  loadingMessage?: string
  errorMessage?: string
}

export default function AuthIntegrationStatus({
  loadingMessage = 'Checking additional sign-in options...',
  errorMessage = 'Additional sign-in options could not be loaded.',
}: AuthIntegrationStatusProps) {
  const features = useFeatureStore((state) => state.features)
  const loading = useFeatureStore((state) => state.loading)
  const error = useFeatureStore((state) => state.error)
  const loadFeatures = useFeatureStore((state) => state.loadFeatures)

  if (features) return null

  return (
    <div
      className={`auth-integration-status${error ? ' is-error' : ''}`}
      role={error ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span>{error ? errorMessage : loadingMessage}</span>
      {error && (
        <button type="button" onClick={() => void loadFeatures()} disabled={loading}>
          <RefreshCw size={13} aria-hidden />
          Retry
        </button>
      )}
    </div>
  )
}
