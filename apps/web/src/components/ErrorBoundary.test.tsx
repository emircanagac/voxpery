import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary'

const ThrowError = () => {
  throw new Error('Test error')
}

const WorkingComponent = () => {
  return <div>Working component</div>
}

describe('ErrorBoundary', () => {
  it('should render children when no error', () => {
    render(
      <ErrorBoundary>
        <WorkingComponent />
      </ErrorBoundary>
    )

    expect(screen.getByText('Working component')).toBeInTheDocument()
  })

  it('should display error UI when child throws', () => {
    // Suppress console.error for this test
    const consoleError = console.error
    console.error = () => {}

    render(
      <BrowserRouter>
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      </BrowserRouter>
    )

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
    expect(screen.getByText(/Test error/i)).toBeInTheDocument()

    // Restore console.error
    console.error = consoleError
  })
})
