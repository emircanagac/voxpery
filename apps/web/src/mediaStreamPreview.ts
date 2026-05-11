export function attachMediaStreamPreview(video: HTMLVideoElement, stream: MediaStream) {
  const tracks = stream.getTracks()
  const previewStream = typeof MediaStream === 'function' ? new MediaStream(tracks) : stream
  video.srcObject = previewStream

  const play = () => {
    void video.play().catch(() => { })
  }

  video.addEventListener('loadeddata', play, { once: true })
  video.addEventListener('loadedmetadata', play, { once: true })
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) play()

  const retryTimer = setTimeout(play, 150)

  return () => {
    clearTimeout(retryTimer)
    video.removeEventListener('loadeddata', play)
    video.removeEventListener('loadedmetadata', play)
    if (video.srcObject === previewStream) {
      video.srcObject = null
    }
  }
}
