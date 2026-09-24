import { DEPLOY_URL, PublicSiteFooter, PublicSiteHeader, REPO_URL } from './PublicSiteChrome'
import { usePublicPageMetadata } from './publicPageMetadata'
import '../styles/about.css'
import '../styles/compare.css'

const comparison = [
  {
    feature: 'Open source',
    voxpery: 'AGPL-3.0 codebase',
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
    voxpery: 'Built into voice channels',
    discord: 'Built in',
    element: 'Element Call',
    zulip: 'Via a call provider',
  },
  {
    feature: 'Desktop',
    voxpery: 'Tauri; uses the system webview',
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
          <h1>Voxpery, at a glance</h1>
          <p>
            Voxpery combines open-source code, Docker self-hosting, built-in voice and screen sharing,
            and a Tauri desktop app that uses the system webview.
          </p>
        </header>

        <section className="comparison-section" aria-label="Platform comparison">
          <div className="comparison-table-scroll" role="region" aria-label="Platform comparison table" tabIndex={0}>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col">Voxpery</th>
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
            Tauri uses the system webview instead of bundling a browser engine. We have not benchmarked
            Voxpery against these apps for RAM or CPU use.
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
