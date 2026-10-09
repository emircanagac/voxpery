import { useEffect, useState, type Ref } from 'react'
import { RefreshCw } from 'lucide-react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { loadTurnstileScript } from '../turnstileScript'

interface Props {
  siteKey: string
  widgetRef: Ref<TurnstileInstance | undefined>
  onToken: (token: string) => void
}

function CaptchaAttempt({ siteKey, widgetRef, onToken, onRetry }: Props & { onRetry: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    loadTurnstileScript().then(() => {
      if (!cancelled) setLoaded(true)
    }).catch((reason: unknown) => {
      if (!cancelled) {
        onToken('')
        setError(reason instanceof Error ? reason.message : 'CAPTCHA could not be loaded. Try again.')
      }
    })
    return () => { cancelled = true }
  }, [onToken])

  const fail = (message: string) => { onToken(''); setError(message) }
  return (
    <div className="form-group">
      {error ? (
        <div className="auth-integration-status is-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}><RefreshCw size={13} aria-hidden />Retry CAPTCHA</button>
        </div>
      ) : loaded ? (
        <div className="auth-turnstile-wrap">
          <Turnstile ref={widgetRef} siteKey={siteKey} injectScript={false}
            onSuccess={onToken}
            onError={() => fail('CAPTCHA verification failed. Try again.')}
            onUnsupported={() => fail('CAPTCHA is not supported in this browser.')}
            onTimeout={() => fail('CAPTCHA timed out. Try again.')}
            onExpire={() => onToken('')}
            options={{ theme: 'dark', size: 'flexible' }} />
        </div>
      ) : <div className="auth-integration-status" role="status">Loading CAPTCHA...</div>}
    </div>
  )
}

export default function RegistrationCaptcha(props: Props) {
  const [attempt, setAttempt] = useState(0)
  return <CaptchaAttempt key={attempt} {...props} onRetry={() => { props.onToken(''); setAttempt(value => value + 1) }} />
}
