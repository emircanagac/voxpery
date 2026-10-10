import { ChevronDown, Copy, Settings2, UserPlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { handleMenuKeyboardNavigation } from '../menuKeyboardNavigation'

type View = 'closed' | 'menu' | 'invite'

/** Server name button in the channel sidebar header, with Invite People and Server Settings. */
export default function ServerHeaderMenu({
    serverName,
    inviteLink,
    onOpenServerSettings,
}: {
    serverName: string
    inviteLink?: string
    onOpenServerSettings?: () => void
}) {
    const [view, setView] = useState<View>('closed')
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
    const containerRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const copyButtonRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const hasActions = !!inviteLink || !!onOpenServerSettings

    useEffect(() => {
        if (view === 'closed') return
        const closeOnOutsidePress = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setView('closed')
        }
        document.addEventListener('pointerdown', closeOnOutsidePress)
        return () => document.removeEventListener('pointerdown', closeOnOutsidePress)
    }, [view])

    useEffect(() => {
        if (view === 'menu') menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
        if (view === 'invite') copyButtonRef.current?.focus()
        if (view !== 'invite') setCopyState('idle')
    }, [view])

    useEffect(() => {
        if (copyState !== 'copied') return
        const timer = window.setTimeout(() => setCopyState('idle'), 1400)
        return () => window.clearTimeout(timer)
    }, [copyState])

    const close = () => {
        setView('closed')
        triggerRef.current?.focus()
    }

    const copyInvite = () => {
        if (!inviteLink || typeof navigator === 'undefined' || !navigator.clipboard) {
            setCopyState('failed')
            return
        }
        navigator.clipboard.writeText(inviteLink).then(
            () => setCopyState('copied'),
            () => setCopyState('failed'),
        )
    }

    return (
        <div
            className="server-header-menu-root"
            ref={containerRef}
            onKeyDown={(event) => {
                if (event.key === 'Escape' && view !== 'closed') {
                    event.stopPropagation()
                    close()
                }
            }}
        >
            <button
                ref={triggerRef}
                type="button"
                className="channel-header-server"
                onClick={() => setView((current) => (current === 'closed' ? 'menu' : 'closed'))}
                title={hasActions ? 'Server menu' : undefined}
                aria-haspopup="menu"
                aria-expanded={view !== 'closed'}
                disabled={!hasActions}
            >
                <span className="channel-header-title">{serverName}</span>
                {hasActions && (
                    <span className="channel-header-action" aria-hidden="true">
                        {view === 'closed' ? <ChevronDown size={14} /> : <X size={14} />}
                    </span>
                )}
            </button>

            {view === 'menu' && (
                <div
                    ref={menuRef}
                    className="server-context-menu server-header-menu"
                    role="menu"
                    aria-label={`${serverName} menu`}
                    onKeyDown={handleMenuKeyboardNavigation}
                >
                    {inviteLink && (
                        <button
                            type="button"
                            className="server-context-menu-item"
                            role="menuitem"
                            onClick={() => setView('invite')}
                        >
                            <UserPlus size={15} aria-hidden="true" />
                            Invite People
                        </button>
                    )}
                    {onOpenServerSettings && (
                        <button
                            type="button"
                            className="server-context-menu-item"
                            role="menuitem"
                            onClick={() => {
                                setView('closed')
                                onOpenServerSettings()
                            }}
                        >
                            <Settings2 size={15} aria-hidden="true" />
                            Server Settings
                        </button>
                    )}
                </div>
            )}

            {view === 'invite' && inviteLink && (
                <div className="server-header-menu server-invite-panel" role="dialog" aria-label="Invite people">
                    <div className="server-invite-panel-head">
                        <span>Invite people to {serverName}</span>
                        <button type="button" className="server-invite-panel-close" onClick={close} aria-label="Close invite panel">
                            <X size={14} />
                        </button>
                    </div>
                    <div className="server-invite-panel-row">
                        <input
                            className="server-invite-panel-link"
                            value={inviteLink}
                            readOnly
                            aria-label="Invite link"
                            onFocus={(event) => event.currentTarget.select()}
                        />
                        <button ref={copyButtonRef} type="button" className="btn btn-primary server-invite-panel-copy" onClick={copyInvite}>
                            <Copy size={14} aria-hidden="true" />
                            {copyState === 'copied' ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                    <p className="server-invite-panel-status" role="status">
                        {copyState === 'copied' && 'Invite link copied to your clipboard.'}
                        {copyState === 'failed' && 'Could not copy automatically. Select the link and copy it.'}
                    </p>
                </div>
            )}
        </div>
    )
}
