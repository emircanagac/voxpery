import { ChevronRight, LoaderCircle, X } from 'lucide-react'
import type { MessageWithAuthor } from '../api'

function formatResultDate(value: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Search results shown beside the conversation (a full-height sheet on compact layouts). */
export default function MessageSearchPanel({
    query,
    results,
    scopeLabel,
    jumpingMessageId,
    onGoToMessage,
    onClose,
}: {
    query: string
    /** `null` while the search is loading. */
    results: MessageWithAuthor[] | null
    scopeLabel: string
    jumpingMessageId?: string | null
    onGoToMessage: (messageId: string) => void
    onClose: () => void
}) {
    const count = results?.length ?? 0
    return (
        <aside className="chat-search-panel" aria-label="Search results">
            <div className="chat-search-panel-head">
                <div className="chat-search-panel-summary">
                    <span className="chat-search-panel-title">
                        {results === null ? 'Searching…' : `${count} result${count === 1 ? '' : 's'}`}
                    </span>
                    <span className="chat-search-panel-scope">
                        “{query.trim()}” in {scopeLabel}
                    </span>
                </div>
                <button type="button" className="chat-search-panel-close" onClick={onClose} aria-label="Dismiss search results">
                    <X size={16} aria-hidden />
                </button>
            </div>
            {results === null ? (
                <div className="chat-search-panel-empty" role="status">
                    <LoaderCircle size={18} className="chat-search-panel-spinner" aria-hidden /> Searching messages
                </div>
            ) : count === 0 ? (
                <div className="chat-search-panel-empty" role="status">No messages found</div>
            ) : (
                <ul className="chat-search-panel-list">
                    {results.map((message) => (
                        <li key={message.id} className="chat-search-panel-item">
                            <div className="chat-search-panel-item-head">
                                <span className="chat-search-panel-item-author">{message.author?.username ?? 'Unknown'}</span>
                                {message.created_at && (
                                    <span className="chat-search-panel-item-date">{formatResultDate(message.created_at)}</span>
                                )}
                            </div>
                            <p className="chat-search-panel-item-content">
                                {message.content.slice(0, 280)}{message.content.length > 280 ? '…' : ''}
                                {!message.content.trim() && (message.attachments?.length ?? 0) > 0 && (
                                    <span className="chat-search-panel-item-attachment">Attachment</span>
                                )}
                            </p>
                            <button
                                type="button"
                                className="chat-search-panel-goto"
                                onClick={() => onGoToMessage(message.id)}
                                disabled={!!jumpingMessageId}
                                aria-busy={jumpingMessageId === message.id}
                            >
                                Go to message
                                <ChevronRight size={14} aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </aside>
    )
}
