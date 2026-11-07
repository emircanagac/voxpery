import { DEPLOY_URL, PublicSiteFooter, PublicSiteHeader, REPO_URL } from './PublicSiteChrome'
import { usePublicPageMetadata } from './publicPageMetadata'
import { Code2, Gauge, Globe2, Mic, MonitorSmartphone, Server, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import '../styles/about.css'
import '../styles/compare.css'
import { advantages, comparison, MEASURED_ON } from './compareContent'

// Same order as `advantages`.
const ADVANTAGE_ICONS = [Gauge, MonitorSmartphone, ShieldCheck, Mic, Code2, Server]

const sources = [
  { label: 'Voxpery source', href: REPO_URL },
  { label: 'Voxpery deployment', href: DEPLOY_URL },
  { label: 'Voxpery releases (installer sizes)', href: `${REPO_URL}/releases/latest` },
  { label: 'Tauri desktop architecture', href: 'https://tauri.app/start/' },
  { label: 'Discord download', href: 'https://discord.com/download' },
  { label: 'Discord Nitro', href: 'https://discord.com/nitro' },
  { label: 'Discord end-to-end encrypted calls', href: 'https://discord.com/blog/meet-dave-e2ee-for-audio-video' },
  { label: 'Discord apps', href: 'https://support.discord.com/hc/en-us/articles/21334461140375-Using-Apps-on-Discord' },
  { label: 'Element plans', href: 'https://element.io/pricing' },
  { label: 'Element desktop (Electron)', href: 'https://github.com/element-hq/element-desktop' },
  { label: 'Zulip features', href: 'https://zulip.com/features/' },
  { label: 'Zulip plans', href: 'https://zulip.com/plans/' },
  { label: 'Zulip desktop (Electron)', href: 'https://github.com/zulip/zulip-desktop' },
]

export default function ComparePage() {
  const isAuthenticated = useAuthStore(state => Boolean(state.user))
  usePublicPageMetadata(
    '/compare',
    'Compare Voxpery | Open-Source & Self-Hosted Discord Alternative',
    'Compare Voxpery, Discord, Element, and Zulip on price, open source, self-hosting, calls, app size, memory use, platforms, and encryption.',
  )

  return (
    <div className="about-page comparison-page">
      <PublicSiteHeader page="compare" />

      <main className="comparison-main">
        <header className="comparison-intro">
          <p className="about-kicker">COMPARE</p>
          <h1>Voxpery</h1>
          <p>
            Open-source community chat. Your conversations, your infrastructure.
          </p>
          <Link to={isAuthenticated ? ROUTES.home : ROUTES.register} className="about-cta about-cta--primary comparison-cta">
            <Globe2 size={18} aria-hidden />
            {isAuthenticated ? 'Open Voxpery' : 'Use Voxpery in browser'}
          </Link>
        </header>

        <section className="comparison-advantages" aria-label="Voxpery advantages">
          {advantages.map(({ title, text }, index) => {
            const Icon = ADVANTAGE_ICONS[index]
            return <div key={title}><Icon size={22} aria-hidden /><h2>{title}</h2><p>{text}</p></div>
          })}
        </section>

        <section className="comparison-section" aria-label="Platform comparison">
          <div className="comparison-table-scroll" role="region" aria-label="Platform comparison table" tabIndex={0}>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col" className="comparison-voxpery">Voxpery</th>
                  <th scope="col">Discord</th>
                  <th scope="col">Element</th>
                  <th scope="col">Zulip</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(({ feature, voxpery, discord, element, zulip }) => (
                  <tr key={feature}>
                    <th scope="row">{feature}</th>
                    <td>{voxpery}</td>
                    <td>{discord}</td>
                    <td>{element}</td>
                    <td>{zulip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="comparison-note">
            Measured on {MEASURED_ON}. Installer sizes are the current Windows downloads from each official
            site or release page. Memory is the total of all app processes (Voxpery 0.4.8 with its WebView2
            processes, Discord 1.0.9265) on one Windows 11 PC, signed in with a text channel open and idle;
            it depends on your servers and activity.
          </p>
        </section>

        <details className="comparison-sources">
          <summary>Sources and last check</summary>
          <p>Checked {MEASURED_ON}. Features and availability may change.</p>
          <ul>
            {sources.map(({ label, href }) => (
              <li key={label}><a href={href} target="_blank" rel="noreferrer">{label}</a></li>
            ))}
          </ul>
        </details>
      </main>

      <PublicSiteFooter />
    </div>
  )
}
