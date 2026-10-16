import { useRef, useState, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { MessageReaction } from '../types'

/** A reaction chip under a message, with the people who reacted in its tooltip. */
export function ReactionButton({
    reaction,
    disabled,
    onToggle,
}: {
    reaction: MessageReaction
    disabled: boolean
    onToggle: () => void
}) {
    const [isDetailsOpen, setIsDetailsOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
    const usernames = reaction.users?.map((user) => user.username).filter(Boolean) ?? []
    const reactionLabel = usernames.length > 0
        ? `${reaction.emoji} reaction from ${usernames.join(', ')}`
        : `${reaction.emoji} reaction, ${reaction.count} total`

    const syncPosition = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect()
        if (!rect) return
        setPosition({
            left: Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2)),
            top: Math.max(8, rect.top - 8),
        })
    }, [])

    useLayoutEffect(() => {
        if (!isDetailsOpen || usernames.length === 0) return
        syncPosition()
        window.addEventListener('resize', syncPosition)
        window.addEventListener('scroll', syncPosition, true)
        return () => {
            window.removeEventListener('resize', syncPosition)
            window.removeEventListener('scroll', syncPosition, true)
        }
    }, [isDetailsOpen, syncPosition, usernames.length])

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={`message-reaction-btn ${reaction.reacted ? 'is-reacted' : ''}`}
                disabled={disabled}
                aria-label={reactionLabel}
                onPointerEnter={() => setIsDetailsOpen(true)}
                onPointerLeave={() => setIsDetailsOpen(false)}
                onFocus={() => setIsDetailsOpen(true)}
                onBlur={() => setIsDetailsOpen(false)}
                onClick={onToggle}
            >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
            </button>
            {isDetailsOpen && usernames.length > 0 && position && typeof document !== 'undefined' && createPortal(
                <div
                    className="message-reaction-details"
                    role="tooltip"
                    style={{ left: position.left, top: position.top }}
                >
                    <strong>{reaction.emoji}</strong>
                    <span>{usernames.join(', ')}</span>
                </div>,
                document.body,
            )}
        </>
    )
}
