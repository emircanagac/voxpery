import { Link } from 'react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import { useCompactLayout } from '../hooks/useCompactLayout'

export const REPO_URL = 'https://github.com/emircanagac/voxpery'
export const SECURITY_URL = `${REPO_URL}/blob/main/SECURITY.md`
export const RELEASE_URL = `${REPO_URL}/releases/latest`
export const CONTRIBUTE_URL = `${REPO_URL}/blob/main/docs/CONTRIBUTING.md`
export const DEPLOY_URL = `${REPO_URL}/blob/main/docs/DEPLOYMENT.md`

export function PublicSiteHeader({ releaseUrl = RELEASE_URL, page }: { releaseUrl?: string; page: 'about' | 'compare' }) {
  const isAuthenticated = useAuthStore((state) => Boolean(state.user))
  const isCompact = useCompactLayout()
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const navId = useId()

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [menuOpen])

  return (
    <header ref={headerRef} className="about-topbar">
      <Link to={ROUTES.about} className="about-brand">
        <img src="/fox-animated.svg" alt="" width={44} height={44} />
        <span>Voxpery</span>
      </Link>

      <nav id={navId} className={`about-topbar-nav${menuOpen ? ' about-topbar-nav--open' : ''}`} aria-label="Primary" onClick={(event) => {
        if ((event.target as HTMLElement).closest('a')) setMenuOpen(false)
      }}>
        <Link to={ROUTES.compare} className="about-topbar-link" aria-current={page === 'compare' ? 'page' : undefined}>
          Compare
        </Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="about-topbar-link">Source</a>
        {!isCompact && <a href={DEPLOY_URL} target="_blank" rel="noreferrer" className="about-topbar-link">Self-host</a>}
        {!isCompact && <a href={releaseUrl} target="_blank" rel="noreferrer" className="about-topbar-link about-topbar-link--secondary">Releases</a>}
        <a href={CONTRIBUTE_URL} target="_blank" rel="noreferrer" className="about-topbar-link about-topbar-link--secondary">Contribute</a>
        <a href={SECURITY_URL} target="_blank" rel="noreferrer" className="about-topbar-link about-topbar-link--secondary">Security</a>
      </nav>

      <div className="about-topbar-actions">
        <button ref={menuButtonRef} type="button" className="about-menu-toggle" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls={navId} onClick={() => setMenuOpen(open => !open)}>
          {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        </button>
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
