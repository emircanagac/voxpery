import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Globe2, ShieldCheck } from 'lucide-react'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import '../styles/about.css'

const REPO_URL = 'https://github.com/emircanagac/voxpery'
const SECURITY_URL = `${REPO_URL}/blob/main/SECURITY.md`
const RELEASE_URL = `${REPO_URL}/releases/latest`
const RELEASE_API_URL = 'https://api.github.com/repos/emircanagac/voxpery/releases/latest'

type DownloadPlatform = 'windows' | 'macos' | 'linux'
type KnownPlatform = DownloadPlatform | 'unknown'

type ReleaseAsset = {
  name: string
  browser_download_url: string
}

type ReleaseResponse = {
  tag_name?: string
  html_url?: string
  published_at?: string
  assets?: ReleaseAsset[]
}

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

function getInstallers(assets: ReleaseAsset[]): ReleaseAsset[] {
  return assets.filter((asset) => {
    const name = asset.name.toLowerCase()
    return !name.endsWith('.sig') && !name.endsWith('.sha256') && !name.endsWith('.json') && !name.endsWith('.txt')
  })
}

function pickInstaller(assets: ReleaseAsset[], platform: DownloadPlatform): ReleaseAsset | null {
  const installers = getInstallers(assets)

  if (platform === 'windows') {
    return (
      installers.find((asset) => asset.name.toLowerCase().endsWith('.exe')) ??
      installers.find((asset) => asset.name.toLowerCase().endsWith('.msi')) ??
      null
    )
  }

  if (platform === 'macos') {
    return (
      installers.find((asset) => asset.name.toLowerCase().endsWith('.dmg')) ??
      installers.find((asset) => asset.name.toLowerCase().includes('.app.tar.gz')) ??
      null
    )
  }

  return (
    installers.find((asset) => asset.name.toLowerCase().endsWith('.appimage')) ??
    installers.find((asset) => asset.name.toLowerCase().endsWith('.deb')) ??
    installers.find((asset) => asset.name.toLowerCase().endsWith('.rpm')) ??
    null
  )
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
  const [downloads, setDownloads] = useState<Partial<Record<DownloadPlatform, ReleaseAsset>>>({})

  useEffect(() => {
    let cancelled = false

    async function loadLatestRelease() {
      try {
        const response = await fetch(RELEASE_API_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
          },
        })

        if (!response.ok) return
        const data = (await response.json()) as ReleaseResponse
        const assets = data.assets ?? []

        if (cancelled) return
        setReleaseTag(data.tag_name ?? null)
        setReleaseDate(formatReleaseDate(data.published_at))
        if (data.html_url) setReleaseUrl(data.html_url)
        setDownloads({
          windows: pickInstaller(assets, 'windows') ?? undefined,
          macos: pickInstaller(assets, 'macos') ?? undefined,
          linux: pickInstaller(assets, 'linux') ?? undefined,
        })
      } catch {
        // Keep static release link fallback when API is unavailable.
      }
    }

    void loadLatestRelease()
    return () => {
      cancelled = true
    }
  }, [])

  const detectedDownload = platform !== 'unknown' ? downloads[platform] : null
  const primaryDownloadUrl = detectedDownload?.browser_download_url ?? releaseUrl
  const primaryDownloadLabel = platform === 'unknown' ? 'Download desktop app' : `Download for ${PLATFORM_LABELS[platform]}`
  const appEntryRoute = isAuthenticated ? ROUTES.home : ROUTES.login
  const appEntryLabel = isAuthenticated ? 'Open Voxpery app' : 'Open Voxpery in browser'
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
          <a href={releaseUrl} target="_blank" rel="noreferrer" className="about-topbar-link">
            Releases
          </a>
          <a href={SECURITY_URL} target="_blank" rel="noreferrer" className="about-topbar-link">
            Security
          </a>
        </nav>

        <div className="about-topbar-actions">
          <Link to={appEntryRoute} className="about-btn about-btn--login">
            {isAuthenticated ? 'Open app' : 'Login'}
          </Link>
        </div>
      </header>

      <main className="about-main">
        <section className="about-hero">
          <div className="about-hero-copy">
            <h1>
              <span>Your voice</span>
              <span>Your space</span>
            </h1>
            <p className="about-subtitle">
              Voxpery is a privacy-first, open-source communication platform built for teams and communities that want
              secure communication, transparent code, and a clean onboarding experience.
            </p>
          </div>
        </section>

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
      </main>
    </div>
  )
}
