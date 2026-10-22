import { Link } from 'react-router'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import { useDocumentTitle } from './publicPageMetadata'

export default function NotFoundPage() {
  const signedIn = useAuthStore((s) => !!s.user)
  useDocumentTitle('Page not found | Voxpery')
  return (
    <main className="auth-page">
      <section className="auth-card not-found-card" aria-labelledby="not-found-title">
        <img src="/fox-animated.svg" alt="" className="auth-logo" width={80} height={80} />
        <h1 id="not-found-title">Page not found</h1>
        <p>This address does not exist or has moved.</p>
        <Link className="btn btn-primary not-found-home" to={signedIn ? ROUTES.home : ROUTES.landing}>
          {signedIn ? 'Back to Voxpery' : 'Go to the home page'}
        </Link>
      </section>
    </main>
  )
}
