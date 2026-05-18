import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Globe2, ShieldCheck } from 'lucide-react'
import { releaseApi, type LatestReleaseResponse } from '../api'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import productPreviewUrl from '../assets/voxpery.png?url'
import '../styles/about.css'
const REPO_URL = 'https://github.com/emircanagac/voxpery'
const SECURITY_URL = `${REPO_URL}/blob/main/SECURITY.md`
const RELEASE_URL = `${REPO_URL}/releases/latest`
const CONTRIBUTORS_URL = `${REPO_URL}/graphs/contributors`

type DownloadPlatform = 'windows' | 'macos' | 'linux'
type KnownPlatform = DownloadPlatform | 'unknown'

const PLATFORM_LABELS: Record<DownloadPlatform, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
}

function detectPlatform(): KnownPlatform {
  const userAgent = navigator.userAgent.toLowerCase()
  const platform = (navigator.platform || '').toLowerCase()

  if (userAgent.includes('win') || platform.includes('win')) return 'windows'
  if (userAgent.includes('mac') || platform.includes('mac') || userAgent.includes('darwin')) return 'macos'
  if (userAgent.includes('linux') || platform.includes('linux')) return 'linux'
  return 'unknown'
}

function formatReleaseDate(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function AboutPage() {
  const isAuthenticated = useAuthStore((state) => Boolean(state.user))
  const platform = useMemo(() => detectPlatform(), [])
  const [releaseTag, setReleaseTag] = useState<string | null>(null)
  const [releaseDate, setReleaseDate] = useState<string | null>(null)
  const [releaseUrl, setReleaseUrl] = useState(RELEASE_URL)
  const [downloads, setDownloads] = useState<Partial<Record<DownloadPlatform, string>>>({})

  useEffect(() => {
    let cancelled = false

    async function loadLatestRelease() {
      try {
        const data: LatestReleaseResponse = await releaseApi.getLatest()
        if (cancelled) return
        setReleaseTag(data.tag ?? null)
        setReleaseDate(formatReleaseDate(data.published_at ?? undefined))
        setReleaseUrl(data.html_url || RELEASE_URL)
        setDownloads({
          windows: data.downloads.windows,
          macos: data.downloads.macos,
          linux: data.downloads.linux,
        })
      } catch {
        // Keep static release link fallback when the release API is unavailable.
      }
    }

    void loadLatestRelease()
    return () => {
      cancelled = true
    }
  }, [])

  const detectedDownload = platform !== 'unknown' ? downloads[platform] : null
  const primaryDownloadUrl = detectedDownload ?? releaseUrl
  const primaryDownloadLabel = platform === 'unknown' ? 'Download desktop app' : `Download for ${PLATFORM_LABELS[platform]}`
  const appEntryRoute = isAuthenticated ? ROUTES.home : ROUTES.login
  const appEntryLabel = 'Open in browser'
  const releaseMeta = [releaseTag, releaseDate].filter(Boolean).join(' • ')

  return (
    <div className="about-page">
      <header className="about-topbar">
        <Link to={ROUTES.about} className="about-brand">
          <img src="/1024.png" alt="Voxpery" width={28} height={28} />
          <span>Voxpery</span>
        </Link>

        <nav className="about-topbar-nav" aria-label="Primary">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="about-topbar-link">
            GitHub
          </a>
          <a href={releaseUrl} target="_blank" rel="noreferrer" className="about-topbar-link about-topbar-link--secondary">
            Releases
          </a>
          <a href={CONTRIBUTORS_URL} target="_blank" rel="noreferrer" className="about-topbar-link about-topbar-link--secondary">
            Contributors
          </a>
          <a href={SECURITY_URL} target="_blank" rel="noreferrer" className="about-topbar-link about-topbar-link--secondary">
            Security
          </a>
        </nav>

        <div className="about-topbar-actions">
          <Link to={appEntryRoute} className="about-btn about-btn--login">
            {isAuthenticated ? 'Go to app' : 'Login'}
          </Link>
        </div>
      </header>

      <main className="about-main">
        <section className="about-hero">
          <div className="about-hero-copy">
            <h1>Open-source chat and voice for communities.</h1>
            <p className="about-subtitle">
              Voxpery gives communities chat, voice, desktop apps, moderation tools, and transparent code.
              Use it hosted in your browser, or deploy the same stack yourself.
            </p>
          </div>

          <section className="about-center-actions" aria-label="Primary actions">
            <div className="about-center-actions-row">
              <a href={primaryDownloadUrl} target="_blank" rel="noreferrer" className="about-cta about-cta--light about-cta--download">
                <Download size={20} />
                <span>{primaryDownloadLabel}</span>
              </a>
              <Link to={appEntryRoute} className="about-cta about-cta--primary">
                <Globe2 size={20} />
                <span>{appEntryLabel}</span>
              </Link>
            </div>
            <p className="about-release-meta about-release-meta--center">
              <ShieldCheck size={16} />
              <span>{releaseMeta ? `Latest release: ${releaseMeta}` : 'Latest release available on GitHub'}</span>
            </p>
          </section>

          <div className="about-product-previews" aria-label="Voxpery app preview">
            <figure className="about-product-preview about-product-preview--desktop">
              <img src={productPreviewUrl} alt="Voxpery voice channel interface" />
            </figure>
          </div>

          <p className="about-trust-note">
            Open source, self-hostable, and no ads or analytics.
          </p>

        </section>
      </main>
    </div>
  )
}
