import { useMemo, useRef, useState, useEffect } from 'react'
import { PlusCircle, LogIn, LogOut, Volume2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { serverApi } from '../api'

interface ServerSidebarProps {
  onCreateServer: () => void
  onJoinServer: () => void
  onOpenServerSettings?: (serverId: string) => void
  onSelectServer?: (serverId: string) => void
  displayActiveServerId?: string | null
}

type DragIntent = 'before' | 'after'

const PREFETCH_DELAY_MS = 120
const SIDEBAR_END_DROP_ID = '__sidebar-end-drop__'

export default function ServerSidebar({
    onCreateServer,
    onJoinServer,
  onOpenServerSettings,
  onSelectServer,
  displayActiveServerId,
}: ServerSidebarProps) {
    const { user, token } = useAuthStore()
    const {
        servers,
        serversLoading,
        activeServerId,
        setActiveServer,
        setServers,
        channelsByServerId,
        setChannelsForServer,
        setMembersForServer,
        serverUnreadByChannel,
        clearServerUnread,
        mutedServerIds,
        toggleMutedServer,
        voiceStates,
        voiceStateServerIds,
    } = useAppStore(
        useShallow((s) => ({
            servers: s.servers,
            serversLoading: s.serversLoading,
            activeServerId: s.activeServerId,
            setActiveServer: s.setActiveServer,
            setServers: s.setServers,
            channelsByServerId: s.channelsByServerId,
            setChannelsForServer: s.setChannelsForServer,
            setMembersForServer: s.setMembersForServer,
            serverUnreadByChannel: s.serverUnreadByChannel,
            clearServerUnread: s.clearServerUnread,
            mutedServerIds: s.mutedServerIds,
            toggleMutedServer: s.toggleMutedServer,
            voiceStates: s.voiceStates,
            voiceStateServerIds: s.voiceStateServerIds,
        })),
    )

    const serverVoiceCounts = useMemo(() => {
        const counts: Record<string, number> = {}
        for (const [userId, serverId] of Object.entries(voiceStateServerIds)) {
            if (!serverId || !voiceStates[userId]) continue
            counts[serverId] = (counts[serverId] ?? 0) + 1
        }
        return counts
    }, [voiceStateServerIds, voiceStates])
    const serverIdsWithActiveVoice = useMemo(
        () => new Set<string>(Object.keys(serverVoiceCounts)),
        [serverVoiceCounts],
    )
    const serverUnreadCounts = useMemo(() => {
        const counts: Record<string, number> = {}
        for (const server of servers) {
            if (mutedServerIds.includes(server.id)) continue
            const serverChannels = channelsByServerId[server.id] ?? []
            const total = serverChannels.reduce((sum, channel) => sum + (serverUnreadByChannel[channel.id] ?? 0), 0)
            if (total > 0) counts[server.id] = total
        }
        return counts
    }, [channelsByServerId, mutedServerIds, serverUnreadByChannel, servers])
    const effectiveActiveId = displayActiveServerId !== undefined ? displayActiveServerId : activeServerId

    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
    const [draggedServerId, setDraggedServerId] = useState<string | null>(null)
    const [dragOverState, setDragOverState] = useState<{ targetId: string; intent: DragIntent } | null>(null)
    const [orderedServerIds, setOrderedServerIds] = useState<string[]>([])
    const [leaveServerConfirmId, setLeaveServerConfirmId] = useState<string | null>(null)

    const sidebarRef = useRef<HTMLDivElement>(null)
    const prefetchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const dragPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)

    const orderStorageKey = `voxpery-server-order:${user?.id ?? 'guest'}`

    const saveOrder = (next: string[]) => {
        setOrderedServerIds(next)
        localStorage.setItem(orderStorageKey, JSON.stringify(next))
    }

    const getCurrentOrder = () => (orderedServerIds.length > 0 ? [...orderedServerIds] : servers.map((s) => s.id))

    const clearDragUiState = () => {
        setDraggedServerId(null)
        setDragOverState(null)
    }

    const getIntentForServerDrop = (event: React.DragEvent<HTMLElement>): DragIntent => {
        const rect = event.currentTarget.getBoundingClientRect()
        const y = event.clientY - rect.top
        return y < rect.height / 2 ? 'before' : 'after'
    }

    const normalizeLinearDropTarget = (
        targetId: string,
        intent: DragIntent,
    ): { targetId: string; intent: DragIntent } => {
        const order = getCurrentOrder().filter((id) => servers.some((s) => s.id === id))
        if (intent === 'before') return { targetId, intent: 'before' }
        const idx = order.indexOf(targetId)
        if (idx >= 0 && idx < order.length - 1) {
            return { targetId: order[idx + 1], intent: 'before' }
        }
        return { targetId, intent: 'after' }
    }

    const moveServerByOrder = (draggedId: string, targetId: string, intent: DragIntent) => {
        const current = getCurrentOrder().filter((id) => id !== draggedId)
        const targetIdx = current.indexOf(targetId)
        if (targetIdx < 0) return
        const insertIdx = intent === 'before' ? targetIdx : targetIdx + 1
        current.splice(insertIdx, 0, draggedId)
        saveOrder(current)
    }

    const getSidebarDropTarget = (sidebarEl: HTMLElement, clientY: number): { targetId: string; intent: DragIntent } | null => {
        const buttons = Array.from(
            sidebarEl.querySelectorAll<HTMLButtonElement>('.server-icon.is-draggable[data-drop-id]'),
        )
        if (buttons.length === 0) return null

        const first = buttons[0]
        const firstId = first.dataset.dropId
        if (!firstId) return null
        const firstRect = first.getBoundingClientRect()
        if (clientY < firstRect.top) {
            return { targetId: firstId, intent: 'before' }
        }

        for (const button of buttons) {
            const dropId = button.dataset.dropId
            if (!dropId) continue
            const rect = button.getBoundingClientRect()
            const centerY = rect.top + rect.height / 2
            if (clientY <= centerY) {
                return { targetId: dropId, intent: 'before' }
            }
        }

        const last = buttons[buttons.length - 1]
        const lastId = last.dataset.dropId
        if (!lastId) return null
        const lastRect = last.getBoundingClientRect()
        if (clientY > lastRect.bottom + 18) return null
        return { targetId: lastId, intent: 'after' }
    }

    const isNearSidebarBottom = (sidebarEl: HTMLElement, clientY: number) => {
        const rect = sidebarEl.getBoundingClientRect()
        return clientY >= rect.bottom - 44
    }

    const getDropLineClass = (targetId: string) => {
        if (dragOverState?.targetId !== targetId) return ''
        return dragOverState.intent === 'before' ? 'drag-over-before' : 'drag-over-after'
    }

    const suppressDragPreview = (e: React.DragEvent<HTMLElement>) => {
        if (!dragPreviewCanvasRef.current) {
            const canvas = document.createElement('canvas')
            canvas.width = 16
            canvas.height = 16
            const ctx = canvas.getContext('2d')
            if (ctx) ctx.clearRect(0, 0, 16, 16)
            dragPreviewCanvasRef.current = canvas
        }
        e.dataTransfer.setDragImage(dragPreviewCanvasRef.current, 0, 0)
    }

    const getInitial = (name: string) => name.charAt(0).toUpperCase()

    useEffect(() => {
        const fromStorage = localStorage.getItem(orderStorageKey)
        let storedOrder: string[] = []
        try {
            storedOrder = fromStorage ? (JSON.parse(fromStorage) as string[]) : []
        } catch {
            storedOrder = []
        }
        const existingIds = servers.map((s) => s.id)
        if (existingIds.length === 0) {
            if (storedOrder.length > 0) queueMicrotask(() => setOrderedServerIds(storedOrder))
            return
        }
        const merged = [
            ...storedOrder.filter((id) => existingIds.includes(id)),
            ...existingIds.filter((id) => !storedOrder.includes(id)),
        ]
        queueMicrotask(() => setOrderedServerIds(merged))
        localStorage.setItem(orderStorageKey, JSON.stringify(merged))
    }, [orderStorageKey, servers])

    useEffect(() => {
        if (!contextMenu) return
        const close = () => setContextMenu(null)
        window.addEventListener('click', close)
        window.addEventListener('scroll', close, true)
        return () => {
            window.removeEventListener('click', close)
            window.removeEventListener('scroll', close, true)
        }
    }, [contextMenu])

    useEffect(() => {
        if (!draggedServerId) return
        const onWindowDragOver = (event: DragEvent) => {
            const sidebarEl = sidebarRef.current
            if (!sidebarEl) return
            const target = event.target as Node | null
            if (!target || !sidebarEl.contains(target)) return
            event.preventDefault()
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'move'
            }
        }
        window.addEventListener('dragover', onWindowDragOver, true)
        return () => {
            window.removeEventListener('dragover', onWindowDragOver, true)
        }
    }, [draggedServerId])

    useEffect(() => {
        if (!leaveServerConfirmId) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            setLeaveServerConfirmId(null)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [leaveServerConfirmId])

    const orderedServers = (orderedServerIds.length > 0 ? orderedServerIds : servers.map((s) => s.id))
        .map((id) => servers.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => !!s)

    const handleServerMouseEnter = (serverId: string) => {
        prefetchRef.current = window.setTimeout(() => {
            prefetchRef.current = null
            if (!user || channelsByServerId[serverId]?.length) return
            serverApi.channels(serverId, token).then((chs) => setChannelsForServer(serverId, chs)).catch(() => {})
            serverApi.get(serverId, token).then((d) => setMembersForServer(serverId, d.members)).catch(() => {})
        }, PREFETCH_DELAY_MS)
    }

    const handleServerMouseLeave = () => {
        if (prefetchRef.current) {
            window.clearTimeout(prefetchRef.current)
            prefetchRef.current = null
        }
    }

    const handleLeaveServer = async (serverId: string) => {
        setContextMenu(null)
        try {
            await serverApi.leave(serverId, token)
            const list = await serverApi.list(token)
            setServers(list)
            if (activeServerId === serverId) {
                const next = list.find((s) => s.id !== serverId)
                setActiveServer(next?.id ?? null)
            }
        } catch (e) {
            console.error('Leave server failed:', e)
        }
    }

    const handleToggleMuteServer = (serverId: string) => {
        const willMute = !mutedServerIds.includes(serverId)
        toggleMutedServer(serverId)
        if (willMute) {
            const serverChannels = channelsByServerId[serverId] ?? []
            serverChannels.forEach((channel) => clearServerUnread(channel.id))
        }
        setContextMenu(null)
    }

    const leaveServerConfirmTarget = leaveServerConfirmId
        ? servers.find((s) => s.id === leaveServerConfirmId) ?? null
        : null

    const isDraggingSidebar = !!draggedServerId

    const renderServerButton = (server: (typeof servers)[0]) => {
        const isVoiceActive = serverIdsWithActiveVoice.has(server.id)
        const voiceCount = serverVoiceCounts[server.id] ?? 0
        const unreadCount = serverUnreadCounts[server.id] ?? 0
        const dropLineClass = getDropLineClass(server.id)
        const isMuted = mutedServerIds.includes(server.id)
        return (
            <div
                key={server.id}
                className={`server-icon-wrapper ${dropLineClass} ${unreadCount > 0 ? 'has-unread' : ''}`}
            >
                <button
                    type="button"
                    className={`server-icon ${effectiveActiveId === server.id ? 'active' : ''} ${isMuted ? 'is-muted' : ''} is-draggable ${isVoiceActive ? 'has-active-voice' : ''}`}
                    onClick={() => (onSelectServer ? onSelectServer(server.id) : setActiveServer(server.id))}
                    onMouseEnter={() => handleServerMouseEnter(server.id)}
                    onMouseLeave={handleServerMouseLeave}
                    onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setContextMenu({ id: server.id, x: e.clientX, y: e.clientY })
                    }}
                    draggable
                    data-server-id={server.id}
                    data-drop-id={server.id}
                    onDragStart={(e) => {
                        setDraggedServerId(server.id)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', server.id)
                        suppressDragPreview(e)
                    }}
                    onDragOver={(e) => {
                        if (!draggedServerId) return
                        if (draggedServerId === server.id) {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                            setDragOverState((prev) => (prev ? null : prev))
                            return
                        }
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        const intent = getIntentForServerDrop(e)
                        const normalized = normalizeLinearDropTarget(server.id, intent)
                        setDragOverState((prev) =>
                            prev?.targetId === normalized.targetId && prev.intent === normalized.intent
                                ? prev
                                : normalized,
                        )
                    }}
                    onDrop={(e) => {
                        if (!draggedServerId || draggedServerId === server.id) return
                        e.preventDefault()
                        const stateDrop =
                            dragOverState && dragOverState.targetId !== SIDEBAR_END_DROP_ID
                                ? dragOverState
                                : null
                        const fallbackIntent = getIntentForServerDrop(e)
                        const normalized = stateDrop ?? normalizeLinearDropTarget(server.id, fallbackIntent)
                        if (normalized.targetId === draggedServerId) {
                            clearDragUiState()
                            return
                        }
                        moveServerByOrder(draggedServerId, normalized.targetId, normalized.intent)
                        clearDragUiState()
                    }}
                    onDragEnd={clearDragUiState}
                    title={server.name}
                    aria-label={server.name}
                >
                    {server.icon_url ? <img src={server.icon_url} alt={server.name} /> : getInitial(server.name)}
                    {isVoiceActive && (
                        <span
                            className="server-voice-indicator"
                            aria-label={`${voiceCount} user${voiceCount === 1 ? '' : 's'} in voice`}
                            title={voiceCount === 1 ? '1 user in voice' : `${voiceCount} users in voice`}
                        >
                            <Volume2 size={8} strokeWidth={2.4} aria-hidden />
                            <span className="server-voice-indicator-count">{voiceCount > 9 ? '9+' : voiceCount}</span>
                        </span>
                    )}
                    {isMuted && <span className="server-muted-indicator" aria-hidden="true" />}
                </button>
                {unreadCount > 0 && (
                    <span
                        className="server-unread-dot"
                        aria-label={`${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`}
                        title={unreadCount === 1 ? '1 unread message' : `${unreadCount} unread messages`}
                    />
                )}
            </div>
        )
    }

    return (
        <div
            ref={sidebarRef}
            className={`server-sidebar ${isDraggingSidebar ? 'is-dragging' : ''}`}
            onDragOverCapture={(e) => {
                if (!draggedServerId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
            }}
            onDragOver={(e) => {
                if (!draggedServerId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const target = e.target as HTMLElement | null
                if (!target?.closest('.server-icon')) {
                    const nearest = getSidebarDropTarget(e.currentTarget, e.clientY)
                    if (!nearest) {
                        if (!isNearSidebarBottom(e.currentTarget, e.clientY)) {
                            setDragOverState((prev) => (prev ? null : prev))
                            return
                        }
                        setDragOverState((prev) =>
                            prev?.targetId === SIDEBAR_END_DROP_ID && prev.intent === 'after'
                                ? prev
                                : { targetId: SIDEBAR_END_DROP_ID, intent: 'after' },
                        )
                        return
                    }
                    setDragOverState((prev) =>
                        prev?.targetId === nearest.targetId && prev.intent === nearest.intent
                            ? prev
                            : nearest,
                    )
                }
            }}
            onDragLeave={(e) => {
                if (!draggedServerId) return
                const related = e.relatedTarget as Node | null
                if (related && !e.currentTarget.contains(related)) {
                    clearDragUiState()
                }
            }}
            onDrop={(e) => {
                if (!draggedServerId) return
                const target = e.target as HTMLElement | null
                if (target?.closest('.server-icon')) return
                e.preventDefault()

                if (
                    dragOverState &&
                    dragOverState.targetId !== SIDEBAR_END_DROP_ID &&
                    (dragOverState.intent === 'before' || dragOverState.intent === 'after')
                ) {
                    if (dragOverState.targetId !== draggedServerId) {
                        moveServerByOrder(draggedServerId, dragOverState.targetId, dragOverState.intent)
                    }
                    clearDragUiState()
                    return
                }

                const current = getCurrentOrder()
                const next = current.filter((id) => id !== draggedServerId)
                next.push(draggedServerId)
                saveOrder(next)
                clearDragUiState()
            }}
        >
            {serversLoading && orderedServers.length === 0 && (
                <>
                    {Array.from({ length: 3 }).map((_, index) => (
                        <div key={`server-skeleton-${index}`} className="server-icon-wrapper">
                            <div className="server-icon server-icon-skeleton" aria-hidden="true" />
                        </div>
                    ))}
                    <div className="server-separator" />
                </>
            )}
            {orderedServers.map((server) => renderServerButton(server))}

            {draggedServerId && dragOverState?.targetId === SIDEBAR_END_DROP_ID && (
                <div className="server-drop-end-indicator" aria-hidden="true" />
            )}

            <div className="server-separator" />

            <button
                type="button"
                className="server-icon server-add"
                onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onCreateServer()
                }}
                title="Create Server"
                aria-label="Create Server"
            >
                <PlusCircle size={20} />
            </button>
            <div className="server-action-label">Create</div>

            <button
                type="button"
                className="server-icon server-add"
                onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onJoinServer()
                }}
                title="Join Server"
                aria-label="Join Server"
            >
                <LogIn size={18} />
            </button>
            <div className="server-action-label">Join</div>

            {contextMenu && (() => {
                const server = servers.find((s) => s.id === contextMenu.id)
                const isOwner = server && user && server.owner_id === user.id
                if (!server) return null
                return (
                    <div
                        className="server-context-menu"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {isOwner && onOpenServerSettings ? (
                            <button
                                type="button"
                                className="server-context-menu-item"
                                onClick={() => {
                                    setContextMenu(null)
                                    setActiveServer(contextMenu.id)
                                    onOpenServerSettings?.(contextMenu.id)
                                }}
                            >
                                Server Settings
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="server-context-menu-item"
                            onClick={() => handleToggleMuteServer(contextMenu.id)}
                        >
                            <Volume2 size={14} />
                            {mutedServerIds.includes(contextMenu.id) ? 'Unmute Server' : 'Mute Server'}
                        </button>
                        <button
                            type="button"
                            className="server-context-menu-item danger"
                            onClick={() => {
                                setContextMenu(null)
                                setLeaveServerConfirmId(contextMenu.id)
                            }}
                        >
                            <LogOut size={14} />
                            Leave Server
                        </button>
                    </div>
                )
            })()}

            {leaveServerConfirmTarget && (
                <div className="modal-overlay" onClick={() => setLeaveServerConfirmId(null)}>
                    <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Leave server</h2>
                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                            Are you sure you want to leave <strong>{leaveServerConfirmTarget.name}</strong>?
                        </p>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setLeaveServerConfirmId(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={async () => {
                                    await handleLeaveServer(leaveServerConfirmTarget.id)
                                    setLeaveServerConfirmId(null)
                                }}
                            >
                                Leave Server
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
