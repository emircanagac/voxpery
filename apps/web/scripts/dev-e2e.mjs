process.env.VITE_APP_VERSION ||= '0.2.0-test'

const { createServer } = await import('vite')
const server = await createServer()

await server.listen()
server.printUrls()

const closeServer = async () => {
  await server.close()
  process.exit(0)
}

process.once('SIGINT', closeServer)
process.once('SIGTERM', closeServer)
