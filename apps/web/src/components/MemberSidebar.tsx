import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { friendApi, serverApi, type ServerRole } from '../api'
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useToastStore } from '../stores/toast'
import type { StatusValue } from './StatusIcon'

interface MemberItemProps {
    member: { user_id: string; username: string; role: string; avatar_url?: string | null; status?: string | null; role_color?: string | null; roles?: string[] }
    isOwner: boolean
    isServerOwner: boolean
    currentUserId?: string
    isFriend: boolean
    canKickAsRole: boolean
    canBanAsRole: boolean
    canManageRoles: boolean
    myRole: string
    onContextMenu: (e: React.MouseEvent, member: MemberItemProps['member'], canMakeAdmin: boolean, canAddFriend: boolean, canKick: boolean, canBan: boolean) => void
    onOpenProfile: (e: React.MouseEvent, member: MemberItemProps['member'], isServerOwner: boolean) => void
}

const MemberItem = memo(function MemberItem({
    member,
    isOwner,
    isServerOwner,
    currentUserId,
    isFriend,
    canKickAsRole,
    canBanAsRole,
    canManageRoles,
    myRole,
    onContextMenu,
    onOpenProfile,
}: MemberItemProps) {
    const status = (m: { status?: string | null }) => (m.status || 'offline').toLowerCase()
    const isOnline = status(member) === 'online' || status(member) === 'dnd'
    const statusLabel = (s: string) => ({ online: 'Online', dnd: 'Do not disturb', offline: 'Offline' })[s] ?? s
    const getInitial = (name: string) => name.charAt(0).toUpperCase()
    const displayColor = member.role_color ?? (isServerOwner ? '#f97316' : undefined) // fox-like orange for owner when no role color
    const hasColor = !!displayColor
    // Role/owner color or default. Offline = always muted vs online (same color, faded).
    const nameClass = hasColor
        ? (isOnline ? 'member-name' : 'member-name member-name--offline')
        : (isOnline ? 'member-name' : 'member-name member-name--default-offline')

    const canManageOwnerSelf = isOwner && member.user_id === currentUserId
    const canManageNonOwnerTarget =
        !isServerOwner &&
        member.role !== 'owner' &&
        (isOwner || canManageRoles)
    const canMakeAdmin = canManageOwnerSelf || canManageNonOwnerTarget
    const canAddFriend = member.user_id !== currentUserId && !isFriend
    const canKick =
        canKickAsRole &&
        !isServerOwner &&
        member.user_id !== currentUserId &&
        member.role !== 'owner' &&
        (myRole === 'owner' || member.role === 'member')
    const canBan =
        canBanAsRole &&
        !isServerOwner &&
        member.user_id !== currentUserId &&
        member.role !== 'owner' &&
        (myRole === 'owner' || member.role === 'member')
    const showContextMenu = canMakeAdmin || canAddFriend || canKick || canBan

    return (
        <div
            className={`member-item ${showContextMenu ? 'is-contextable' : ''}`}
            onClick={(e) => onOpenProfile(e, member, isServerOwner)}
            onContextMenu={(e) => {
                if (!showContextMenu) return
                e.preventDefault()
                onContextMenu(e, member, canMakeAdmin, canAddFriend, canKick, canBan)
            }}
        >
            <div className={`member-avatar avatar-status-${status(member) as StatusValue}`} title={statusLabel(member.status || 'offline')}>
                {member.avatar_url ? (
                    <img src={member.avatar_url} alt="" className="member-avatar-image" />
                ) : (
                    getInitial(member.username)
                )}
            </div>
            <span
                className={nameClass}
                style={displayColor ? { color: displayColor } : undefined}
            >
                {member.username}
                {isServerOwner && (
                    <span className="member-owner-badge" title="Server owner" aria-label="Server owner">
                        {' 🦊'}
                    </span>
                )}
            </span>
        </div>
    )
})

export default function MemberSidebar({
    canKickMembers,
    canBanMembers,
    canManageRolesFromPerms,
}: {
    canKickMembers: boolean
    canBanMembers: boolean
    canManageRolesFromPerms: boolean
}) {
    const { user, token } = useAuthStore()
    const { servers, activeServerId, activeChannelId, channels, members, setMembers, friends, setFriends } = useAppStore(
        useShallow((s) => ({
            servers: s.servers,
            activeServerId: s.activeServerId,
            activeChannelId: s.activeChannelId,
            channels: s.channels,
            members: s.members,
            setMembers: s.setMembers,
            friends: s.friends,
            setFriends: s.setFriends,
        }))
    )
    const pushToast = useToastStore((s) => s.pushToast)
    const subscribeWs = useSocketStore((s) => s.subscribe)
    const activeServer = servers.find((s) => s.id === activeServerId)
    const activeChannel = useMemo(
        () => (activeChannelId ? channels.find((c) => c.id === activeChannelId) ?? null : null),
        [activeChannelId, channels],
    )
    const [channelMembersById, setChannelMembersById] = useState<Record<string, MemberItemProps['member'][]>>({})
    const [channelScopeRefreshVersion, setChannelScopeRefreshVersion] = useState(0)
    const [contextMenu, setContextMenu] = useState<{
        userId: string
        username: string
        role: string
        x: number
        y: number
        canMakeAdmin: boolean
        canAddFriend: boolean
        canKick: boolean
        canBan: boolean
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
    const [banConfirm, setBanConfirm] = useState<{ userId: string; username: string } | null>(null)
    const [profileCard, setProfileCard] = useState<{
        member: MemberItemProps['member']
        isServerOwner: boolean
        x: number
        y: number
    } | null>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const profileRef = useRef<HTMLDivElement>(null)
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

    const isOwner = !!(user && activeServer && activeServer.owner_id === user.id)
    const myRole = members.find((m) => m.user_id === user?.id)?.role ?? 'member'
    const canKickAsRole = isOwner || canKickMembers
    const canBanAsRole = isOwner || canBanMembers

    useEffect(() => {
        return subscribeWs((payload: unknown) => {
            if (!activeServerId || !activeChannelId || !activeChannel || activeChannel.channel_type !== 'text') return
            const evt = payload as { type?: string; data?: { server_id?: string } }
            const sid = evt?.data?.server_id
            if (!sid || sid !== activeServerId) return
            if (
                evt.type === 'ServerChannelsUpdated' ||
                evt.type === 'ServerRolesUpdated' ||
                evt.type === 'MemberRoleUpdated' ||
                evt.type === 'MemberJoined' ||
                evt.type === 'MemberLeft'
            ) {
                setChannelScopeRefreshVersion((v) => v + 1)
            }
        })
    }, [activeChannel, activeChannelId, activeServerId, subscribeWs])

    useEffect(() => {
        if (!activeServerId || !activeChannelId) return
        if (!activeChannel || activeChannel.channel_type !== 'text') return

        let active = true
        serverApi
            .channelMembers(activeServerId, activeChannelId, token)
            .then((rows) => {
                if (!active) return
                setChannelMembersById((prev) => ({
                    ...prev,
                    [activeChannelId]: rows,
                }))
            })
            .catch(() => {
                // Keep fallback rendering from full server member list.
            })

        return () => {
            active = false
        }
    }, [activeChannel, activeChannelId, activeServerId, channelScopeRefreshVersion, token])

    useEffect(() => {
        if (!contextMenu && !profileCard) return
        const close = () => setContextMenu(null)
        const closeProfile = (event: MouseEvent) => {
            if (!profileRef.current) return
            if (profileRef.current.contains(event.target as Node)) return
            setProfileCard(null)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            setContextMenu(null)
            setProfileCard(null)
        }
        window.addEventListener('click', close)
        window.addEventListener('click', closeProfile)
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('scroll', close, true)
        return () => {
            window.removeEventListener('click', close)
            window.removeEventListener('click', closeProfile)
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('scroll', close, true)
        }
    }, [contextMenu, profileCard])

    const canManageRoles = isOwner || canManageRolesFromPerms

    const patchScopedMembers = useCallback(
        (userId: string, patch: Partial<MemberItemProps['member']>) => {
            if (!userId) return
            setChannelMembersById((prev) => {
                let changed = false
                const next: Record<string, MemberItemProps['member'][]> = {}
                for (const [channelId, scopedMembers] of Object.entries(prev)) {
                    let scopedChanged = false
                    const patched = scopedMembers.map((member) => {
                        if (member.user_id !== userId) return member
                        scopedChanged = true
                        changed = true
                        return { ...member, ...patch }
                    })
                    next[channelId] = scopedChanged ? patched : scopedMembers
                }
                return changed ? next : prev
            })
            setProfileCard((prev) =>
                prev && prev.member.user_id === userId
                    ? { ...prev, member: { ...prev.member, ...patch } }
                    : prev,
            )
        },
        [],
    )

    useEffect(() => {
        return subscribeWs((payload: unknown) => {
            const evt = payload as {
                type?: string
                data?: {
                    user_id?: string
                    status?: string
                    user?: { id?: string; username?: string; avatar_url?: string | null; status?: string }
                }
            }

            if (evt?.type === 'PresenceUpdate') {
                const userId = evt.data?.user_id
                const status = evt.data?.status
                if (!userId || !status) return
                patchScopedMembers(userId, { status })
                return
            }

            if (evt?.type === 'UserUpdated') {
                const updated = evt.data?.user
                const userId = updated?.id
                if (!userId) return
                const patch: Partial<MemberItemProps['member']> = {}
                if (typeof updated.username === 'string') patch.username = updated.username
                if ('avatar_url' in (updated ?? {})) patch.avatar_url = updated.avatar_url ?? null
                if (typeof updated.status === 'string') patch.status = updated.status
                if (Object.keys(patch).length === 0) return
                patchScopedMembers(userId, patch)
            }
        })
    }, [patchScopedMembers, subscribeWs])

    const openRoleEditor = useCallback(
        async (memberUserId: string, username: string) => {
            if (!user || !activeServerId || !canManageRoles) return
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
        [activeServerId, canManageRoles, token, user],
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

    const handleBan = useCallback(
        async (memberUserId: string) => {
            if (!activeServerId) return
            setBanConfirm(null)
            try {
                await serverApi.banMember(activeServerId, memberUserId, token)
                const detail = await serverApi.get(activeServerId, token)
                setMembers(detail.members)
            } catch (e) {
                pushToast({
                    level: 'error',
                    title: 'Ban failed',
                    message: e instanceof Error ? e.message : 'Could not ban member.',
                })
            }
        },
        [activeServerId, pushToast, setMembers, token],
    )

    const handleContextMenu = useCallback((
        e: React.MouseEvent,
        member: MemberItemProps['member'],
        canMakeAdmin: boolean,
        canAddFriend: boolean,
        canKick: boolean,
        canBan: boolean
    ) => {
        const optionCount = (canMakeAdmin ? 1 : 0) + (canAddFriend ? 1 : 0) + (canKick ? 1 : 0) + (canBan ? 1 : 0)
        const pos = clampMenuPosition(e.clientX, e.clientY, 176, 8 + optionCount * 38)
        setProfileCard(null)
        setContextMenu({
            userId: member.user_id,
            username: member.username,
            role: member.role,
            x: pos.x,
            y: pos.y,
            canMakeAdmin,
            canAddFriend,
            canKick,
            canBan,
        })
    }, [])

    const handleOpenProfile = useCallback((
        e: React.MouseEvent,
        member: MemberItemProps['member'],
        isServerOwner: boolean,
    ) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        setContextMenu(null)
        const profileWidth = 260
        const profileHeight = 220
        const sidebarRect = sidebarRef.current?.getBoundingClientRect()
        const itemRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const desiredX = (sidebarRect?.left ?? e.clientX) - profileWidth - 12
        const desiredY = itemRect.top - 6
        const pos = clampMenuPosition(desiredX, desiredY, profileWidth, profileHeight)
        setProfileCard((prev) => {
            if (prev?.member.user_id === member.user_id) return null
            return {
                member,
                isServerOwner,
                x: pos.x,
                y: pos.y,
            }
        })
    }, [])

    if (!activeServer) return null

    const status = (m: { status?: string | null }) => (m.status || 'offline').toLowerCase()
    const isOnline = (m: { status?: string | null }) =>
        status(m) === 'online' || status(m) === 'dnd'
    const roleOrder = (r: string) => (r === 'owner' ? 0 : r === 'admin' ? 1 : 2)
    const membersForSidebar =
        activeChannel && activeChannel.channel_type === 'text' && activeChannelId
            ? (channelMembersById[activeChannelId] ?? members)
            : members
    const byRoleThenName = (a: (typeof membersForSidebar)[0], b: (typeof membersForSidebar)[0]) =>
        roleOrder(a.role) - roleOrder(b.role) || a.username.localeCompare(b.username, undefined, { sensitivity: 'base' })
    const onlineMembers = membersForSidebar.filter(isOnline).sort(byRoleThenName)
    const offlineMembers = membersForSidebar.filter((m) => !isOnline(m)).sort(byRoleThenName)
    const friendUsernames = new Set(friends.map((f) => f.username.toLowerCase()))

    return (
        <div className="member-sidebar" ref={sidebarRef}>
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
                            isServerOwner={activeServer.owner_id === member.user_id}
                            currentUserId={user?.id}
                            isFriend={friendUsernames.has(member.username.toLowerCase())}
                            canKickAsRole={canKickAsRole}
                            canBanAsRole={canBanAsRole}
                            canManageRoles={canManageRoles}
                            myRole={myRole}
                            onContextMenu={handleContextMenu}
                            onOpenProfile={handleOpenProfile}
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
                            isServerOwner={activeServer.owner_id === member.user_id}
                            currentUserId={user?.id}
                            isFriend={friendUsernames.has(member.username.toLowerCase())}
                            canKickAsRole={canKickAsRole}
                            canBanAsRole={canBanAsRole}
                            canManageRoles={canManageRoles}
                            myRole={myRole}
                            onContextMenu={handleContextMenu}
                            onOpenProfile={handleOpenProfile}
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
                    {contextMenu.canBan && (
                        <button
                            type="button"
                            className="server-context-menu-item danger"
                            onClick={() => {
                                setBanConfirm({ userId: contextMenu.userId, username: contextMenu.username })
                                setContextMenu(null)
                            }}
                        >
                            Ban user
                        </button>
                    )}
                </div>
            )}

            {profileCard && (
                <div
                    ref={profileRef}
                    className="member-profile-popout"
                    style={{ left: profileCard.x, top: profileCard.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {(() => {
                        const baseRoleNormalized = profileCard.member.role.trim().toLowerCase()
                        const roleSet = new Set<string>()
                        for (const roleName of profileCard.member.roles ?? []) {
                            const trimmed = roleName.trim()
                            if (!trimmed) continue
                            const normalized = trimmed.toLowerCase()
                            if (normalized === 'owner') continue
                            if (normalized === baseRoleNormalized) continue
                            roleSet.add(trimmed)
                        }
                        const roleLabels = Array.from(roleSet)
                        const normalizedRole = profileCard.member.role.trim().toLowerCase()
                        const showBaseRoleBadge =
                            normalizedRole.length > 0
                            && !(profileCard.isServerOwner && normalizedRole === 'owner')
                        return (
                            <>
                    <div className="member-profile-header">
                        <div className="member-profile-avatar">
                            {profileCard.member.avatar_url ? (
                                <img src={profileCard.member.avatar_url} alt="" className="member-avatar-image" />
                            ) : (
                                profileCard.member.username.charAt(0).toUpperCase()
                            )}
                        </div>
                        <div className="member-profile-meta">
                            <div className="member-profile-username">{profileCard.member.username}</div>
                            <div className="member-profile-status">{(profileCard.member.status ?? 'offline').toString().toUpperCase()}</div>
                        </div>
                    </div>
                    <div className="member-profile-badges">
                        {profileCard.isServerOwner && (
                            <span className="member-profile-badge is-owner">Owner</span>
                        )}
                        {showBaseRoleBadge && (
                            <span
                                className="member-profile-badge"
                                style={profileCard.member.role_color ? { borderColor: profileCard.member.role_color, color: profileCard.member.role_color } : undefined}
                            >
                                {profileCard.member.role}
                            </span>
                        )}
                    </div>
                    <div className="member-profile-section">
                        <div className="member-profile-section-title">Server Profile</div>
                        <div className="member-profile-section-value">
                            {profileCard.isServerOwner ? 'Server owner with full access' : `Role: ${profileCard.member.role}`}
                        </div>
                    </div>
                    <div className="member-profile-section">
                        <div className="member-profile-section-title">Roles in server</div>
                        {roleLabels.length > 0 ? (
                            <div className="member-profile-badges member-profile-badges--stack">
                                {roleLabels.map((label) => (
                                    <span
                                        key={label}
                                        className="member-profile-badge"
                                        style={profileCard.member.role_color ? { borderColor: profileCard.member.role_color, color: profileCard.member.role_color } : undefined}
                                    >
                                        {label}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <div className="member-profile-section-value">No custom roles.</div>
                        )}
                    </div>
                            </>
                        )
                    })()}
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
                                className="btn member-role-save-btn"
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
                                        const detail = await serverApi.get(activeServerId, token)
                                        setMembers(detail.members)
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
            {banConfirm && (
                <div className="modal-overlay" onClick={() => setBanConfirm(null)}>
                    <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Ban member</h2>
                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                            Ban <strong>{banConfirm.username}</strong>? They will be removed and blocked from rejoining.
                        </p>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setBanConfirm(null)}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => void handleBan(banConfirm.userId)}
                            >
                                Ban user
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
