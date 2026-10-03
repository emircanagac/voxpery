import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

const outputDir = resolve(process.argv[2] ?? 'test-results/voice-cues')
const bundle = await build({
  stdin: {
    contents: "export { VOICE_CUE_TONES, VOICE_AUDIO_SAMPLE_RATE, playCueStack } from './src/audioCues'; export { MESSAGE_NOTIFICATION_TONES } from './src/notificationSound';",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    sourcefile: 'cue-preview.ts',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'VoxperyCuePreview',
  platform: 'browser',
})

function encodeWav(samples, sampleRate) {
  const wav = Buffer.alloc(44 + samples.length * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((sample, index) => {
    assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 1, 'Invalid or clipped sample')
    wav.writeInt16LE(Math.round(sample * 32767), 44 + index * 2)
  })
  return wav
}

const browser = await chromium.launch({ headless: true })
try {
  // Render only the trusted local synthesizer: no app session, microphone, or network.
  const page = await browser.newPage()
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const rendered = await page.evaluate(async () => {
    const { VOICE_CUE_TONES, MESSAGE_NOTIFICATION_TONES, VOICE_AUDIO_SAMPLE_RATE, playCueStack } = window.VoxperyCuePreview
    const cues = {}
    for (const [kind, tones] of Object.entries({ ...VOICE_CUE_TONES, message: MESSAGE_NOTIFICATION_TONES })) {
      const duration = Math.max(...tones.map((tone) => (tone.offsetSec ?? 0) + tone.durationSec))
      const ctx = new OfflineAudioContext(1, Math.ceil((duration + 0.08) * VOICE_AUDIO_SAMPLE_RATE), VOICE_AUDIO_SAMPLE_RATE)
      playCueStack(ctx, [...tones])
      const audio = await ctx.startRendering()
      cues[kind] = { duration, samples: Array.from(audio.getChannelData(0)) }
    }
    return { sampleRate: VOICE_AUDIO_SAMPLE_RATE, cues }
  })

  await mkdir(outputDir, { recursive: true })
  const hashes = new Set()
  for (const [kind, { duration, samples }] of Object.entries(rendered.cues)) {
    const peak = Math.max(...samples.map(Math.abs))
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
    const tailPeak = Math.max(...samples.slice(-480).map(Math.abs))
    assert.ok(duration <= 0.4, `${kind}: confirmation is too long`)
    assert.ok(peak > 0.005 && peak < 0.12, `${kind}: silent or unexpectedly loud output`)
    assert.ok(rms > 0.001, `${kind}: unexpectedly quiet output`)
    assert.ok(tailPeak < 0.00001, `${kind}: audio graph has not settled after the cue`)
    const wav = encodeWav(samples, rendered.sampleRate)
    hashes.add(createHash('sha256').update(wav).digest('hex'))
    await writeFile(resolve(outputDir, `${kind}.wav`), wav)
    console.log(`${kind}: ${Math.round(duration * 1000)} ms, peak ${peak.toFixed(4)}, RMS ${rms.toFixed(4)}`)
  }
  assert.equal(hashes.size, Object.keys(rendered.cues).length, 'Duplicate rendered cues')

  const pairs = {
    'room-events': ['join', 'leave'],
    microphone: ['mute', 'unmute'],
    headphones: ['deafen', 'undeafen'],
    camera: ['camera-start', 'camera-stop'],
    'screen-share': ['screen-start', 'screen-stop'],
  }
  for (const [name, kinds] of Object.entries(pairs)) {
    const gap = Array(Math.round(rendered.sampleRate * 0.5)).fill(0)
    const samples = kinds.flatMap((kind, index) => [
      ...(index === 0 ? [] : gap),
      ...rendered.cues[kind].samples,
    ])
    await writeFile(resolve(outputDir, `${name}.wav`), encodeWav(samples, rendered.sampleRate))
  }
  console.log(`Validated all ${Object.keys(rendered.cues).length} cues. Preview files: ${outputDir}`)
} finally {
  await browser.close()
}
