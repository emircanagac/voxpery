import { Hash, Volume2, ChevronDown, Plus, MicOff, VolumeX, Monitor, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { friendApi } from '../api'
import type { Channel } from '../api'
import { useToastStore } from '../stores/toast'

interface ChannelSidebarProps {
    onOpenServerSettings: () => void
    onOpenCreateChannel?: () => void
    canManageChannels?: boolean
    unreadByChannel?: Record<string, number>
    voiceControls?: Record<string, { muted: boolean; deafened: boolean; screenSharing: boolean; cameraOn?: boolean }>
    onRenameChannel?: (channel: Channel) => void
    onDeleteChannel?: (channel: Channel) => void
    onReorderChannels?: (draggedChannelId: string, targetChannelId: string) => void
}

export default function ChannelSidebar({
    onOpenServerSettings,
    onOpenCreateChannel,
    canManageChannels,
    unreadByChannel = {},
    voiceControls = {},
    onRenameChannel,
    onDeleteChannel,
    onReorderChannels,
}: ChannelSidebarProps) {
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
    const [contextMenu, setContextMenu] = useState<{ channelId: string; x: number; y: number } | null>(null)
    const [participantMenu, setParticipantMenu] = useState<{ userId: string; username: string; x: number; y: number } | null>(null)
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

    // Group channels by category
    const channelsByCategory: Record<string, Channel[]> = {}
    channels.forEach((ch) => {
        const cat = ch.category || 'Channels'
        if (!channelsByCategory[cat]) channelsByCategory[cat] = []
        channelsByCategory[cat].push(ch)
    })
    Object.values(channelsByCategory).forEach((chs) => chs.sort((a, b) => a.position - b.position))

    const getInitial = (name: string) => name.charAt(0).toUpperCase()

    useEffect(() => {
        if (!contextMenu && !participantMenu) return
        const close = () => {
            setContextMenu(null)
            setParticipantMenu(null)
        }
        window.addEventListener('click', close)
        window.addEventListener('scroll', close, true)
        return () => {
            window.removeEventListener('click', close)
            window.removeEventListener('scroll', close, true)
        }
    }, [contextMenu, participantMenu])

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
                    <button
                        type="button"
                        className="channel-create-btn"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenCreateChannel(); }}
                        title="Create Channel"
                    >
                        <Plus size={16} />
                        Create Channel
                    </button>
                )}
                {channels.length === 0 && (
                    <div className="channel-empty-state">
                        No channels yet.
                        {canManageChannels && ' Create your first text or voice channel.'}
                    </div>
                )}
                {Object.entries(channelsByCategory).map(([category, chs]) => (
                    <div key={category}>
                        <div className="channel-category">
                            <ChevronDown size={10} />
                            {category}
                        </div>
                        {chs.map((ch) => {
                            const isActive = activeChannelId === ch.id
                            const voiceMembers = ch.channel_type === 'voice'
                                ? members.filter((m) => voiceStates[m.user_id] === ch.id)
                                : []
                            return (
                                <div key={ch.id}>
                                    <div
                                        className={`channel-item ${isActive ? 'active' : ''} ${canManageChannels ? 'is-draggable' : ''}`}
                                        onClick={() => {
                                            // If user re-clicks the same voice channel they're already viewing,
                                            // just trigger the join without resetting activeChannel (which caused the Welcome screen flash).
                                            if (isActive && ch.channel_type === 'voice') {
                                                const joinFn = (window as Window & { __voxperyJoinVoice?: (channelId: string, preflightStream?: MediaStream) => void }).__voxperyJoinVoice
                                                if (joinFn) {
                                                    void (async () => {
                                                        if (!navigator.mediaDevices?.getUserMedia) {
                                                            joinFn(ch.id)
                                                            return
                                                        }
                                                        let stream: MediaStream | null = null
                                                        try {
                                                            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                                                            await joinFn(ch.id, stream)
                                                        } catch (err) {
                                                            stream?.getTracks().forEach((t) => t.stop())
                                                            const errObj = err as Error
                                                            const name = errObj.name ?? ''
                                                            let message = errObj.message || 'Unable to access microphone. Check your device and try again.'
                                                            if (message === 'Failed to fetch') {
                                                                message = 'Connection error. Check your internet connection.'
                                                            } else if (name === 'NotAllowedError' || name === 'SecurityError') {
                                                                message = 'Permission was blocked. Allow microphone access in browser settings and try again.'
                                                            } else if (name === 'NotFoundError') {
                                                                message = 'No microphone device detected. Connect a microphone and retry.'
                                                            } else if (name === 'NotReadableError') {
                                                                message = 'Microphone is in use by another app. Close it and retry.'
                                                            }
                                                            pushToast({
                                                                level: 'error',
                                                                title: 'Voice action failed',
                                                                message,
                                                            })
                                                        }
                                                    })()
                                                }
                                                return
                                            }
                                            setActiveChannel(ch.id)
                                            if (ch.channel_type === 'voice') {
                                                const joinFn = (window as Window & { __voxperyJoinVoice?: (channelId: string, preflightStream?: MediaStream) => void }).__voxperyJoinVoice
                                                if (joinFn) {
                                                    void (async () => {
                                                        if (!navigator.mediaDevices?.getUserMedia) {
                                                            joinFn(ch.id)
                                                            return
                                                        }
                                                        let stream: MediaStream | null = null
                                                        try {
                                                            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                                                            await joinFn(ch.id, stream)
                                                        } catch (err) {
                                                            stream?.getTracks().forEach((t) => t.stop())
                                                            const errObj = err as Error
                                                            const name = errObj.name ?? ''
                                                            let message = errObj.message || 'Unable to access microphone. Check your device and try again.'
                                                            if (message === 'Failed to fetch') {
                                                                message = 'Connection error. Check your internet connection.'
                                                            } else if (name === 'NotAllowedError' || name === 'SecurityError') {
                                                                message = 'Permission was blocked. Allow microphone access in browser settings and try again.'
                                                            } else if (name === 'NotFoundError') {
                                                                message = 'No microphone device detected. Connect a microphone and retry.'
                                                            } else if (name === 'NotReadableError') {
                                                                message = 'Microphone is in use by another app. Close it and retry.'
                                                            }
                                                            pushToast({
                                                                level: 'error',
                                                                title: 'Voice action failed',
                                                                message,
                                                            })
                                                        }
                                                    })()
                                                }
                                            }
                                        }}
                                        onContextMenu={(e) => {
                                            if (!canManageChannels) return
                                            e.preventDefault()
                                            setContextMenu({ channelId: ch.id, x: e.clientX, y: e.clientY })
                                        }}
                                        draggable={!!canManageChannels}
                                        onDragStart={(e) => {
                                            if (!canManageChannels) return
                                            setDraggedChannelId(ch.id)
                                            e.dataTransfer.effectAllowed = 'move'
                                            e.dataTransfer.setData('text/plain', ch.id)
                                        }}
                                        onDragOver={(e) => {
                                            if (!canManageChannels || !draggedChannelId || draggedChannelId === ch.id) return
                                            e.preventDefault()
                                            e.dataTransfer.dropEffect = 'move'
                                        }}
                                        onDrop={(e) => {
                                            if (!canManageChannels || !draggedChannelId || draggedChannelId === ch.id) return
                                            e.preventDefault()
                                            onReorderChannels?.(draggedChannelId, ch.id)
                                            setDraggedChannelId(null)
                                        }}
                                        onDragEnd={() => setDraggedChannelId(null)}
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
                                                            setContextMenu(null)
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
                            Rename Channel
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

        </div>
    )
}
