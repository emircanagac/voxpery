import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { friendApi, serverApi } from '../api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useToastStore } from '../stores/toast'
import type { StatusValue } from './StatusIcon'

export default function MemberSidebar() {
    const { user, token } = useAuthStore()
    const { servers, activeServerId, members, setMembers, friends, setFriends } = useAppStore(
        useShallow((s) => ({ servers: s.servers, activeServerId: s.activeServerId, members: s.members, setMembers: s.setMembers, friends: s.friends, setFriends: s.setFriends }))
    )
    const pushToast = useToastStore((s) => s.pushToast)
    const activeServer = servers.find((s) => s.id === activeServerId)
    const [contextMenu, setContextMenu] = useState<{
        userId: string
        username: string
        role: string
        x: number
        y: number
        canMakeAdmin: boolean
        canAddFriend: boolean
        canKick: boolean
    } | null>(null)
    const [kickConfirm, setKickConfirm] = useState<{ userId: string; username: string } | null>(null)
    const menuRef = useRef<HTMLDivElement>(null)

    const clampMenuPosition = (x: number, y: number, width: number, height: number) => {
        const pad = 8
        const maxX = Math.max(pad, window.innerWidth - width - pad)
        const maxY = Math.max(pad, window.innerHeight - height - pad)
        return {
            x: Math.min(Math.max(x, pad), maxX),
            y: Math.min(Math.max(y, pad), maxY),
        }
    }

    const getInitial = (name: string) => name.charAt(0).toUpperCase()
    const statusLabel = (s: string) =>
        ({ online: 'Online', dnd: 'Do not disturb', offline: 'Offline' })[s] ?? s

    const isOwner = !!(user && activeServer && activeServer.owner_id === user.id)
    const myRole = members.find((m) => m.user_id === user?.id)?.role ?? 'member'
    const canKickAsRole = myRole === 'owner' || myRole === 'moderator'

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

    const handleToggleAdmin = useCallback(
        async (memberUserId: string, currentRole: string) => {
            if (!user || !activeServerId || !isOwner) return
            const nextRole: 'moderator' | 'member' = currentRole === 'moderator' ? 'member' : 'moderator'
            try {
                await serverApi.setMemberRole(activeServerId, memberUserId, nextRole, token)
                const detail = await serverApi.get(activeServerId, token)
                setMembers(detail.members)
            } catch (e) {
                console.error('Failed to update member role', e)
            }
        },
        [activeServerId, isOwner, setMembers, token],
    )

    const handleAddFriend = useCallback(
        async (username: string) => {
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
        },
        [pushToast, setFriends, token, user],
    )

    const handleKick = useCallback(
        async (memberUserId: string) => {
            if (!activeServerId) return
            setKickConfirm(null)
            try {
                await serverApi.kickMember(activeServerId, memberUserId, token)
                const detail = await serverApi.get(activeServerId, token)
                setMembers(detail.members)
            } catch (e) {
                pushToast({
                    level: 'error',
                    title: 'Kick failed',
                    message: e instanceof Error ? e.message : 'Could not kick member.',
                })
            }
        },
        [activeServerId, pushToast, setMembers, token],
    )

    if (!activeServer) return null

    const status = (m: { status?: string | null }) => (m.status || 'offline').toLowerCase()
    const isOnline = (m: { status?: string | null }) =>
        status(m) === 'online' || status(m) === 'dnd'
    const roleOrder = (r: string) => (r === 'owner' ? 0 : r === 'moderator' ? 1 : 2)
    const byRoleThenName = (a: (typeof members)[0], b: (typeof members)[0]) =>
        roleOrder(a.role) - roleOrder(b.role) || a.username.localeCompare(b.username, undefined, { sensitivity: 'base' })
    const onlineMembers = members.filter(isOnline).sort(byRoleThenName)
    const offlineMembers = members.filter((m) => !isOnline(m)).sort(byRoleThenName)
    const friendUsernames = new Set(friends.map((f) => f.username.toLowerCase()))

    const renderMember = (member: (typeof members)[0]) => {
        const canMakeAdmin = isOwner && member.role !== 'owner'
        const canAddFriend = member.user_id !== user?.id && !friendUsernames.has(member.username.toLowerCase())
        const canKick =
            canKickAsRole &&
            member.user_id !== user?.id &&
            member.role !== 'owner' &&
            (myRole === 'owner' || member.role === 'member')
        const showContextMenu = canMakeAdmin || canAddFriend || canKick
        return (
        <div
            key={member.user_id}
            className={`member-item ${showContextMenu ? 'is-contextable' : ''}`}
            onContextMenu={(e) => {
                if (!showContextMenu) return
                e.preventDefault()
                const optionCount = (canMakeAdmin ? 1 : 0) + (canAddFriend ? 1 : 0) + (canKick ? 1 : 0)
                const pos = clampMenuPosition(e.clientX, e.clientY, 176, 8 + optionCount * 38)
                setContextMenu({
                    userId: member.user_id,
                    username: member.username,
                    role: member.role,
                    x: pos.x,
                    y: pos.y,
                    canMakeAdmin,
                    canAddFriend,
                    canKick,
                })
            }}
        >
            <div className={`member-avatar avatar-status-${status(member) as StatusValue}`} title={statusLabel(member.status || 'offline')}>
                {member.avatar_url ? (
                    <img src={member.avatar_url} alt="" className="member-avatar-image" />
                ) : (
                    getInitial(member.username)
                )}
            </div>
            <span className={`member-name ${member.role}`}>
                {member.username}
            </span>
        </div>
        )
    }

    return (
        <div className="member-sidebar">
            {onlineMembers.length > 0 && (
                <>
                    <div className="member-category member-category-online">
                        ONLINE — {onlineMembers.length}
                    </div>
                    {onlineMembers.map(renderMember)}
                </>
            )}

            {offlineMembers.length > 0 && (
                <>
                    <div className="member-category member-category-offline">
                        OFFLINE — {offlineMembers.length}
                    </div>
                    {offlineMembers.map(renderMember)}
                </>
            )}

            {contextMenu && (
                <div
                    ref={menuRef}
                    className="server-context-menu member-context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {contextMenu.canAddFriend && (
                        <button
                            type="button"
                            className="server-context-menu-item"
                            onClick={() => {
                                void handleAddFriend(contextMenu.username)
                                setContextMenu(null)
                            }}
                        >
                            Add Friend
                        </button>
                    )}
                    {contextMenu.canMakeAdmin && (
                        <button
                            type="button"
                            className="server-context-menu-item"
                            onClick={() => {
                                handleToggleAdmin(contextMenu.userId, contextMenu.role)
                                setContextMenu(null)
                            }}
                        >
                            {contextMenu.role === 'moderator' ? 'Remove moderator' : 'Make moderator'}
                        </button>
                    )}
                    {contextMenu.canKick && (
                        <button
                            type="button"
                            className="server-context-menu-item danger"
                            onClick={() => {
                                setKickConfirm({ userId: contextMenu.userId, username: contextMenu.username })
                                setContextMenu(null)
                            }}
                        >
                            Kick
                        </button>
                    )}
                </div>
            )}

            {kickConfirm && (
                <div className="modal-overlay" onClick={() => setKickConfirm(null)}>
                    <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Kick member</h2>
                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                            Kick <strong>{kickConfirm.username}</strong>? They will be removed from the server.
                        </p>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setKickConfirm(null)}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => void handleKick(kickConfirm.userId)}
                            >
                                Kick
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
