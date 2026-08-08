import { Bug, Lightbulb, MessageSquarePlus } from 'lucide-react'
import { openExternalUrl } from '../openExternalUrl'

export const BUG_REPORT_URL = 'https://github.com/emircanagac/voxpery/issues/new?template=bug.md'
export const FEATURE_REQUEST_URL = 'https://github.com/emircanagac/voxpery/issues/new?template=feature.md'

export default function FeedbackCard() {
  return (
    <section className="feedback-card" aria-labelledby="app-feedback-title">
      <div className="feedback-card-heading">
        <MessageSquarePlus size={15} aria-hidden="true" />
        <h2 id="app-feedback-title">Share feedback</h2>
      </div>
      <div className="feedback-card-actions">
        <button type="button" onClick={() => void openExternalUrl(BUG_REPORT_URL)}>
          <Bug size={14} aria-hidden="true" />
          Report a bug
        </button>
        <button type="button" onClick={() => void openExternalUrl(FEATURE_REQUEST_URL)}>
          <Lightbulb size={14} aria-hidden="true" />
          Request a feature
        </button>
      </div>
    </section>
  )
}
