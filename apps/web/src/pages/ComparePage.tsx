import { DEPLOY_URL, PublicSiteFooter, PublicSiteHeader, REPO_URL } from './PublicSiteChrome'
import { usePublicPageMetadata } from './publicPageMetadata'
import { Code2, Globe2, Mic, Server } from 'lucide-react'
import { Link } from 'react-router'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import '../styles/about.css'
import '../styles/compare.css'

const comparison = [
  {
    feature: 'Open source',
    voxpery: 'AGPL-3.0 source',
    discord: 'Proprietary service',
    element: 'Open source',
    zulip: 'Open source',
  },
  {
    feature: 'Self-hosting',
    voxpery: 'Docker deployment',
    discord: 'No official server option',
    element: 'Matrix homeserver',
    zulip: 'Supported',
  },
  {
    feature: 'Voice and screen sharing',
    voxpery: 'Built-in voice and screen sharing',
    discord: 'Built in',
    element: 'Element Call',
    zulip: 'Via a call provider',
  },
  {
    feature: 'Desktop',
    voxpery: 'System webview (Tauri)',
    discord: 'Desktop app',
    element: 'Desktop app',
    zulip: 'Desktop app',
  },
  {
    feature: 'Integrations',
    voxpery: 'No app directory yet',
    discord: 'App Directory',
    element: 'Widgets and bridges',
    zulip: 'Bots and integrations',
  },
]

const sources = [
  { label: 'Voxpery source', href: REPO_URL },
  { label: 'Voxpery deployment', href: DEPLOY_URL },
  { label: 'Tauri desktop architecture', href: 'https://tauri.app/start/' },
  { label: 'Discord features', href: 'https://discord.com/download' },
  { label: 'Discord apps', href: 'https://support.discord.com/hc/en-us/articles/21334461140375-Using-Apps-on-Discord' },
  { label: 'Discord terms', href: 'https://discord.com/terms' },
  { label: 'Element features', href: 'https://element.io/pricing' },
  { label: 'Zulip features', href: 'https://zulip.com/features/' },
]

export default function ComparePage() {
  const isAuthenticated = useAuthStore(state => Boolean(state.user))
  usePublicPageMetadata(
    '/compare',
    'Compare Voxpery with Community Chat Platforms',
    'Compare Voxpery, Discord, Element, and Zulip on open source, self-hosting, calls, desktop apps, and integrations.',
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
          <div><Code2 size={22} aria-hidden /><h2>Open to inspection</h2><p>Public AGPL-3.0 code.</p></div>
          <div><Server size={22} aria-hidden /><h2>Your infrastructure</h2><p>Hosted or Docker self-hosted.</p></div>
          <div><Mic size={22} aria-hidden /><h2>Chat and calls together</h2><p>Voice and screen sharing included.</p></div>
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
            Tauri uses the system webview. Comparative RAM/CPU benchmarks are not yet available.
          </p>
        </section>

        <details className="comparison-sources">
          <summary>Sources and last check</summary>
          <p>Checked September 24, 2026. Features and availability may change.</p>
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
