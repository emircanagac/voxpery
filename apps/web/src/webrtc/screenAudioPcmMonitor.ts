export interface ScreenAudioPcmSample {
  rmsDb?: number
  minimumRmsDb?: number
  contextState: AudioContextState
  samples: number
}

/** Opt-in measurement only: no recording, track mutation or audible second output. */
export function createScreenAudioPcmMonitor(
  track: MediaStreamTrack,
  context: AudioContext,
  createStream: (tracks: MediaStreamTrack[]) => MediaStream = (tracks) => new MediaStream(tracks),
) {
  const source = context.createMediaStreamSource(createStream([track]))
  const analyser = context.createAnalyser()
  analyser.fftSize = 2048
  const silentOutput = context.createGain()
  silentOutput.gain.value = 0
  source.connect(analyser)
  analyser.connect(silentOutput)
  silentOutput.connect(context.destination)
  const buffer = new Float32Array(analyser.fftSize)
  let energy = 0
  let count = 0
  let minimum = Infinity
  const db = (power: number) => Math.max(-100, 10 * Math.log10(Math.max(1e-10, power)))
  const timer = window.setInterval(() => {
    if (context.state !== 'running' || track.readyState === 'ended') return
    analyser.getFloatTimeDomainData(buffer)
    let power = 0
    for (const sample of buffer) power += sample * sample
    power /= buffer.length
    if (!Number.isFinite(power)) return
    energy += power
    count++
    minimum = Math.min(minimum, db(power))
  }, 50)
  return {
    sample(): ScreenAudioPcmSample {
      const result = {
        contextState: context.state, samples: count,
        rmsDb: count ? Math.round(db(energy / count) * 10) / 10 : undefined,
        minimumRmsDb: count ? Math.round(minimum * 10) / 10 : undefined,
      }
      energy = 0
      count = 0
      minimum = Infinity
      return result
    },
    dispose() {
      window.clearInterval(timer)
      source.disconnect()
      analyser.disconnect()
      silentOutput.disconnect()
    },
  }
}
