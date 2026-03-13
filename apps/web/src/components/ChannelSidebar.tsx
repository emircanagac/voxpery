import { Hash, Volume2, ChevronDown, Plus, MicOff, VolumeX, Monitor, Video } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { friendApi } from '../api'
import type { Channel } from '../api'
import { useToastStore } from '../stores/toast'
import { preloadRnnoiseWorklet } from '../webrtc/rnnoise'

const VOICE_JOIN_CONFIRM_KEY = 'voxpery-settings-voice-join-confirm'
const SETTINGS_CHANGED_EVENT = 'voxpery-voice-settings-changed'
type ManualJoinWindow = Window & { __voxperyManualJoinActive?: boolean }

interface ChannelSidebarProps {
    onOpenServerSettings: () => void
    onOpenCreateChannel?: () => void
    onOpenCreateCategory?: () => void
    onOpenCategoryPermissions?: (category: string) => void
    onRenameCategory?: (category: string) => void
    onDeleteCategory?: (category: string) => void
    onReorderCategories?: (draggedCategory: string, targetCategory: string, position: 'before' | 'after') => void
    onMoveChannelToCategory?: (channelId: string, targetCategory: string, placement?: 'start' | 'end') => void
    channelCategories?: string[]
    canManageChannels?: boolean
    unreadByChannel?: Record<string, number>
    voiceControls?: Record<string, { muted: boolean; deafened: boolean; screenSharing: boolean; cameraOn?: boolean }>
    onRenameChannel?: (channel: Channel) => void
    onDeleteChannel?: (channel: Channel) => void
    onReorderChannels?: (draggedChannelId: string, targetChannelId: string, position: 'before' | 'after') => void
}

export default function ChannelSidebar({
    onOpenServerSettings,
    onOpenCreateChannel,
    onOpenCreateCategory,
    onOpenCategoryPermissions,
    onRenameCategory,
    onDeleteCategory,
    onReorderCategories,
    onMoveChannelToCategory,
    channelCategories = [],
    canManageChannels,
    unreadByChannel = {},
    voiceControls = {},
    onRenameChannel,
    onDeleteChannel,
    onReorderChannels,
}: ChannelSidebarProps) {
    const channelTypeOrder = (type: Channel['channel_type']) => (type === 'text' ? 0 : 1)
    const { user, token } = useAuthStore()
    const { servers, activeServerId, activeChannelId, channels, members, voiceStates, voiceSpeakingUserIds, voiceLocalSpeaking, setActiveChannel, friends, setFriends } = useAppStore(
        useShallow((s) => ({
            servers: s.servers,
            activeServerId: s.activeServerId,
            activeChannelId: s.activeChannelId,
            channels: s.channels,
            members: s.members,
            voiceStates: s.voiceStates,
            voiceSpeakingUserIds: s.voiceSpeakingUserIds,
            voiceLocalSpeaking: s.voiceLocalSpeaking,
            setActiveChannel: s.setActiveChannel,
            friends: s.friends,
            setFriends: s.setFriends,
        }))
    )
    const pushToast = useToastStore((s) => s.pushToast)
    const [draggedChannelId, setDraggedChannelId] = useState<string | null>(null)
    const [dragOverChannel, setDragOverChannel] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
    const [draggedCategory, setDraggedCategory] = useState<string | null>(null)
    const [contextMenu, setContextMenu] = useState<{ channelId: string; x: number; y: number } | null>(null)
    const [categoryMenu, setCategoryMenu] = useState<{ category: string; x: number; y: number } | null>(null)
    const [participantMenu, setParticipantMenu] = useState<{ userId: string; username: string; x: number; y: number } | null>(null)
    const [pendingVoiceJoin, setPendingVoiceJoin] = useState<{ id: string; name: string } | null>(null)
    const [isJoiningVoice, setIsJoiningVoice] = useState(false)
    const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({})
    const [dragOverCategory, setDragOverCategory] = useState<{ name: string; position: 'before' | 'after' } | null>(null)
    const [dragOverCategoryForChannel, setDragOverCategoryForChannel] = useState<string | null>(null)
    const [voiceJoinConfirmEnabled, setVoiceJoinConfirmEnabled] = useState(() => localStorage.getItem(VOICE_JOIN_CONFIRM_KEY) !== '0')
    const [peerVolumeByUserId, setPeerVolumeByUserId] = useState<Record<string, number>>(() => {
        try {
            const raw = localStorage.getItem('voxpery-voice-peer-volume')
            if (!raw) return {}
            const parsed = JSON.parse(raw) as Record<string, unknown>
            const next: Record<string, number> = {}
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value !== 'number' || !Number.isFinite(value)) continue
                next[key] = Math.min(200, Math.max(0, Math.round(value)))
            }
            return next
        } catch {
            return {}
        }
    })
    const menuRef = useRef<HTMLDivElement>(null)
    const participantMenuRef = useRef<HTMLDivElement>(null)
    const sidebarRef = useRef<HTMLDivElement>(null)
    const dragPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const suppressDragPreview = (e: DragEvent<HTMLElement>) => {
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

    const clampMenuPosition = (x: number, y: number, width: number, height: number) => {
        const pad = 8
        const maxX = Math.max(pad, window.innerWidth - width - pad)
        const maxY = Math.max(pad, window.innerHeight - height - pad)
        return {
            x: Math.min(Math.max(x, pad), maxX),
            y: Math.min(Math.max(y, pad), maxY),
        }
    }

    const clampParticipantMenuToSidebar = (x: number, y: number, width: number, height: number) => {
        const sidebarRect = sidebarRef.current?.getBoundingClientRect()
        if (!sidebarRect) return clampMenuPosition(x, y, width, height)

        const pad = 6
        const minX = Math.max(pad, sidebarRect.left + pad)
        const maxX = Math.min(window.innerWidth - width - pad, sidebarRect.right - width - pad)
        const minY = Math.max(pad, sidebarRect.top + pad)
        const maxY = Math.min(window.innerHeight - height - pad, sidebarRect.bottom - height - pad)

        return {
            x: Math.min(Math.max(x, minX), Math.max(minX, maxX)),
            y: Math.min(Math.max(y, minY), Math.max(minY, maxY)),
        }
    }

    const activeServer = servers.find((s) => s.id === activeServerId)
    const draggedChannel = draggedChannelId ? channels.find((c) => c.id === draggedChannelId) : null

    // Group channels by category
    const channelsByCategory: Record<string, Channel[]> = {}
    for (const category of channelCategories) {
        const trimmed = category.trim()
        if (!trimmed) continue
        channelsByCategory[trimmed] = channelsByCategory[trimmed] ?? []
    }
    channels.forEach((ch) => {
        const cat = ch.category || 'Channels'
        if (!channelsByCategory[cat]) channelsByCategory[cat] = []
        channelsByCategory[cat].push(ch)
    })
    Object.values(channelsByCategory).forEach((chs) =>
        chs.sort((a, b) => {
            const typeDiff = channelTypeOrder(a.channel_type) - channelTypeOrder(b.channel_type)
            if (typeDiff !== 0) return typeDiff
            return a.position - b.position
        }),
    )
    const knownOrder = new Map(channelCategories.map((name, idx) => [name, idx]))
    const orderedCategories = Object.entries(channelsByCategory).sort(([aName, aChannels], [bName, bChannels]) => {
        const aKnown = knownOrder.get(aName)
        const bKnown = knownOrder.get(bName)
        if (aKnown !== undefined || bKnown !== undefined) {
            if (aKnown === undefined) return 1
            if (bKnown === undefined) return -1
            if (aKnown !== bKnown) return aKnown - bKnown
        }
        const aMinPos = aChannels[0]?.position ?? 0
        const bMinPos = bChannels[0]?.position ?? 0
        if (aMinPos !== bMinPos) return aMinPos - bMinPos
        return aName.localeCompare(bName)
    })

    const getInitial = (name: string) => name.charAt(0).toUpperCase()
    const closeAllContextMenus = () => {
        setContextMenu(null)
        setCategoryMenu(null)
        setParticipantMenu(null)
    }

    useEffect(() => {
        if (!contextMenu && !participantMenu && !categoryMenu) return
        const close = () => {
            setContextMenu(null)
            setParticipantMenu(null)
            setCategoryMenu(null)
        }
        window.addEventListener('click', close)
        window.addEventListener('scroll', close, true)
        return () => {
            window.removeEventListener('click', close)
            window.removeEventListener('scroll', close, true)
        }
    }, [contextMenu, participantMenu, categoryMenu])

    useEffect(() => {
        const syncJoinConfirm = () => {
            setVoiceJoinConfirmEnabled(localStorage.getItem(VOICE_JOIN_CONFIRM_KEY) !== '0')
        }
        window.addEventListener(SETTINGS_CHANGED_EVENT, syncJoinConfirm)
        window.addEventListener('storage', syncJoinConfirm)
        return () => {
            window.removeEventListener(SETTINGS_CHANGED_EVENT, syncJoinConfirm)
            window.removeEventListener('storage', syncJoinConfirm)
        }
    }, [])

    const savePeerVolume = (userId: string, volume: number) => {
        const bounded = Math.min(200, Math.max(0, Math.round(volume)))
        const next = { ...peerVolumeByUserId, [userId]: bounded }
        setPeerVolumeByUserId(next)
        localStorage.setItem('voxpery-voice-peer-volume', JSON.stringify(next))
        window.dispatchEvent(new CustomEvent('voxpery-voice-peer-volume-changed'))
    }

    const handleAddFriend = async (username: string) => {
        if (!user) return
        try {
            await friendApi.sendRequest(username, token)
            const list = await friendApi.list(token)
            setFriends(list)
        } catch (e) {
            pushToast({
                level: 'error',
                title: 'Add friend failed',
                message: e instanceof Error ? e.message : 'Could not send friend request.',
            })
        }
    }

    const handleJoinVoice = async (id: string) => {
        // Close confirmation immediately after user confirms.
        // Join progress is reflected in call bar status instead of blocking modal.
        setPendingVoiceJoin(null)
        setIsJoiningVoice(true)
        const manualJoinWindow = window as ManualJoinWindow
        manualJoinWindow.__voxperyManualJoinActive = true
        setActiveChannel(id)
        const joinFn = (window as Window & { __voxperyJoinVoice?: (channelId: string, preflightStream?: MediaStream) => void }).__voxperyJoinVoice

        try {
            if (!joinFn) {
                pushToast({ level: 'error', title: 'Voice Error', message: 'Voice service is not ready. Please refresh.' })
                return
            }
            await joinFn(id)
        } catch (e) {
            console.error("Voice join failed:", e)
        } finally {
            setIsJoiningVoice(false)
            manualJoinWindow.__voxperyManualJoinActive = false
        }
    }

    return (
        <div className="channel-sidebar" ref={sidebarRef}>
            <div className="channel-header" onClick={activeServer ? onOpenServerSettings : undefined}>
                {activeServer ? (
                    <>
                        <span style={{ flex: 1 }}>{activeServer.name}</span>
                        <ChevronDown size={16} />
                    </>
                ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Select a Server</span>
                )}
            </div>

            <div className="channel-list">
                {canManageChannels && onOpenCreateChannel && (
                    <div className="channel-create-actions">
                        <button
                            type="button"
                            className="channel-create-btn"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenCreateChannel(); }}
                            title="Create Channel"
                        >
                            <Plus size={16} />
                            Create Channel
                        </button>
                        {onOpenCreateCategory && (
                            <button
                                type="button"
                                className="channel-create-btn"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenCreateCategory(); }}
                                title="Create Category"
                            >
                                <Plus size={16} />
                                Create Category
                            </button>
                        )}
                    </div>
                )}
                {channels.length === 0 && (
                    <div className="channel-empty-state">
                        No channels yet.
                        {canManageChannels && ' Create your first text or voice channel.'}
                    </div>
                )}
                {orderedCategories.map(([category, chs]) => (
                    <div
                        key={category}
                        className={`channel-category-group ${dragOverCategory?.name === category ? `drop-${dragOverCategory.position}` : ''}`}
                        onDragOver={(e) => {
                            if (!canManageChannels) return
                            if (draggedCategory && draggedCategory !== category) {
                                e.preventDefault()
                                e.dataTransfer.dropEffect = 'move'
                                const rect = e.currentTarget.getBoundingClientRect()
                                const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                                setDragOverCategory({ name: category, position })
                                setDragOverCategoryForChannel(null)
                                setDragOverChannel(null)
                                return
                            }
                            const target = e.target as HTMLElement
                            const overChannelItem = !!target.closest('.channel-item')
                            const overCategoryHeader = !!target.closest('.channel-category-btn')
                            if (overChannelItem || overCategoryHeader || chs.length > 0) return
                            if (draggedChannelId) {
                                e.preventDefault()
                                e.dataTransfer.dropEffect = 'move'
                                setDragOverCategoryForChannel(category)
                                setDragOverChannel(null)
                            }
                        }}
                        onDragLeave={(e) => {
                            const currentTarget = e.currentTarget
                            const related = e.relatedTarget as Node | null
                            if (related && currentTarget.contains(related)) return
                            if (dragOverCategory?.name === category) setDragOverCategory(null)
                            if (dragOverCategoryForChannel === category) setDragOverCategoryForChannel(null)
                        }}
                        onDrop={(e) => {
                            if (!canManageChannels) return
                            if (draggedCategory && draggedCategory !== category) {
                                e.preventDefault()
                                const rect = e.currentTarget.getBoundingClientRect()
                                const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                                onReorderCategories?.(draggedCategory, category, position)
                                setDraggedCategory(null)
                                setDragOverCategory(null)
                                setDragOverCategoryForChannel(null)
                                return
                            }
                            const target = e.target as HTMLElement
                            const overChannelItem = !!target.closest('.channel-item')
                            const overCategoryHeader = !!target.closest('.channel-category-btn')
                            if (overChannelItem || overCategoryHeader || chs.length > 0) return
                            if (draggedChannelId) {
                                e.preventDefault()
                                onMoveChannelToCategory?.(draggedChannelId, category, 'end')
                                setDraggedChannelId(null)
                                setDragOverChannel(null)
                                setDragOverCategory(null)
                                setDragOverCategoryForChannel(null)
                            }
                        }}
                    >
                        <button
                            type="button"
                            className={`channel-category channel-category-btn ${dragOverCategoryForChannel === category ? 'is-channel-drop-target' : ''}`}
                            onClick={() =>
                                setCollapsedCategories((prev) => ({
                                    ...prev,
                                    [category]: !prev[category],
                                }))
                            }
                            onContextMenu={(e) => {
                                if (!canManageChannels) return
                                e.preventDefault()
                                const pos = clampMenuPosition(e.clientX, e.clientY, 210, 100)
                                closeAllContextMenus()
                                setCategoryMenu({ category, x: pos.x, y: pos.y })
                            }}
                            draggable={!!canManageChannels}
                            onDragStart={(e) => {
                                if (!canManageChannels) return
                                setDraggedCategory(category)
                                setDragOverCategoryForChannel(null)
                                setDragOverChannel(null)
                                e.dataTransfer.effectAllowed = 'move'
                                e.dataTransfer.setData('text/plain', category)
                                suppressDragPreview(e)
                            }}
                            onDragOver={(e) => {
                                if (!canManageChannels) return
                                if (draggedChannelId) {
                                    e.preventDefault()
                                    e.dataTransfer.dropEffect = 'move'
                                    setDragOverCategoryForChannel(category)
                                    setDragOverCategory(null)
                                    setDragOverChannel(null)
                                }
                            }}
                            onDrop={(e) => {
                                if (!canManageChannels) return
                                if (draggedChannelId) {
                                    e.preventDefault()
                                    onMoveChannelToCategory?.(draggedChannelId, category, 'start')
                                    setDraggedChannelId(null)
                                    setDragOverChannel(null)
                                    setDragOverCategoryForChannel(null)
                                }
                            }}
                            onDragEnd={() => {
                                setDraggedCategory(null)
                                setDragOverCategory(null)
                                setDragOverCategoryForChannel(null)
                            }}
                        >
                            <ChevronDown size={10} className={collapsedCategories[category] ? 'is-collapsed' : ''} />
                            {category}
                        </button>
                        {!collapsedCategories[category] && chs.map((ch) => {
                            const isActive = activeChannelId === ch.id
                            const voiceMembers = ch.channel_type === 'voice'
                                ? members.filter((m) => voiceStates[m.user_id] === ch.id)
                                : []
                            return (
                                <div key={ch.id}>
                                    <div
                                        className={`channel-item ${isActive ? 'active' : ''} ${canManageChannels ? 'is-draggable' : ''} ${dragOverChannel?.id === ch.id ? `drop-${dragOverChannel.position}` : ''}`}
                                        onMouseEnter={() => { if (ch.channel_type === 'voice') preloadRnnoiseWorklet() }}
                                        onClick={() => {
                                            if (ch.channel_type === 'voice') {
                                                const currentJoined = useAppStore.getState().joinedVoiceChannelId
                                                if (currentJoined === ch.id) {
                                                    // Already joined, just view it
                                                    setActiveChannel(ch.id)
                                                    return
                                                }
                                                // Ask for confirmation or join directly
                                                if (!voiceJoinConfirmEnabled) {
                                                    void handleJoinVoice(ch.id)
                                                } else {
                                                    setPendingVoiceJoin({ id: ch.id, name: ch.name })
                                                }
                                                return
                                            }
                                            setActiveChannel(ch.id)
                                        }}
                                        onContextMenu={(e) => {
                                            if (!canManageChannels) return
                                            e.preventDefault()
                                            closeAllContextMenus()
                                            setContextMenu({ channelId: ch.id, x: e.clientX, y: e.clientY })
                                        }}
                                        draggable={!!canManageChannels}
                                        onDragStart={(e) => {
                                            if (!canManageChannels) return
                                            setDraggedCategory(null)
                                            setDraggedChannelId(ch.id)
                                            setDragOverCategory(null)
                                            setDragOverCategoryForChannel(null)
                                            e.dataTransfer.effectAllowed = 'move'
                                            e.dataTransfer.setData('text/plain', ch.id)
                                            suppressDragPreview(e)
                                        }}
                                        onDragOver={(e) => {
                                            if (!canManageChannels || !draggedChannelId || draggedChannelId === ch.id) return
                                            if (draggedChannel && draggedChannel.channel_type !== ch.channel_type) {
                                                if (dragOverChannel?.id === ch.id) setDragOverChannel(null)
                                                return
                                            }
                                            e.stopPropagation()
                                            e.preventDefault()
                                            e.dataTransfer.dropEffect = 'move'
                                            const rect = e.currentTarget.getBoundingClientRect()
                                            const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                                            setDragOverChannel({ id: ch.id, position })
                                            setDragOverCategoryForChannel(null)
                                        }}
                                        onDrop={(e) => {
                                            if (!canManageChannels || !draggedChannelId || draggedChannelId === ch.id) return
                                            if (draggedChannel && draggedChannel.channel_type !== ch.channel_type) return
                                            e.stopPropagation()
                                            e.preventDefault()
                                            const rect = e.currentTarget.getBoundingClientRect()
                                            const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                                            onReorderChannels?.(draggedChannelId, ch.id, position)
                                            setDraggedChannelId(null)
                                            setDragOverChannel(null)
                                        }}
                                        onDragLeave={() => {
                                            if (dragOverChannel?.id === ch.id) setDragOverChannel(null)
                                        }}
                                        onDragEnd={() => {
                                            setDraggedChannelId(null)
                                            setDragOverChannel(null)
                                            setDragOverCategoryForChannel(null)
                                        }}
                                    >
                                        <span className="channel-icon">
                                            {ch.channel_type === 'voice' ? <Volume2 size={18} /> : <Hash size={18} />}
                                        </span>
                                        <span className="channel-name">{ch.name}</span>
                                        {ch.channel_type === 'text' && (unreadByChannel[ch.id] ?? 0) > 0 && (
                                            <span className="channel-unread-badge">{unreadByChannel[ch.id]}</span>
                                        )}
                                    </div>
                                    {ch.channel_type === 'voice' && voiceMembers.length > 0 && (
                                        <div className="voice-participants">
                                            {voiceMembers.map((vm) => {
                                                const isSelf = user?.id === vm.user_id
                                                const control = voiceControls[vm.user_id]
                                                const isScreenSharing = !!control?.screenSharing
                                                const isCameraOn = !!control?.cameraOn
                                                const isDeafened = !!control?.deafened
                                                const isMuted = !!control?.muted
                                                const isSpeaking = (isSelf ? voiceLocalSpeaking : voiceSpeakingUserIds.includes(vm.user_id)) && !isMuted && !isDeafened
                                                return (
                                                    <div
                                                        key={vm.user_id}
                                                        className="voice-participant"
                                                        onContextMenu={(e) => {
                                                            e.preventDefault()
                                                            if (user?.id === vm.user_id) {
                                                                setParticipantMenu(null)
                                                                return
                                                            }
                                                            const alreadyFriend = friends.some((f) => f.username.toLowerCase() === vm.username.toLowerCase())
                                                            const estimatedWidth = 192
                                                            const estimatedHeight = alreadyFriend ? 92 : 130
                                                            const pos = clampParticipantMenuToSidebar(e.clientX, e.clientY, estimatedWidth, estimatedHeight)
                                                            closeAllContextMenus()
                                                            setParticipantMenu({ userId: vm.user_id, username: vm.username, x: pos.x, y: pos.y })
                                                        }}
                                                    >
                                                        <div className={`voice-participant-avatar ${isSpeaking ? 'is-speaking' : ''}`}>
                                                            {vm.avatar_url ? (
                                                                <img src={vm.avatar_url} alt="" />
                                                            ) : (
                                                                getInitial(vm.username)
                                                            )}
                                                        </div>
                                                        <span className={`voice-participant-name${isSpeaking ? ' is-speaking' : ''}`}>{vm.username}</span>
                                                        {(isScreenSharing || isCameraOn || isDeafened || isMuted) && (
                                                            <span className="voice-participant-icons">
                                                                {isCameraOn && (
                                                                    <span className="voice-participant-icon-badge is-positive" title="Camera on">
                                                                        <Video size={11} />
                                                                    </span>
                                                                )}
                                                                {isScreenSharing && (
                                                                    <span className="voice-participant-icon-badge is-positive" title="Screen sharing">
                                                                        <Monitor size={11} />
                                                                    </span>
                                                                )}
                                                                {isDeafened && (
                                                                    <>
                                                                        <span className="voice-participant-icon-badge" title="Muted">
                                                                            <MicOff size={11} />
                                                                        </span>
                                                                        <span className="voice-participant-icon-badge" title="Deafened">
                                                                            <VolumeX size={11} />
                                                                        </span>
                                                                    </>
                                                                )}
                                                                {isMuted && !isDeafened && (
                                                                    <span className="voice-participant-icon-badge" title="Muted">
                                                                        <MicOff size={11} />
                                                                    </span>
                                                                )}
                                                            </span>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ))}
            </div>

            {contextMenu && canManageChannels && (() => {
                const channel = channels.find((c) => c.id === contextMenu.channelId)
                if (!channel) return null
                return (
                    <div
                        ref={menuRef}
                        className="server-context-menu channel-context-menu"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="server-context-menu-item"
                            onClick={() => {
                                setContextMenu(null)
                                onRenameChannel?.(channel)
                            }}
                        >
                            Rename
                        </button>
                        <button
                            type="button"
                            className="server-context-menu-item danger"
                            onClick={() => {
                                setContextMenu(null)
                                onDeleteChannel?.(channel)
                            }}
                        >
                            Delete Channel
                        </button>
                    </div>
                )
            })()}

            {categoryMenu && canManageChannels && (
                <div
                    ref={menuRef}
                    className="server-context-menu channel-context-menu"
                    style={{ left: categoryMenu.x, top: categoryMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        type="button"
                        className="server-context-menu-item"
                        onClick={() => {
                            onRenameCategory?.(categoryMenu.category)
                            setCategoryMenu(null)
                        }}
                    >
                        Rename Category
                    </button>
                    <button
                        type="button"
                        className="server-context-menu-item"
                        onClick={() => {
                            onOpenCategoryPermissions?.(categoryMenu.category)
                            setCategoryMenu(null)
                        }}
                    >
                        Category Permissions
                    </button>
                    <button
                        type="button"
                        className="server-context-menu-item danger"
                        onClick={() => {
                            onDeleteCategory?.(categoryMenu.category)
                            setCategoryMenu(null)
                        }}
                    >
                        Delete Category
                    </button>
                </div>
            )}

            {participantMenu && (() => {
                const isSelf = participantMenu.userId === user?.id
                const alreadyFriend = friends.some((f) => f.username.toLowerCase() === participantMenu.username.toLowerCase())
                const currentVolume = peerVolumeByUserId[participantMenu.userId] ?? 100
                if (isSelf) return null
                return (
                    <div
                        ref={participantMenuRef}
                        className="server-context-menu member-context-menu member-volume-menu"
                        style={{ left: participantMenu.x, top: participantMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="server-context-menu-item member-volume-menu-username">
                            {participantMenu.username}
                        </div>

                        {!isSelf && !alreadyFriend && (
                            <button
                                type="button"
                                className="server-context-menu-item"
                                onClick={() => {
                                    void handleAddFriend(participantMenu.username)
                                    setParticipantMenu(null)
                                }}
                            >
                                Add Friend
                            </button>
                        )}

                        <div className="server-context-menu-item member-volume-menu-control">
                            <div className="member-volume-menu-label">
                                Volume: {currentVolume}%{currentVolume > 100 ? ' 🔊' : ''}
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={200}
                                step={5}
                                value={currentVolume}
                                onChange={(e) => savePeerVolume(participantMenu.userId, Number(e.target.value))}
                                className="member-volume-menu-slider"
                            />
                        </div>
                    </div>
                )
            })()}

            {pendingVoiceJoin && (
                <div className="modal-overlay" onClick={() => !isJoiningVoice && setPendingVoiceJoin(null)}>
                    <div className="modal confirm-modal voice-join-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Join Voice Channel</h2>
                        <p className="voice-join-modal-desc">
                            Are you sure you want to connect to <strong>{pendingVoiceJoin.name}</strong>?
                        </p>

                        <label className="voice-join-remember">
                            <input
                                type="checkbox" 
                                checked={!voiceJoinConfirmEnabled}
                                onChange={(e) => {
                                    const nextConfirmEnabled = !e.target.checked
                                    setVoiceJoinConfirmEnabled(nextConfirmEnabled)
                                    localStorage.setItem(VOICE_JOIN_CONFIRM_KEY, nextConfirmEnabled ? '1' : '0')
                                    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                                }}
                            />
                            <span>Don't ask again</span>
                        </label>
                        <p className="voice-join-hint">You can change this later in Settings → Voice.</p>

                        <div className="modal-actions voice-join-actions">
                            <button
                                type="button"
                                className="btn btn-secondary voice-join-btn"
                                onClick={() => setPendingVoiceJoin(null)}
                                disabled={isJoiningVoice}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary voice-join-btn voice-join-btn-primary"
                                disabled={isJoiningVoice}
                                onClick={() => void handleJoinVoice(pendingVoiceJoin.id)}
                            >
                                {isJoiningVoice ? (
                                    <>
                                        <div className="spinner-small" />
                                        Connecting...
                                    </>
                                ) : 'Join Channel'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
