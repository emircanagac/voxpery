import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearVoiceBackgroundLog,
  formatVoiceBackgroundLogEntry,
  getVoiceBackgroundLog,
  noteVoiceBackgroundEvent,
  observeVoiceAudioContext,
  observeVoiceMicrophone,
  resetVoiceBackgroundLogForTests,
  startVoiceBackgroundLog,
  stopVoiceBackgroundLog,
  subscribeVoiceBackgroundLog,
} from './voiceBackgroundLog'

describe('voice background log', () => {
  beforeEach(() => {
    localStorage.clear()
    resetVoiceBackgroundLogForTests()
  })
  afterEach(() => {
    localStorage.clear()
    resetVoiceBackgroundLogForTests()
  })

  it('records only while a call is recorded', () => {
    noteVoiceBackgroundEvent('page hidden', 1)
    expect(getVoiceBackgroundLog()).toEqual([])

    startVoiceBackgroundLog(10)
    noteVoiceBackgroundEvent('page hidden', 20)
    stopVoiceBackgroundLog(30)
    noteVoiceBackgroundEvent('page shown', 40)

    expect(getVoiceBackgroundLog().map((entry) => entry.event)).toEqual(['joined voice', 'page hidden', 'left voice'])
  })

  it('starts over for each call and keeps the latest entries', () => {
    startVoiceBackgroundLog(1)
    noteVoiceBackgroundEvent('old call', 2)
    startVoiceBackgroundLog(3)
    for (let index = 0; index < 100; index += 1) noteVoiceBackgroundEvent(`event ${index}`, 10 + index)

    const log = getVoiceBackgroundLog()
    expect(log).toHaveLength(60)
    expect(log.some((entry) => entry.event === 'old call')).toBe(false)
    expect(log.at(-1)?.event).toBe('event 99')
  })

  it('survives a reload of the page and can be cleared', () => {
    startVoiceBackgroundLog(1)
    noteVoiceBackgroundEvent('WebSocket closed', 2)
    resetVoiceBackgroundLogForTests()

    expect(getVoiceBackgroundLog().map((entry) => entry.event)).toEqual(['joined voice', 'WebSocket closed'])
    let changes = 0
    subscribeVoiceBackgroundLog(() => { changes += 1 })
    clearVoiceBackgroundLog()
    expect(getVoiceBackgroundLog()).toEqual([])
    expect(changes).toBe(1)
    expect(localStorage.getItem('voxpery-voice-background-log')).toBeNull()
  })

  it('ignores stored data it does not understand', () => {
    localStorage.setItem('voxpery-voice-background-log', JSON.stringify([{ at: 'x' }, { at: 5, event: 'page shown' }]))
    expect(getVoiceBackgroundLog()).toEqual([{ at: 5, event: 'page shown' }])
    resetVoiceBackgroundLogForTests()
    localStorage.setItem('voxpery-voice-background-log', '{broken')
    expect(getVoiceBackgroundLog()).toEqual([])
  })

  it('formats entries with the local time', () => {
    const at = new Date(2026, 10, 28, 9, 5, 7).getTime()
    expect(formatVoiceBackgroundLogEntry({ at, event: 'page hidden' })).toBe('09:05:07 page hidden')
  })

  it('records microphone and Web Audio changes once per object', () => {
    startVoiceBackgroundLog(1)
    const microphone = new EventTarget() as unknown as MediaStreamTrack
    observeVoiceMicrophone(microphone)
    observeVoiceMicrophone(microphone)
    microphone.dispatchEvent(new Event('mute'))
    microphone.dispatchEvent(new Event('ended'))

    const context = Object.assign(new EventTarget(), { state: 'suspended' }) as unknown as AudioContext
    observeVoiceAudioContext(context)
    context.dispatchEvent(new Event('statechange'))

    expect(getVoiceBackgroundLog().map((entry) => entry.event)).toEqual([
      'joined voice',
      'microphone muted by the system',
      'microphone ended',
      'Web Audio suspended',
    ])
  })
})
