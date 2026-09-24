import { Link } from 'react-router'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'

export const REPO_URL = 'https://github.com/emircanagac/voxpery'
export const SECURITY_URL = `${REPO_URL}/blob/main/SECURITY.md`
export const RELEASE_URL = `${REPO_URL}/releases/latest`
export const CONTRIBUTE_URL = `${REPO_URL}/blob/main/docs/CONTRIBUTING.md`
export const DEPLOY_URL = `${REPO_URL}/blob/main/docs/DEPLOYMENT.md`

export function PublicSiteHeader({ releaseUrl = RELEASE_URL, page }: { releaseUrl?: string; page: 'about' | 'compare' }) {
  const isAuthenticated = useAuthStore((state) => Boolean(state.user))
  const isLanding = page === 'about'

  return (
    <header className="about-topbar">
      <Link to={ROUTES.about} className="about-brand">
        <img src={isLanding ? '/fox-animated.svg' : '/1024.png'} alt="" width={isLanding ? 44 : 28} height={isLanding ? 44 : 28} />
        <span>Voxpery</span>
      </Link>

      <nav className="about-topbar-nav" aria-label="Primary">
        <Link to={ROUTES.compare} className="about-topbar-link" aria-current={page === 'compare' ? 'page' : undefined}>
          Compare
        </Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="about-topbar-link">Source</a>
        <a href={DEPLOY_URL} target="_blank" rel="noreferrer" className="about-topbar-link">Self-host</a>
        <a href={releaseUrl} target="_blank" rel="noreferrer" className="about-topbar-link about-topbar-link--secondary">Releases</a>
        <a href={CONTRIBUTE_URL} target="_blank" rel="noreferrer" className="about-topbar-link about-topbar-link--secondary">Contribute</a>
        <a href={SECURITY_URL} target="_blank" rel="noreferrer" className="about-topbar-link about-topbar-link--secondary">Security</a>
      </nav>

      <div className="about-topbar-actions">
        <Link to={isAuthenticated ? ROUTES.home : ROUTES.login} className="about-btn about-btn--login">
          {isAuthenticated ? 'Go to app' : 'Login'}
        </Link>
      </div>
    </header>
  )
}

export function PublicSiteFooter() {
  return (
    <footer className="about-footer">
      <div className="about-footer-inner">
        <nav className="about-footer-links" aria-label="Legal information">
          <Link to={ROUTES.privacy}>Privacy Notice</Link>
          <Link to={ROUTES.kvkk}>KVKK Notice</Link>
          <Link to={ROUTES.terms}>Terms of Service</Link>
        </nav>
      </div>
    </footer>
  )
}
