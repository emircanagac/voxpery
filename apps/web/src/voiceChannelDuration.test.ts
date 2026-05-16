import { describe, expect, it } from 'vitest'
import { formatVoiceChannelDuration } from './voiceChannelDuration'

describe('formatVoiceChannelDuration', () => {
    it('formats seconds before the first minute', () => {
        expect(formatVoiceChannelDuration(0)).toBe('0:00')
        expect(formatVoiceChannelDuration(59_999)).toBe('0:59')
    })

    it('formats minutes and seconds', () => {
        expect(formatVoiceChannelDuration(61_000)).toBe('1:01')
        expect(formatVoiceChannelDuration(9 * 60_000 + 5_000)).toBe('9:05')
    })

    it('formats hours and minutes', () => {
        expect(formatVoiceChannelDuration(60 * 60_000)).toBe('1:00:00')
        expect(formatVoiceChannelDuration(2 * 60 * 60_000 + 7 * 60_000 + 42_000)).toBe('2:07:42')
    })
})
