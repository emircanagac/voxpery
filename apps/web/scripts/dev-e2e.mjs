const appVersion = process.env.VITE_APP_VERSION || '0.2.0-test'
// Cloudflare's public always-pass test key keeps CAPTCHA E2E flows identical in CI and locally.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const turnstileSiteKey = process.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'
const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '5173', 10)

const { createServer } = await import('vite')
const server = await createServer({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_TURNSTILE_SITE_KEY': JSON.stringify(turnstileSiteKey),
  },
  server: { host: '127.0.0.1', port, strictPort: true },
})

await server.listen()
server.printUrls()

const closeServer = async () => {
  await server.close()
  process.exit(0)
}

process.once('SIGINT', closeServer)
process.once('SIGTERM', closeServer)
