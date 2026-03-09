import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { friendApi, serverApi, type ServerRole } from '../api'
import { useCallback, useEffect, useRef, useState, memo } from 'react'
import { useToastStore } from '../stores/toast'
import type { StatusValue } from './StatusIcon'

const MemberItem = memo(function MemberItem({
    member,
    isOwner,
    currentUserId,
    isFriend,
    canKickAsRole,
    myRole,
    onContextMenu
}: {
    member: any
    isOwner: boolean
    currentUserId?: string
    isFriend: boolean
    canKickAsRole: boolean
    myRole: string
    onContextMenu: (e: React.MouseEvent, member: any, canMakeAdmin: boolean, canAddFriend: boolean, canKick: boolean) => void
}) {
    const status = (m: any) => (m.status || 'offline').toLowerCase()
    const statusLabel = (s: string) => ({ online: 'Online', dnd: 'Do not disturb', offline: 'Offline' })[s] ?? s
    const getInitial = (name: string) => name.charAt(0).toUpperCase()

    const canMakeAdmin = isOwner && member.role !== 'owner'
    const canAddFriend = member.user_id !== currentUserId && !isFriend
    const canKick =
        canKickAsRole &&
        member.user_id !== currentUserId &&
        member.role !== 'owner' &&
        (myRole === 'owner' || member.role === 'member')
    const showContextMenu = canMakeAdmin || canAddFriend || canKick

    return (
        <div
            className={`member-item ${showContextMenu ? 'is-contextable' : ''}`}
            onContextMenu={(e) => {
                if (!showContextMenu) return
                e.preventDefault()
                onContextMenu(e, member, canMakeAdmin, canAddFriend, canKick)
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
})

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
    const [roleEditor, setRoleEditor] = useState<{
        userId: string
        username: string
        loading: boolean
        saving: boolean
        roles: ServerRole[]
        selectedRoleIds: string[]
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

    const openRoleEditor = useCallback(
        async (memberUserId: string, username: string) => {
            if (!user || !activeServerId || !isOwner) return
            setRoleEditor({
                userId: memberUserId,
                username,
                loading: true,
                saving: false,
                roles: [],
                selectedRoleIds: [],
            })
            try {
                const [roles, memberRoleIds] = await Promise.all([
                    serverApi.listRoles(activeServerId, token),
                    serverApi.listMemberRoles(activeServerId, memberUserId, token),
                ])
                setRoleEditor((prev) =>
                    prev && prev.userId === memberUserId
                        ? {
                              ...prev,
                              loading: false,
                              roles,
                              selectedRoleIds: memberRoleIds,
                          }
                        : prev,
                )
            } catch (e) {
                console.error('Failed to load member roles', e)
                setRoleEditor((prev) =>
                    prev
                        ? {
                              ...prev,
                              loading: false,
                          }
                        : prev,
                )
            }
        },
        [activeServerId, isOwner, token, user],
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

    const handleContextMenu = useCallback((
        e: React.MouseEvent,
        member: any,
        canMakeAdmin: boolean,
        canAddFriend: boolean,
        canKick: boolean
    ) => {
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
    }, [])

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

    return (
        <div className="member-sidebar">
            {onlineMembers.length > 0 && (
                <>
                    <div className="member-category member-category-online">
                        ONLINE — {onlineMembers.length}
                    </div>
                    {onlineMembers.map((member) => (
                        <MemberItem
                            key={member.user_id}
                            member={member}
                            isOwner={isOwner}
                            currentUserId={user?.id}
                            isFriend={friendUsernames.has(member.username.toLowerCase())}
                            canKickAsRole={canKickAsRole}
                            myRole={myRole}
                            onContextMenu={handleContextMenu}
                        />
                    ))}
                </>
            )}

            {offlineMembers.length > 0 && (
                <>
                    <div className="member-category member-category-offline">
                        OFFLINE — {offlineMembers.length}
                    </div>
                    {offlineMembers.map((member) => (
                        <MemberItem
                            key={member.user_id}
                            member={member}
                            isOwner={isOwner}
                            currentUserId={user?.id}
                            isFriend={friendUsernames.has(member.username.toLowerCase())}
                            canKickAsRole={canKickAsRole}
                            myRole={myRole}
                            onContextMenu={handleContextMenu}
                        />
                    ))}
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
                                void openRoleEditor(contextMenu.userId, contextMenu.username)
                                setContextMenu(null)
                            }}
                        >
                            Manage roles
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
                            Kick user
                        </button>
                    )}
                </div>
            )}

            {roleEditor && (
                <div className="modal-overlay" onClick={() => setRoleEditor(null)}>
                    <div
                        className="modal"
                        style={{ maxWidth: 380 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2>Manage roles</h2>
                        <p style={{ marginBottom: 12, color: 'var(--text-secondary)', fontSize: 13 }}>
                            {roleEditor.username}
                        </p>
                        {roleEditor.loading ? (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading roles…</div>
                        ) : roleEditor.roles.length === 0 ? (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                No roles in this server yet. Create roles in Server Settings &gt; Roles.
                            </div>
                        ) : (
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr',
                                    gap: 6,
                                    marginBottom: 16,
                                }}
                            >
                                {roleEditor.roles.map((role) => {
                                    const checked = roleEditor.selectedRoleIds.includes(role.id)
                                    return (
                                        <label
                                            key={role.id}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                fontSize: 13,
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(e) => {
                                                    const isChecked = e.target.checked
                                                    setRoleEditor((prev) =>
                                                        prev
                                                            ? {
                                                                  ...prev,
                                                                  selectedRoleIds: isChecked
                                                                      ? [...prev.selectedRoleIds, role.id]
                                                                      : prev.selectedRoleIds.filter((id) => id !== role.id),
                                                              }
                                                            : prev,
                                                    )
                                                }}
                                            />
                                            <span>{role.name}</span>
                                        </label>
                                    )
                                })}
                            </div>
                        )}
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setRoleEditor(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                disabled={roleEditor.loading || roleEditor.saving}
                                onClick={async () => {
                                    if (!activeServerId || !user) return
                                    setRoleEditor((prev) => (prev ? { ...prev, saving: true } : prev))
                                    try {
                                        await serverApi.updateMemberRoles(
                                            activeServerId,
                                            roleEditor.userId,
                                            roleEditor.selectedRoleIds,
                                            token,
                                        )
                                        setRoleEditor(null)
                                    } catch (e) {
                                        console.error('Failed to update member roles', e)
                                        setRoleEditor((prev) => (prev ? { ...prev, saving: false } : prev))
                                    }
                                }}
                            >
                                Save
                            </button>
                        </div>
                    </div>
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
                                Kick user
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
