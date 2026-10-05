/* eslint-disable react-refresh/only-export-components -- Browser-only test harness, not a Fast Refresh module. */
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import VoiceMediaPreview from '../src/components/VoiceMediaPreview'

function MovingVideo({ width, height }: { width: number; height: number }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    let frame = 0
    const draw = () => {
      context.fillStyle = 'rgb(48,48,48)'
      context.fillRect(0, 0, width, height)
      const strip = Math.min(width, height) / 12
      for (const [color, x, y, w, h] of [
        ['rgb(240,32,32)', 0, 0, strip, height],
        ['rgb(32,240,32)', width - strip, 0, strip, height],
        ['rgb(32,32,240)', 0, 0, width, strip],
        ['rgb(240,240,32)', 0, height - strip, width, strip],
      ] as const) { context.fillStyle = color; context.fillRect(x, y, w, h) }
      context.fillStyle = 'white'
      context.fillRect(width / 2 + (frame++ % 20), height / 2, 10, 10)
    }
    draw()
    const stream = canvas.captureStream(12)
    video.current!.srcObject = stream
    const interval = setInterval(draw, 80)
    return () => { clearInterval(interval); stream.getTracks().forEach((track) => track.stop()) }
  }, [width, height])
  return <video ref={video} autoPlay muted playsInline />
}

export function mountVoiceMediaFixture(width: number, height: number, kind: 'screen' | 'camera' = 'screen') {
  const fixture = document.createElement('div')
  fixture.id = 'voice-media-fixture'
  fixture.style.cssText = 'position:fixed;inset:0;z-index:2000;background:#171717;display:grid;place-items:center'
  document.body.appendChild(fixture)
  createRoot(fixture).render(
    <VoiceMediaPreview kind={kind} className="voice-stage-share-tile" style={{ width: Math.min(innerWidth - 40, 400), height: 400 }}>
      <MovingVideo width={width} height={height} />
      <button style={{ position: 'absolute', top: 10, left: 10 }} type="button" onClick={(event) => {
        void event.currentTarget.closest('.screen-share-preview')!.requestFullscreen()
      }}>Enter fullscreen</button>
    </VoiceMediaPreview>,
  )
}
