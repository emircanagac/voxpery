export function nativeUrl(value) {
  const url = new URL(value)
  if (['postgres', 'redis', 'localhost'].includes(url.hostname)) url.hostname = '127.0.0.1'
  if (!['127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Local QA requires loopback database and Redis URLs.')
  }
  return url.toString()
}
