import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Download, Globe2, Server, ShieldCheck } from 'lucide-react'
import { releaseApi, type LatestReleaseResponse } from '../api'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import { useCompactLayout } from '../hooks/useCompactLayout'
import productPreviewUrl from '../assets/voxpery.png?url'
import { DEPLOY_URL, PublicSiteFooter, PublicSiteHeader, RELEASE_URL } from './PublicSiteChrome'
import { usePublicPageMetadata } from './publicPageMetadata'
import '../styles/about.css'

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

  if (/android|iphone|ipad|ipod/.test(userAgent) || (platform.includes('mac') && navigator.maxTouchPoints > 1)) return 'unknown'

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
  usePublicPageMetadata(
    '/',
    'Voxpery | Free Open-Source Discord Alternative',
    'Voxpery is a free, open-source Discord alternative with community chat, voice, desktop apps, hosted access, and full self-hosting.',
  )
  const isAuthenticated = useAuthStore((state) => Boolean(state.user))
  const isCompact = useCompactLayout()
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
  const appEntryRoute = isAuthenticated ? ROUTES.home : ROUTES.register
  const appEntryLabel = isAuthenticated ? 'Open Voxpery' : 'Use Voxpery in browser'
  const releaseMeta = [releaseTag, releaseDate].filter(Boolean).join(' - ')

  return (
    <div className="about-page about-page--landing">
      <PublicSiteHeader releaseUrl={releaseUrl} page="about" />

      <main className="about-main">
        <section className="about-hero">
          <div className="about-hero-copy">
            <p className="about-kicker">Free and open source</p>
            <h1>Voxpery</h1>
            <p className="about-subtitle">
              Text chat, voice channels, screen sharing, and moderation for your community.
              Free, open source, and available in your browser or on your own server.
            </p>
          </div>

          <section className="about-center-actions" aria-label="Primary actions">
            <div className="about-center-actions-row">
              <Link to={appEntryRoute} className="about-cta about-cta--primary">
                <Globe2 size={20} />
                <span>{appEntryLabel}</span>
              </Link>
              {!isCompact && <a href={primaryDownloadUrl} target="_blank" rel="noreferrer" className="about-cta about-cta--secondary about-cta--download">
                <Download size={20} />
                <span>{primaryDownloadLabel}</span>
              </a>}
            </div>
            <div className="about-secondary-actions">
            {!isCompact && <a href={DEPLOY_URL} target="_blank" rel="noreferrer" className="about-self-host-link">
              <Server size={16} />
              <span>Self-host with Docker</span>
            </a>}
            {!isCompact && <p className="about-release-meta about-release-meta--center">
              <ShieldCheck size={16} />
              <span>{releaseMeta ? `Latest release: ${releaseMeta}` : 'Latest release available on GitHub'}</span>
            </p>}
            {isCompact && <p className="about-mobile-note">Community chat, wherever you are. No desktop download needed.</p>}
            </div>
          </section>

          <div className="about-product-previews" aria-label="Voxpery app preview">
            <figure className="about-product-preview about-product-preview--desktop">
              <img src={productPreviewUrl} alt="Voxpery voice channel interface" width={1918} height={950} />
            </figure>
          </div>

        </section>
      </main>

      <PublicSiteFooter />
    </div>
  )
}
