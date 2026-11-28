/** The part of a published LiveKit audio track that the switch needs. */
export interface ReplaceableMicrophoneTrack {
  readonly mediaStreamTrack: MediaStreamTrack
  replaceTrack(track: MediaStreamTrack): Promise<unknown>
}

export type ProcessedMicrophoneRestore = 'restored' | 'rebuild' | 'none'

/**
 * On a phone the published microphone passes through Web Audio for the input volume. A phone
 * browser may suspend Web Audio while Voxpery is in the background, which silences that track
 * although the microphone itself keeps running. While the page is hidden the microphone is
 * published as captured (the browser's echo cancellation and noise suppression still apply,
 * the input volume does not); back in the foreground the processed track returns.
 */
export function createBackgroundMicrophoneSwitch() {
  let processed: MediaStreamTrack | null = null
  let captured: MediaStreamTrack | null = null
  let published: ReplaceableMicrophoneTrack | null = null

  // Hiding and showing can follow each other faster than a track is replaced; each switch
  // waits for the previous one.
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation)
    queue = next.catch(() => undefined)
    return next
  }

  const reset = () => {
    processed = null
    captured = null
    published = null
  }

  return {
    get active(): boolean {
      return processed !== null
    },

    /** Publishes `raw` in place of the processed track. Says whether it switched. */
    publishCaptured(track: ReplaceableMicrophoneTrack, raw: MediaStreamTrack): Promise<boolean> {
      return serialized(async () => {
        if (processed || raw.readyState !== 'live') return false
        const current = track.mediaStreamTrack
        if (current === raw) return false
        await track.replaceTrack(raw)
        processed = current
        captured = raw
        published = track
        return true
      })
    },

    /**
     * Puts the processed track back. 'rebuild' means it ended meanwhile and the pipeline has to
     * be built again; 'none' means there was nothing to undo (the microphone was rebuilt or
     * published again while hidden).
     */
    restoreProcessed(track: ReplaceableMicrophoneTrack, muted: boolean): Promise<ProcessedMicrophoneRestore> {
      return serialized(async () => {
        const previous = processed
        const switchedTrack = published
        const rawTrack = captured
        reset()
        if (!previous || switchedTrack !== track || track.mediaStreamTrack !== rawTrack) return 'none'
        if (previous.readyState !== 'live') return 'rebuild'
        previous.enabled = !muted
        await track.replaceTrack(previous)
        return 'restored'
      })
    },

    reset,
  }
}

export type BackgroundMicrophoneSwitch = ReturnType<typeof createBackgroundMicrophoneSwitch>
