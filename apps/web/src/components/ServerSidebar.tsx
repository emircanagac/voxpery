import { useMemo, useState, useRef, useEffect } from 'react'
import { PlusCircle, LogIn, LogOut, Users } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { serverApi } from '../api'

interface ServerSidebarProps {
    onCreateServer: () => void
    onJoinServer: () => void
    onOpenServerSettings?: (serverId: string) => void
    /** When set, clicking a server calls this instead of only setActiveServer (e.g. to navigate to /app/servers/:id). */
    onSelectServer?: (serverId: string) => void
    /** When set, only this server id shows as active (for unified sidebar: only highlight server when on server route). */
    displayActiveServerId?: string | null
}

const PREFETCH_DELAY_MS = 120

type ServerFolder = {
    id: string
    name: string
    emoji?: string
    colorToken?: FolderColorToken
    serverIds: string[]
}

type FolderColorToken = 'accent' | 'danger' | 'warning' | 'secondary'
type DragIntent = 'group' | 'before' | 'after' | 'folder'

const FOLDER_COLOR_OPTIONS: Array<{ token: FolderColorToken; label: string }> = [
    { token: 'accent', label: 'Accent' },
    { token: 'danger', label: 'Danger' },
    { token: 'warning', label: 'Warning' },
    { token: 'secondary', label: 'Secondary' },
]

const FOLDER_EMOJI_OPTIONS = ['📁', '🔥', '🎮', '💼', '🎧', '🧠', '🎯', '⭐'] as const
const SIDEBAR_END_DROP_ID = '__sidebar-end-drop__'

const folderColorToCssVar = (token: FolderColorToken | undefined) => {
    switch (token) {
        case 'danger':
            return 'var(--text-danger)'
        case 'warning':
            return 'var(--text-warning)'
        case 'secondary':
            return 'var(--text-secondary)'
        case 'accent':
        default:
            return 'var(--accent-primary)'
    }
}

export default function ServerSidebar({ onCreateServer, onJoinServer, onOpenServerSettings, onSelectServer, displayActiveServerId }: ServerSidebarProps) {
    const { user, token } = useAuthStore()
    const { servers, activeServerId, setActiveServer, setServers, channelsByServerId, setChannelsForServer, setMembersForServer, voiceStateServerIds } = useAppStore(
        useShallow((s) => ({
            servers: s.servers,
            activeServerId: s.activeServerId,
            setActiveServer: s.setActiveServer,
            setServers: s.setServers,
            channelsByServerId: s.channelsByServerId,
            setChannelsForServer: s.setChannelsForServer,
            setMembersForServer: s.setMembersForServer,
            voiceStateServerIds: s.voiceStateServerIds,
        }))
    )
    const serverIdsWithActiveVoice = useMemo(
        () => new Set<string>(Object.values(voiceStateServerIds).filter((id): id is string => !!id)),
        [voiceStateServerIds]
    )
    const effectiveActiveId = displayActiveServerId !== undefined ? displayActiveServerId : activeServerId
    const [contextMenu, setContextMenu] = useState<
        | { kind: 'server'; id: string; x: number; y: number }
        | { kind: 'folder'; id: string; x: number; y: number }
        | null
    >(null)
    const [folderEditPopover, setFolderEditPopover] = useState<{
        folderId: string
        x: number
        y: number
        name: string
        emoji: string
        colorToken: FolderColorToken
    } | null>(null)
    const [draggedServerId, setDraggedServerId] = useState<string | null>(null)
    const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null)
    const [dragOverState, setDragOverState] = useState<{ targetId: string; intent: DragIntent } | null>(null)
    const [orderedServerIds, setOrderedServerIds] = useState<string[]>([])
    const [folders, setFolders] = useState<ServerFolder[]>([])
    const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([])
    const menuRef = useRef<HTMLDivElement>(null)
    const orderStorageKey = `voxpery-server-order:${user?.id ?? 'guest'}`
    const foldersStorageKey = `voxpery-server-folders:${user?.id ?? 'guest'}`

    useEffect(() => {
        try {
            const raw = localStorage.getItem(foldersStorageKey)
            if (!raw) {
                queueMicrotask(() => setFolders([]))
                return
            }
            const parsed = JSON.parse(raw)
            if (!Array.isArray(parsed)) {
                queueMicrotask(() => setFolders([]))
                return
            }
            const normalized: ServerFolder[] = parsed
                .map((f) => ({
                    id: typeof f?.id === 'string' ? f.id : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    name: typeof f?.name === 'string' && f.name.trim() ? f.name : 'Folder',
                    emoji: typeof f?.emoji === 'string' && f.emoji.trim() ? f.emoji : '📁',
                    colorToken: f?.colorToken === 'danger' || f?.colorToken === 'warning' || f?.colorToken === 'secondary' || f?.colorToken === 'accent'
                        ? f.colorToken
                        : 'accent',
                    serverIds: Array.isArray(f?.serverIds) ? f.serverIds.filter((x: unknown): x is string => typeof x === 'string') : [],
                }))
                .filter((f) => f.serverIds.length > 0)
            queueMicrotask(() => setFolders(normalized))
        } catch {
            queueMicrotask(() => setFolders([]))
        }
    }, [foldersStorageKey])

    const saveFolders = (next: ServerFolder[]) => {
        setFolders(next)
        localStorage.setItem(foldersStorageKey, JSON.stringify(next))
    }

    const saveOrder = (next: string[]) => {
        setOrderedServerIds(next)
        localStorage.setItem(orderStorageKey, JSON.stringify(next))
    }

    const findFolderForServer = (serverId: string) => folders.find((f) => f.serverIds.includes(serverId))

    const moveServerToFolder = (serverId: string, folderId: string) => {
        const current = findFolderForServer(serverId)
        let next = folders.map((f) => ({ ...f, serverIds: f.serverIds.filter((id) => id !== serverId) }))
        next = next
            .map((f) => (f.id === folderId ? { ...f, serverIds: [...f.serverIds, serverId] } : f))
            .filter((f) => f.serverIds.length > 0)
        saveFolders(next)
        if (!expandedFolderIds.includes(folderId)) {
            setExpandedFolderIds((prev) => [...prev, folderId])
        }
        if (current?.id && current.id !== folderId && !next.some((f) => f.id === current.id)) {
            setExpandedFolderIds((prev) => prev.filter((id) => id !== current.id))
        }
    }

    const moveServerToNewFolder = (serverId: string) => {
        const nextFolderIndex =
            folders.reduce((max, folder) => {
                const m = folder.id.match(/^folder-(\d+)$/)
                const n = m ? Number(m[1]) : 0
                return Number.isFinite(n) ? Math.max(max, n) : max
            }, 0) + 1
        const folderName = `Folder ${folders.length + 1}`
        const folderId = `folder-${nextFolderIndex}`
        const cleaned = folders
            .map((f) => ({ ...f, serverIds: f.serverIds.filter((id) => id !== serverId) }))
            .filter((f) => f.serverIds.length > 0)
        const next = [...cleaned, { id: folderId, name: folderName, emoji: '📁', colorToken: 'accent' as const, serverIds: [serverId] }]
        saveFolders(next)
        setExpandedFolderIds((prev) => [...prev, folderId])
    }

    const removeServerFromFolder = (serverId: string) => {
        const next = folders
            .map((f) => ({ ...f, serverIds: f.serverIds.filter((id) => id !== serverId) }))
            .filter((f) => f.serverIds.length > 0)
        saveFolders(next)
    }

    const deleteFolder = (folderId: string) => {
        const next = folders.filter((f) => f.id !== folderId)
        saveFolders(next)
        setExpandedFolderIds((prev) => prev.filter((id) => id !== folderId))
    }

    const updateFolder = (folderId: string, updates: Partial<Pick<ServerFolder, 'name' | 'emoji' | 'colorToken'>>) => {
        const next = folders.map((f) => (f.id === folderId ? { ...f, ...updates } : f))
        saveFolders(next)
    }

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
        if (!folderEditPopover) return
        const close = () => setFolderEditPopover(null)
        window.addEventListener('click', close)
        window.addEventListener('scroll', close, true)
        return () => {
            window.removeEventListener('click', close)
            window.removeEventListener('scroll', close, true)
        }
    }, [folderEditPopover])

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
        // When servers not loaded yet (e.g. after F5), do not overwrite stored order with []
        if (existingIds.length === 0) {
            if (storedOrder.length > 0) queueMicrotask(() => setOrderedServerIds(storedOrder))
            return
        }
        const merged = [...storedOrder.filter((id) => existingIds.includes(id)), ...existingIds.filter((id) => !storedOrder.includes(id))]
        queueMicrotask(() => setOrderedServerIds(merged))
        localStorage.setItem(orderStorageKey, JSON.stringify(merged))
    }, [orderStorageKey, servers])

    const orderedServers = (orderedServerIds.length > 0 ? orderedServerIds : servers.map((s) => s.id))
        .map((id) => servers.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => !!s)

    const folderEntries = folders
        .map((folder) => ({
            folder,
            servers: folder.serverIds
                .map((id) => servers.find((s) => s.id === id))
                .filter((s): s is NonNullable<typeof s> => !!s),
        }))
        .filter((entry) => entry.servers.length > 0)

    const getCurrentOrder = () =>
        orderedServerIds.length > 0 ? [...orderedServerIds] : servers.map((s) => s.id)

    const getFolderIdForServer = (serverId: string, sourceFolders = folders) =>
        sourceFolders.find((f) => f.serverIds.includes(serverId))?.id ?? null

    const normalizeFoldersByOrder = (sourceFolders: ServerFolder[], order: string[]) => {
        const idx = new Map(order.map((id, i) => [id, i]))
        return sourceFolders
            .map((f) => ({
                ...f,
                serverIds: [...f.serverIds]
                    .sort((a, b) => (idx.get(a) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b) ?? Number.MAX_SAFE_INTEGER)),
            }))
            .filter((f) => f.serverIds.length > 0)
    }

    const moveServerByOrder = (draggedId: string, targetId: string, intent: 'before' | 'after') => {
        const current = getCurrentOrder().filter((id) => id !== draggedId)
        const targetIdx = current.indexOf(targetId)
        if (targetIdx < 0) return
        const insertIdx = intent === 'before' ? targetIdx : targetIdx + 1
        current.splice(insertIdx, 0, draggedId)
        saveOrder(current)

        const sourceFolderId = getFolderIdForServer(draggedId)
        const targetFolderId = getFolderIdForServer(targetId)
        let nextFolders = folders.map((f) => ({ ...f, serverIds: f.serverIds.filter((id) => id !== draggedId) }))
        if (targetFolderId) {
            nextFolders = nextFolders.map((f) =>
                f.id === targetFolderId ? { ...f, serverIds: [...f.serverIds, draggedId] } : f,
            )
        }
        if (sourceFolderId || targetFolderId) {
            saveFolders(normalizeFoldersByOrder(nextFolders, current))
        }
    }

    const moveServerByOrderUngrouped = (draggedId: string, targetId: string, intent: 'before' | 'after') => {
        const current = getCurrentOrder().filter((id) => id !== draggedId)
        const targetIdx = current.indexOf(targetId)
        if (targetIdx < 0) return
        const insertIdx = intent === 'before' ? targetIdx : targetIdx + 1
        current.splice(insertIdx, 0, draggedId)
        saveOrder(current)

        const nextFolders = normalizeFoldersByOrder(
            folders.map((f) => ({
                ...f,
                serverIds: f.serverIds.filter((id) => id !== draggedId),
            })),
            current,
        )
        saveFolders(nextFolders)
    }

    const moveFolderByOrder = (folderId: string, targetId: string, intent: 'before' | 'after') => {
        const folder = folders.find((f) => f.id === folderId)
        if (!folder || folder.serverIds.length === 0) return

        const currentOrder = getCurrentOrder()
        const folderBlock = currentOrder.filter((id) => folder.serverIds.includes(id))
        if (folderBlock.length === 0) return
        if (folderBlock.includes(targetId)) return

        const compact = currentOrder.filter((id) => !folderBlock.includes(id))
        const targetIdx = compact.indexOf(targetId)
        if (targetIdx < 0) return

        const insertIdx = intent === 'before' ? targetIdx : targetIdx + 1
        compact.splice(insertIdx, 0, ...folderBlock)
        saveOrder(compact)
        saveFolders(normalizeFoldersByOrder(folders, compact))
    }

    const moveFolderToEnd = (folderId: string) => {
        const folder = folders.find((f) => f.id === folderId)
        if (!folder || folder.serverIds.length === 0) return
        const currentOrder = getCurrentOrder()
        const folderBlock = currentOrder.filter((id) => folder.serverIds.includes(id))
        if (folderBlock.length === 0) return
        const compact = currentOrder.filter((id) => !folderBlock.includes(id))
        const next = [...compact, ...folderBlock]
        saveOrder(next)
        saveFolders(normalizeFoldersByOrder(folders, next))
    }

    const createFolderFromTwoServers = (firstId: string, secondId: string) => {
        if (firstId === secondId) return
        const nextFolderIndex =
            folders.reduce((max, folder) => {
                const m = folder.id.match(/^folder-(\d+)$/)
                const n = m ? Number(m[1]) : 0
                return Number.isFinite(n) ? Math.max(max, n) : max
            }, 0) + 1
        const folderId = `folder-${nextFolderIndex}`
        const cleaned = folders
            .map((f) => ({ ...f, serverIds: f.serverIds.filter((id) => id !== firstId && id !== secondId) }))
            .filter((f) => f.serverIds.length > 0)

        const current = getCurrentOrder()
        const idxA = current.indexOf(firstId)
        const idxB = current.indexOf(secondId)
        const pair = idxA <= idxB ? [firstId, secondId] : [secondId, firstId]
        const next = [...cleaned, { id: folderId, name: `Folder ${cleaned.length + 1}`, emoji: '📁', colorToken: 'accent' as const, serverIds: pair }]
        saveFolders(next)
        setExpandedFolderIds((prev) => [...new Set([...prev, folderId])])
    }

    const clearDragUiState = () => {
        setDraggedServerId(null)
        setDraggedFolderId(null)
        setDragOverState(null)
    }

    const getSidebarDropTarget = (sidebarEl: HTMLElement, clientY: number): { targetId: string; intent: 'before' | 'after' } | null => {
        const buttons = Array.from(
            sidebarEl.querySelectorAll<HTMLButtonElement>('.server-icon.is-draggable[data-server-id]')
        ).filter((button) => !button.classList.contains('server-icon-nested'))
        if (buttons.length === 0) return null

        const first = buttons[0]
        const firstId = first.dataset.serverId
        if (!firstId) return null
        const firstRect = first.getBoundingClientRect()
        if (clientY < firstRect.top) {
            return { targetId: firstId, intent: 'before' }
        }

        for (const button of buttons) {
            const serverId = button.dataset.serverId
            if (!serverId) continue
            const rect = button.getBoundingClientRect()
            const centerY = rect.top + rect.height / 2
            if (clientY <= centerY) {
                return { targetId: serverId, intent: 'before' }
            }
        }

        const last = buttons[buttons.length - 1]
        const lastId = last.dataset.serverId
        if (!lastId) return null
        return { targetId: lastId, intent: 'after' }
    }

    const getIntentForServerDrop = (event: React.DragEvent<HTMLElement>): Exclude<DragIntent, 'folder'> => {
        const rect = event.currentTarget.getBoundingClientRect()
        const y = event.clientY - rect.top
        const topZone = rect.height * 0.28
        const bottomZone = rect.height * 0.72
        if (y < topZone) return 'before'
        if (y > bottomZone) return 'after'
        return 'group'
    }

    const resolveDropTargetServerId = (targetId: string): string | null => {
        if (servers.some((s) => s.id === targetId)) return targetId
        const folder = folders.find((f) => f.id === targetId)
        return folder?.serverIds[0] ?? null
    }

    const getFolderBoundaryServerId = (folderId: string, edge: 'before' | 'after'): string | null => {
        const folder = folders.find((f) => f.id === folderId)
        if (!folder || folder.serverIds.length === 0) return null
        const order = getCurrentOrder()
        const inOrder = order.filter((id) => folder.serverIds.includes(id))
        if (inOrder.length === 0) return null
        return edge === 'before' ? inOrder[0] : inOrder[inOrder.length - 1]
    }

    const renderServerButton = (server: (typeof servers)[0], nested = false) => {
        const isVoiceActive = serverIdsWithActiveVoice.has(server.id)
        return (
            <div key={server.id} className="server-icon-wrapper">
                <button
                    type="button"
                    className={`server-icon ${effectiveActiveId === server.id ? 'active' : ''} is-draggable ${nested ? 'server-icon-nested' : ''} ${dragOverState?.targetId === server.id ? `drag-over-${dragOverState.intent}` : ''} ${isVoiceActive ? 'has-active-voice' : ''}`}
                    onClick={() => (onSelectServer ? onSelectServer(server.id) : setActiveServer(server.id))}
                    onMouseEnter={() => handleServerMouseEnter(server.id)}
                    onMouseLeave={handleServerMouseLeave}
                    onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setContextMenu({ kind: 'server', id: server.id, x: e.clientX, y: e.clientY })
                    }}
                    draggable
                    data-server-id={server.id}
                    onDragStart={(e) => {
                        setDraggedServerId(server.id)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', server.id)
                    }}
                    onDragOver={(e) => {
                        if (!draggedServerId || draggedServerId === server.id) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        const baseIntent = getIntentForServerDrop(e)
                        const intent =
                            draggedFolderId && baseIntent === 'group'
                                ? (e.clientY - e.currentTarget.getBoundingClientRect().top < e.currentTarget.getBoundingClientRect().height / 2 ? 'before' : 'after')
                                : baseIntent
                        setDragOverState((prev) =>
                            prev?.targetId === server.id && prev.intent === intent
                                ? prev
                                : { targetId: server.id, intent },
                        )
                    }}
                    onDragLeave={(e) => {
                        e.stopPropagation()
                        if (dragOverState?.targetId === server.id) {
                            setDragOverState(null)
                        }
                    }}
                    onDrop={(e) => {
                        if (!draggedServerId || draggedServerId === server.id) return
                        e.preventDefault()
                        const baseIntent = getIntentForServerDrop(e)
                        const intent =
                            draggedFolderId && baseIntent === 'group'
                                ? (e.clientY - e.currentTarget.getBoundingClientRect().top < e.currentTarget.getBoundingClientRect().height / 2 ? 'before' : 'after')
                                : baseIntent
                        if (draggedFolderId) {
                            if (intent === 'before' || intent === 'after') {
                                moveFolderByOrder(draggedFolderId, server.id, intent)
                            }
                            clearDragUiState()
                            return
                        }
                        if (intent === 'group') {
                            const draggedFolderId = getFolderIdForServer(draggedServerId)
                            const targetFolderId = getFolderIdForServer(server.id)
                            if (!draggedFolderId && !targetFolderId) {
                                createFolderFromTwoServers(draggedServerId, server.id)
                            } else if (targetFolderId && draggedFolderId !== targetFolderId) {
                                moveServerToFolder(draggedServerId, targetFolderId)
                            } else if (!targetFolderId && draggedFolderId) {
                                createFolderFromTwoServers(draggedServerId, server.id)
                            }
                            clearDragUiState()
                            return
                        }
                        moveServerByOrder(draggedServerId, server.id, intent)
                        clearDragUiState()
                    }}
                    onDragEnd={clearDragUiState}
                    title={server.name}
                    aria-label={server.name}
                >
                    {server.icon_url ? (
                        <img src={server.icon_url} alt={server.name} />
                    ) : (
                        getInitial(server.name)
                    )}
                </button>
                {isVoiceActive && (
                    <span className="server-voice-indicator" aria-label="Sesli sohbet aktif" title="Sesli sohbette biri var">
                        <Users size={10} strokeWidth={3} aria-hidden />
                    </span>
                )}
            </div>
        )
    }
    const prefetchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const handleServerMouseEnter = (serverId: string) => {
        prefetchRef.current = window.setTimeout(() => {
            prefetchRef.current = null
            if (!user || channelsByServerId[serverId]?.length) return
            serverApi.channels(serverId, token).then((chs) => setChannelsForServer(serverId, chs)).catch(() => { })
            serverApi.get(serverId, token).then((d) => setMembersForServer(serverId, d.members)).catch(() => { })
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

    const renderFolderEntry = (folder: ServerFolder, folderServers: Array<(typeof servers)[0]>) => {
        const expanded = expandedFolderIds.includes(folder.id)
        const folderLeadServerId = folderServers[0]?.id ?? null
        const isVoiceActive = folder.serverIds.some((id) => serverIdsWithActiveVoice.has(id))

        return (
            <div
                key={folder.id}
                className="server-folder-wrap"
                style={{
                    ['--folder-accent' as string]: folderColorToCssVar(folder.colorToken),
                } as React.CSSProperties}
                onContextMenu={(e) => {
                    if ((e.target as HTMLElement | null)?.closest('.server-icon.is-draggable')) {
                        return
                    }
                    e.preventDefault()
                    setContextMenu({ kind: 'folder', id: folder.id, x: e.clientX, y: e.clientY })
                }}
            >
                <button
                    type="button"
                    className={`server-icon server-folder-icon is-draggable ${expanded ? 'active' : ''} ${dragOverState?.targetId === folder.id ? `drag-over-${dragOverState.intent}` : ''} ${isVoiceActive ? 'has-active-voice' : ''}`}
                    data-server-id={folderLeadServerId ?? undefined}
                    onClick={() => {
                        setExpandedFolderIds((prev) =>
                            prev.includes(folder.id)
                                ? prev.filter((id) => id !== folder.id)
                                : [...prev, folder.id]
                        )
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenu({ kind: 'folder', id: folder.id, x: e.clientX, y: e.clientY })
                    }}
                    draggable={!!folderLeadServerId}
                    onDragStart={(e) => {
                        if (!folderLeadServerId) return
                        setDraggedServerId(folderLeadServerId)
                        setDraggedFolderId(folder.id)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', folderLeadServerId)
                    }}
                    onDragOver={(e) => {
                        if (!draggedServerId) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'

                        if (draggedFolderId) {
                            const baseIntent = getIntentForServerDrop(e)
                            const intent =
                                baseIntent === 'group'
                                    ? (e.clientY - e.currentTarget.getBoundingClientRect().top < e.currentTarget.getBoundingClientRect().height / 2 ? 'before' : 'after')
                                    : baseIntent
                            setDragOverState((prev) =>
                                prev?.targetId === folder.id && prev.intent === intent
                                    ? prev
                                    : { targetId: folder.id, intent },
                            )
                            return
                        }

                        const baseIntent = getIntentForServerDrop(e)
                        if (baseIntent === 'before' || baseIntent === 'after') {
                            setDragOverState((prev) =>
                                prev?.targetId === folder.id && prev.intent === baseIntent
                                    ? prev
                                    : { targetId: folder.id, intent: baseIntent },
                            )
                            return
                        }

                        setDragOverState((prev) =>
                            prev?.targetId === folder.id && prev.intent === 'folder'
                                ? prev
                                : { targetId: folder.id, intent: 'folder' },
                        )
                    }}
                    onDrop={(e) => {
                        if (!draggedServerId) return
                        e.preventDefault()

                        if (draggedFolderId) {
                            if (draggedFolderId !== folder.id && folderLeadServerId) {
                                const baseIntent = getIntentForServerDrop(e)
                                const intent =
                                    baseIntent === 'group'
                                        ? (e.clientY - e.currentTarget.getBoundingClientRect().top < e.currentTarget.getBoundingClientRect().height / 2 ? 'before' : 'after')
                                        : baseIntent
                                if (intent === 'before' || intent === 'after') {
                                    moveFolderByOrder(draggedFolderId, folderLeadServerId, intent)
                                }
                            }
                            clearDragUiState()
                            return
                        }

                        const baseIntent = getIntentForServerDrop(e)
                        if (baseIntent === 'before' || baseIntent === 'after') {
                            const boundaryServerId = getFolderBoundaryServerId(folder.id, baseIntent)
                            if (boundaryServerId) {
                                moveServerByOrderUngrouped(draggedServerId, boundaryServerId, baseIntent)
                            }
                            clearDragUiState()
                            return
                        }

                        moveServerToFolder(draggedServerId, folder.id)
                        clearDragUiState()
                    }}
                    onDragLeave={() => {
                        if (dragOverState?.targetId === folder.id) {
                            setDragOverState(null)
                        }
                    }}
                    onDragEnd={clearDragUiState}
                    title={folder.name}
                    aria-label={folder.name}
                >
                    <span className="server-folder-emoji">{folder.emoji || '📁'}</span>
                    {isVoiceActive && (
                    <span className="server-voice-indicator" aria-label="Sesli sohbet aktif" title="Sesli sohbette biri var">
                        <Users size={10} strokeWidth={3} aria-hidden />
                    </span>
                )}
                </button>
                {expanded && (
                    <div className="server-folder-children">
                        {folderServers.map((server) => renderServerButton(server, true))}
                    </div>
                )}
            </div>
        )
    }

    const orderedIds = orderedServers.map((s) => s.id)
    const serverById = new Map(servers.map((s) => [s.id, s] as const))
    const folderEntryById = new Map(folderEntries.map((entry) => [entry.folder.id, entry] as const))
    const seenFolderIds = new Set<string>()
    const orderedRenderItems: Array<
        | { kind: 'server'; server: (typeof servers)[0] }
        | { kind: 'folder'; folder: ServerFolder; servers: Array<(typeof servers)[0]> }
    > = []

    for (const serverId of orderedIds) {
        const server = serverById.get(serverId)
        if (!server) continue
        const folderId = getFolderIdForServer(server.id)
        if (!folderId) {
            orderedRenderItems.push({ kind: 'server', server })
            continue
        }
        if (seenFolderIds.has(folderId)) continue
        const entry = folderEntryById.get(folderId)
        if (!entry) continue
        seenFolderIds.add(folderId)
        orderedRenderItems.push({ kind: 'folder', folder: entry.folder, servers: entry.servers })
    }

    for (const entry of folderEntries) {
        if (!seenFolderIds.has(entry.folder.id)) {
            orderedRenderItems.push({ kind: 'folder', folder: entry.folder, servers: entry.servers })
        }
    }

    return (
        <div
            className="server-sidebar"
            onDragOver={(e) => {
                if (!draggedServerId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const target = e.target as HTMLElement | null
                if (!target?.closest('.server-icon')) {
                    const nearest = getSidebarDropTarget(e.currentTarget, e.clientY)
                    if (!nearest) {
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

                if (draggedFolderId) {
                    if (
                        dragOverState &&
                        dragOverState.targetId !== SIDEBAR_END_DROP_ID &&
                        (dragOverState.intent === 'before' || dragOverState.intent === 'after')
                    ) {
                        const targetServerId = resolveDropTargetServerId(dragOverState.targetId)
                        if (targetServerId) {
                            moveFolderByOrder(draggedFolderId, targetServerId, dragOverState.intent)
                            clearDragUiState()
                            return
                        }
                    }
                    moveFolderToEnd(draggedFolderId)
                    clearDragUiState()
                    return
                }

                if (
                    dragOverState &&
                    dragOverState.targetId !== SIDEBAR_END_DROP_ID &&
                    (dragOverState.intent === 'before' || dragOverState.intent === 'after')
                ) {
                    moveServerByOrderUngrouped(draggedServerId, dragOverState.targetId, dragOverState.intent)
                    clearDragUiState()
                    return
                }

                if (findFolderForServer(draggedServerId)) {
                    removeServerFromFolder(draggedServerId)
                }
                const current = getCurrentOrder()
                const next = current.filter((id) => id !== draggedServerId)
                next.push(draggedServerId)
                saveOrder(next)
                clearDragUiState()
            }}
        >
            {orderedRenderItems.map((item) =>
                item.kind === 'server'
                    ? renderServerButton(item.server)
                    : renderFolderEntry(item.folder, item.servers)
            )}

            {draggedServerId && dragOverState?.targetId === SIDEBAR_END_DROP_ID && (
                <div className="server-drop-end-indicator" aria-hidden="true" />
            )}

            <div className="server-separator" />

            <button
                type="button"
                className="server-icon server-add"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCreateServer(); }}
                title="Create Server"
                aria-label="Create Server"
            >
                <PlusCircle size={20} />
            </button>
            <div className="server-action-label">Create</div>

            <button
                type="button"
                className="server-icon server-add"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onJoinServer(); }}
                title="Join Server"
                aria-label="Join Server"
            >
                <LogIn size={18} />
            </button>
            <div className="server-action-label">Join</div>

            {contextMenu && (() => {
                if (contextMenu.kind === 'folder') {
                    const folder = folders.find((f) => f.id === contextMenu.id)
                    if (!folder) return null
                    return (
                        <div
                            ref={menuRef}
                            className="server-context-menu"
                            style={{ left: contextMenu.x, top: contextMenu.y }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                type="button"
                                className="server-context-menu-item"
                                onClick={() => {
                                    setFolderEditPopover({
                                        folderId: folder.id,
                                        x: contextMenu.x + 8,
                                        y: contextMenu.y + 8,
                                        name: folder.name,
                                        emoji: folder.emoji || '📁',
                                        colorToken: folder.colorToken || 'accent',
                                    })
                                    setContextMenu(null)
                                }}
                            >
                                Edit Folder
                            </button>
                            <button
                                type="button"
                                className="server-context-menu-item danger"
                                onClick={() => {
                                    deleteFolder(folder.id)
                                    setContextMenu(null)
                                }}
                            >
                                Delete Folder
                            </button>
                        </div>
                    )
                }

                const server = servers.find((s) => s.id === contextMenu.id)
                const isOwner = server && user && server.owner_id === user.id
                if (!server) return null
                return (
                    <div
                        ref={menuRef}
                        className="server-context-menu"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {(() => {
                            const inFolder = findFolderForServer(contextMenu.id)
                            return (
                                <>
                                    {inFolder ? (
                                        <button
                                            type="button"
                                            className="server-context-menu-item"
                                            onClick={() => {
                                                setFolderEditPopover({
                                                    folderId: inFolder.id,
                                                    x: contextMenu.x + 8,
                                                    y: contextMenu.y + 8,
                                                    name: inFolder.name,
                                                    emoji: inFolder.emoji || '📁',
                                                    colorToken: inFolder.colorToken || 'accent',
                                                })
                                                setContextMenu(null)
                                            }}
                                        >
                                            Edit Parent Folder
                                        </button>
                                    ) : null}

                                    {inFolder ? (
                                        <button
                                            type="button"
                                            className="server-context-menu-item"
                                            onClick={() => {
                                                removeServerFromFolder(contextMenu.id)
                                                setContextMenu(null)
                                            }}
                                        >
                                            Remove from folder
                                        </button>
                                    ) : null}

                                    {folders
                                        .filter((f) => !f.serverIds.includes(contextMenu.id))
                                        .map((f) => (
                                            <button
                                                key={`move-${f.id}`}
                                                type="button"
                                                className="server-context-menu-item"
                                                onClick={() => {
                                                    moveServerToFolder(contextMenu.id, f.id)
                                                    setContextMenu(null)
                                                }}
                                            >
                                                Move to {f.name}
                                            </button>
                                        ))}

                                    <button
                                        type="button"
                                        className="server-context-menu-item"
                                        onClick={() => {
                                            moveServerToNewFolder(contextMenu.id)
                                            setContextMenu(null)
                                        }}
                                    >
                                        Move to new folder
                                    </button>
                                </>
                            )
                        })()}

                        {isOwner ? (
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
                        ) : (
                            <button
                                type="button"
                                className="server-context-menu-item danger"
                                onClick={() => handleLeaveServer(contextMenu.id)}
                            >
                                <LogOut size={14} />
                                Leave Server
                            </button>
                        )}
                    </div>
                )
            })()}

            {folderEditPopover && (
                <div
                    className="server-folder-rename-popover"
                    style={{ left: folderEditPopover.x, top: folderEditPopover.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <input
                        type="text"
                        value={folderEditPopover.name}
                        onChange={(e) => setFolderEditPopover((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                        className="server-folder-rename-input"
                        maxLength={32}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const trimmed = folderEditPopover.name.trim()
                                if (trimmed) {
                                    updateFolder(folderEditPopover.folderId, {
                                        name: trimmed,
                                        emoji: folderEditPopover.emoji,
                                        colorToken: folderEditPopover.colorToken,
                                    })
                                }
                                setFolderEditPopover(null)
                            }
                            if (e.key === 'Escape') {
                                setFolderEditPopover(null)
                            }
                        }}
                    />
                    <div className="server-folder-emoji-grid">
                        {FOLDER_EMOJI_OPTIONS.map((emoji) => (
                            <button
                                key={emoji}
                                type="button"
                                className={`server-folder-emoji-btn ${folderEditPopover.emoji === emoji ? 'active' : ''}`}
                                onClick={() => setFolderEditPopover((prev) => (prev ? { ...prev, emoji } : prev))}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                    <div className="server-folder-color-row">
                        {FOLDER_COLOR_OPTIONS.map((opt) => (
                            <button
                                key={opt.token}
                                type="button"
                                className={`server-folder-color-btn ${folderEditPopover.colorToken === opt.token ? 'active' : ''}`}
                                style={{ ['--folder-color' as string]: folderColorToCssVar(opt.token) } as React.CSSProperties}
                                title={opt.label}
                                onClick={() => setFolderEditPopover((prev) => (prev ? { ...prev, colorToken: opt.token } : prev))}
                            />
                        ))}
                    </div>
                    <div className="server-folder-rename-actions">
                        <button
                            type="button"
                            className="server-context-menu-item"
                            onClick={() => {
                                const trimmed = folderEditPopover.name.trim()
                                if (trimmed) {
                                    updateFolder(folderEditPopover.folderId, {
                                        name: trimmed,
                                        emoji: folderEditPopover.emoji,
                                        colorToken: folderEditPopover.colorToken,
                                    })
                                }
                                setFolderEditPopover(null)
                            }}
                        >
                            Save
                        </button>
                        <button
                            type="button"
                            className="server-context-menu-item"
                            onClick={() => setFolderEditPopover(null)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
