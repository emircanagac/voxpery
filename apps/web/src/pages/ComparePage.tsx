import { DEPLOY_URL, PublicSiteFooter, PublicSiteHeader, REPO_URL } from './PublicSiteChrome'
import { usePublicPageMetadata } from './publicPageMetadata'
import { Code2, Gauge, Globe2, Mic, MonitorSmartphone, Server, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import '../styles/about.css'
import '../styles/compare.css'

// Every row is either checked against the linked sources or measured (see MEASURED_ON and the note).
const MEASURED_ON = 'October 23, 2026'

const comparison = [
  {
    feature: 'Price',
    voxpery: 'Free, no paid tier',
    discord: 'Free; Nitro subscription raises limits',
    element: 'Free app; paid hosting plans',
    zulip: 'Free cloud plan; paid plans',
  },
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
    feature: 'Windows installer',
    voxpery: '8.2 MB',
    discord: '146 MB',
    element: '220 MB',
    zulip: '128 MB',
  },
  {
    feature: 'Desktop engine',
    voxpery: 'System webview (Tauri)',
    discord: 'Bundled Chromium (Electron)',
    element: 'Bundled Chromium (Electron)',
    zulip: 'Bundled Chromium (Electron)',
  },
  {
    feature: 'Desktop platforms',
    voxpery: 'Windows, macOS, Linux',
    discord: 'Windows, macOS, Linux',
    element: 'Windows, macOS, Linux',
    zulip: 'Windows, macOS, Linux',
  },
  {
    feature: 'Mobile',
    voxpery: 'Installable web app; no store app yet',
    discord: 'iOS and Android apps',
    element: 'iOS and Android apps',
    zulip: 'iOS and Android apps',
  },
  {
    feature: 'End-to-end encrypted messages',
    voxpery: 'Not yet',
    discord: 'No (calls only)',
    element: 'Yes, by default',
    zulip: 'No',
  },
  {
    feature: 'Integrations',
    voxpery: 'No app directory yet',
    discord: 'App Directory',
    element: 'Widgets and bridges',
    zulip: 'Bots and integrations',
  },
]

const advantages = [
  {
    Icon: Gauge,
    title: 'Light on your computer',
    text: 'An 8.2 MB Windows installer and about 420 MB of memory while idle, against 146 MB and about 1.2 GB for Discord on the same PC.',
  },
  {
    Icon: MonitorSmartphone,
    title: 'One account everywhere',
    text: 'Use it in the browser or in apps for Windows, macOS and Linux (.deb, .rpm, Flatpak), and install it as a web app on your phone.',
  },
  {
    Icon: ShieldCheck,
    title: 'Free, without ads or tracking',
    text: 'No paid tier, no ads and no analytics cookies. Images from other websites load through Voxpery, so those sites do not see your IP address.',
  },
  {
    Icon: Mic,
    title: 'Chat and calls together',
    text: 'Text channels, direct messages, voice, camera and screen sharing in one app.',
  },
  {
    Icon: Code2,
    title: 'Open to inspection',
    text: 'All of the code is public under AGPL-3.0, so anyone can check what the app does with your data.',
  },
  {
    Icon: Server,
    title: 'Your data, your choice',
    text: 'Use voxpery.com or run the same stack on your own server with Docker. Export your data or delete your account at any time.',
  },
]

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
    'Compare Voxpery with Community Chat Platforms',
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
          {advantages.map(({ Icon, title, text }) => (
            <div key={title}><Icon size={22} aria-hidden /><h2>{title}</h2><p>{text}</p></div>
          ))}
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
