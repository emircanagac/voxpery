import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { checkHealth } from '../api'

const RETRY_INTERVAL_MS = 5000

interface Props {
    children: ReactNode
}

/**
 * Gate that blocks UI rendering until the backend is reachable.
 * Shows a connection screen with auto-retry while backend is down.
 */
export default function ConnectionGate({ children }: Props) {
    const [status, setStatus] = useState<'checking' | 'connected' | 'offline'>('checking')
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const mountedRef = useRef(true)

    const probe = useCallback(async () => {
        const ok = await checkHealth()
        if (!mountedRef.current) return
        setStatus(ok ? 'connected' : 'offline')
    }, [])

    // Initial check
    useEffect(() => {
        mountedRef.current = true
        probe()
        return () => { mountedRef.current = false }
    }, [probe])

    // Auto-retry when offline
    useEffect(() => {
        if (status === 'connected') {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
            return
        }
        if (timerRef.current) return // already running
        timerRef.current = setInterval(probe, RETRY_INTERVAL_MS)
        return () => {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        }
    }, [status, probe])

    if (status === 'connected') {
        return <>{children}</>
    }

    const isChecking = status === 'checking'

    return (
        <div className="connection-gate">
            <div className="connection-gate-card">
                {/* Fox logo */}
                <div className="connection-gate-logo">
                    <img src="/1024.png" alt="Voxpery" width={72} height={72} />
                </div>

                {/* Spinner */}
                <div className="connection-gate-spinner" />

                <h2 className="connection-gate-title">
                    {isChecking ? 'Loading…' : 'Unable to Connect'}
                </h2>

                <p className="connection-gate-desc">
                    {isChecking ? 'Please wait.' : 'The server is currently unreachable. Retrying automatically…'}
                </p>

                {!isChecking && (
                    <button
                        type="button"
                        className="connection-gate-retry"
                        onClick={() => { setStatus('checking'); probe() }}
                    >
                        Retry
                    </button>
                )}
            </div>
        </div>
    )
}
