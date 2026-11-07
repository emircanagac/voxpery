// Shared by ComparePage and the static fallback in compare.html (see compareStaticHtml.test.ts).
// Every row is either checked against the linked sources or measured (see MEASURED_ON and the note).
export const MEASURED_ON = 'October 23, 2026'

export const comparison = [
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

export const advantages = [
  {
    title: 'Light on your computer',
    text: 'An 8.2 MB Windows installer and about 420 MB of memory while idle, against 146 MB and about 1.2 GB for Discord on the same PC.',
  },
  {
    title: 'One account everywhere',
    text: 'Use it in the browser or in apps for Windows, macOS and Linux (.deb, .rpm, Flatpak), and install it as a web app on your phone.',
  },
  {
    title: 'Free, without ads or tracking',
    text: 'No paid tier, no ads and no analytics cookies. Images from other websites load through Voxpery, so those sites do not see your IP address.',
  },
  {
    title: 'Chat and calls together',
    text: 'Text channels, direct messages, voice, camera and screen sharing in one app.',
  },
  {
    title: 'Open to inspection',
    text: 'All of the code is public under AGPL-3.0, so anyone can check what the app does with your data.',
  },
  {
    title: 'Your data, your choice',
    text: 'Use voxpery.com or run the same stack on your own server with Docker. Export your data or delete your account at any time.',
  },
]
