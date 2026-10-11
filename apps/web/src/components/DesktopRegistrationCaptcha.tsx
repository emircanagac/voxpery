import { useEffect, useRef, useState } from 'react'
import { getDesktopCaptchaFrameUrl } from '../api'

interface DesktopRegistrationCaptchaProps {
    onToken: (token: string) => void
    /** Increment to request a fresh challenge, e.g. after a failed registration attempt. */
    resetSignal: number
}

/**
 * Turnstile does not run on the desktop webview origin, so the challenge is solved in an
 * API-hosted frame that posts only the token back to this window.
 */
export default function DesktopRegistrationCaptcha({ onToken, resetSignal }: DesktopRegistrationCaptchaProps) {
    const frameRef = useRef<HTMLIFrameElement>(null)
    const [height, setHeight] = useState(72)
    const src = getDesktopCaptchaFrameUrl()
    const frameOrigin = new URL(src, window.location.href).origin

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== frameOrigin || event.source !== frameRef.current?.contentWindow) return
            const data = event.data as { source?: unknown; type?: unknown; token?: unknown; height?: unknown }
            if (data?.source !== 'voxpery-captcha') return
            if (data.type === 'token') onToken(typeof data.token === 'string' ? data.token : '')
            if (data.type === 'size' && typeof data.height === 'number') {
                setHeight(Math.min(Math.max(Math.ceil(data.height), 65), 200))
            }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
    }, [frameOrigin, onToken])

    useEffect(() => {
        if (resetSignal === 0) return
        frameRef.current?.contentWindow?.postMessage({ source: 'voxpery-registration', type: 'reset' }, frameOrigin)
    }, [frameOrigin, resetSignal])

    return (
        <iframe
            ref={frameRef}
            className="auth-captcha-frame"
            title="CAPTCHA verification"
            src={src}
            style={{ height }}
            referrerPolicy="no-referrer"
        />
    )
}
