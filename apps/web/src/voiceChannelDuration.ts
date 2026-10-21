export function formatVoiceChannelDuration(elapsedMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }

    return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Spoken form of the same duration, for screen readers: "6 minutes 14 seconds". */
export function describeVoiceChannelDuration(elapsedMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
    const parts: Array<[number, string]> = [
        [Math.floor(totalSeconds / 3600), 'hour'],
        [Math.floor((totalSeconds % 3600) / 60), 'minute'],
        [totalSeconds % 60, 'second'],
    ]
    const spoken = parts
        .filter(([value], index) => value > 0 || (index === 2 && totalSeconds < 60))
        .map(([value, unit]) => `${value} ${unit}${value === 1 ? '' : 's'}`)
    return spoken.join(' ')
}
