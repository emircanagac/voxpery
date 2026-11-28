import { useSyncExternalStore } from 'react'
import {
  clearVoiceBackgroundLog,
  formatVoiceBackgroundLogEntry,
  getVoiceBackgroundLog,
  subscribeVoiceBackgroundLog,
} from '../webrtc/voiceBackgroundLog'

/** Settings > Voice & Audio: what happened to the last call around the app being in the background. */
export default function VoiceBackgroundLogSetting() {
  const entries = useSyncExternalStore(subscribeVoiceBackgroundLog, getVoiceBackgroundLog, getVoiceBackgroundLog)
  if (entries.length === 0) return null
  return (
    <div className="voice-settings-block" data-testid="voice-background-log">
      <div className="voice-settings-block__title">Background log</div>
      <div className="user-setting-row">
        <div>
          <div className="user-setting-desc">
            What happened to your last call while Voxpery was in the background. It stays in this browser and holds no messages or account data.
          </div>
          <ol className="voice-background-log">
            {entries.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>{formatVoiceBackgroundLogEntry(entry)}</li>
            ))}
          </ol>
        </div>
        <div className="user-setting-actions">
          <button type="button" className="user-toggle account-action-btn" onClick={clearVoiceBackgroundLog}>
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}
