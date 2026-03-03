import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: 24,
            background: 'var(--bg-primary, #1a1f35)',
            color: 'var(--text-primary, #e8ecf4)',
            textAlign: 'center',
          }}
        >
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ marginBottom: 16, opacity: 0.8, maxWidth: 400 }}>
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="btn btn-primary"
            style={{ padding: '10px 20px' }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
