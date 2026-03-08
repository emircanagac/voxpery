const SOUND_KEY = 'voxpery-settings-sound-enabled'

let audioCtx: AudioContext | null = null

export function shouldPlayNotificationSound(status: string | undefined): boolean {
  if (localStorage.getItem(SOUND_KEY) === '0') return false
  return status === 'online'
}

export function playMessageNotificationSound(): void {
  const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtor) return
  if (!audioCtx) audioCtx = new AudioCtor()
  const ctx = audioCtx
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(880, now)
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.12)

  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.045, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.15)
}
