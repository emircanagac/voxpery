const appVersion = process.env.VITE_APP_VERSION || '0.2.0-test'
const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '5173', 10)

const { createServer } = await import('vite')
const server = await createServer({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
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
