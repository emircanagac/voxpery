import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import VoiceBackgroundLogSetting from './VoiceBackgroundLogSetting'
import {
  noteVoiceBackgroundEvent,
  resetVoiceBackgroundLogForTests,
  startVoiceBackgroundLog,
} from '../webrtc/voiceBackgroundLog'

describe('VoiceBackgroundLogSetting', () => {
  beforeEach(() => {
    localStorage.clear()
    resetVoiceBackgroundLogForTests()
  })
  afterEach(() => {
    localStorage.clear()
    resetVoiceBackgroundLogForTests()
  })

  it('stays hidden until a call was recorded', () => {
    const { container } = render(<VoiceBackgroundLogSetting />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the recorded events as they come and clears them', () => {
    startVoiceBackgroundLog(new Date(2026, 10, 28, 20, 0, 0).getTime())
    render(<VoiceBackgroundLogSetting />)
    expect(screen.getByText('Background log')).toBeInTheDocument()
    expect(screen.getByText('20:00:00 joined voice')).toBeInTheDocument()

    act(() => noteVoiceBackgroundEvent('WebSocket closed', new Date(2026, 10, 28, 20, 0, 12).getTime()))
    expect(screen.getByText('20:00:12 WebSocket closed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText('Background log')).not.toBeInTheDocument()
  })
})
