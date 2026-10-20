import { useEffect, useState, useRef, useCallback, useMemo, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { COMPACT_LAYOUT_MEDIA_QUERY } from '../layout'
import { useNavigate } from 'react-router'
import { useAuthStore } from '../stores/auth'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { useSocketStore } from '../stores/socket'
import { attachmentApi, resolveServerIconUrl, serverApi, messageApi, channelApi, friendApi, type MessageWithAuthor, type Channel, type ServerRole, type ServerRule, type AuditLogEntry, type ServerBanEntry, type ServerReportEntry, type ServerTimeoutEntry, type RaidEventEntry, type ServerOnboardingGuide, type UpdateServerOnboardingGuideRequest, type WsEvent } from '../api'
import ServerSidebar from '../components/ServerSidebar'
import ChannelSidebar from '../components/ChannelSidebar'
import { useDialogFocus } from '../hooks/useDialogFocus'
import ChatArea from '../components/ChatArea'
import MemberSidebar from '../components/MemberSidebar'
import { type SafetySettingsTab } from '../components/ServerSettingsSafety'
import ServerWelcomeGuide from '../components/ServerWelcomeGuide'
import { joinVoiceChannelFromNavigation } from '../components/voiceChannelNavigation'
import { shouldShowServerWelcomeGuide } from '../serverWelcomeGuideVisibility'
import { useToastStore } from '../stores/toast'
import { activeTimeoutUntil, formatTimeoutUntil } from '../timeouts'
import { X } from 'lucide-react'
import { MAX_CHAT_ATTACHMENT_BYTES, getMaxChatAttachmentMb } from '../attachments'
import {
    applyUploadedDraftAttachments,
    createUploadingDraftAttachments,
    getUploadedDraftAttachments,
    hasPendingDraftAttachments,
    markDraftAttachmentsFailed,
    setDraftAttachmentUploading,
    type DraftAttachmentItem,
} from '../draftAttachments'
import { mergeLatestPageWithHistory, mergeRemoteWithRetryableLocals, reconcileConfirmedMessage, withoutFailedDuplicates } from '../messageResilience'
import { withAuthorsFrom, withUpdatedAuthor } from '../messageAuthors'
import {
    clearMessageDraftIfUnchanged,
    readMessageDraft,
    saveMessageDraft,
} from '../messageDrafts'
import { playMessageNotificationSound, shouldPlayNotificationSound } from '../notificationSound'
import {
    getServerNotificationPreference,
    shouldNotifyForServerMessage,
    shouldTrackServerUnread,
} from '../notificationPreferences'
import { isAppBackgrounded, shouldShowPushNotification, showPushNotification } from '../pushNotifications'
import { getMemberPanelOpen, setMemberPanelOpen } from '../memberPanelPreference'
import { createReplyContentSnippet } from '../replyPreview'
import { countMessageCharacters, MESSAGE_MAX_CHARACTERS } from '../messageLength'
import { createSecureId } from '../secureId'
import { ROUTES } from '../routes'
import { resolveInviteBaseUrl } from '../inviteLinks'
import { handleVoiceMemberMoveRequested } from '../webrtc/voiceMemberMove'
import type { UiMessage, ServerSettingsLocalTab, ServerSettingsOpenTab } from './appLayoutModel'
import { isSafetySettingsTab, normalizeServerSettingsTab, MESSAGE_PAGE_SIZE, REPORT_REASONS, PERM_VIEW_SERVER, PERM_MANAGE_SERVER, PERM_MANAGE_ROLES, PERM_MANAGE_CHANNELS, PERM_KICK_MEMBERS, PERM_BAN_MEMBERS, PERM_VIEW_AUDIT_LOG, PERM_SEND_MESSAGES, PERM_MANAGE_MESSAGES, PERM_MANAGE_PINS, PERM_CONNECT_VOICE, PERM_MUTE_MEMBERS, PERM_DEAFEN_MEMBERS, PERM_MOVE_MEMBERS, validateChannelNameInput, validateCategoryNameInput, validateChannelDescriptionInput, parseInviteInput, compareChannelsForSidebar, getStoredChannelId, setStoredChannelId, isWelcomeGuideDismissed, dismissWelcomeGuide, messageMentionsUser, removalNoticeFor } from './appLayoutModel'
import ServerSettingsModal from './ServerSettingsModal'
import ServerCreationDialogs from './ServerCreationDialogs'
import ServerConfirmDialogs from './ServerConfirmDialogs'

export interface AppLayoutProps {
    /** When true, do not render ServerSidebar (used inside UnifiedLayout which has its own sidebar). */
    skipServerSidebar?: boolean
    /** When true, the server chat view is visible (e.g. user switched from DM to Servers); used to scroll to bottom on re-enter. */
    isViewActive?: boolean
    serverDialogTriggerRef?: RefObject<HTMLElement | null>
}


export default function AppLayout({ skipServerSidebar = false, isViewActive, serverDialogTriggerRef: externalServerDialogTriggerRef }: AppLayoutProps) {
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024
    const { token, user } = useAuthStore()
    const navigate = useNavigate()
    const {
        servers, serversLoading, activeServerId, activeChannelId, channels, members,
        setServers, setServersLoading, setActiveServer, setActiveChannel, setChannels, setMembers,
        setChannelsForServer, setMembersForServer,
        channelsByServerId,
        setFriends,
        voiceControls,
        serverUnreadByChannel,
        serverMentionsByChannel,
        incrementServerUnread,
        incrementServerMention,
        clearServerUnread,
        clearServerMention,
        mutedServerIds,
        mutedChannelIds,
        setShowCreateServer, setShowJoinServer,
        showCreateServer, showJoinServer,
        openServerSettingsForServerId,
        setOpenServerSettingsForServerId,
        openServerSettingsForServerTab,
        setOpenServerSettingsForServerTab,
        mobileSidebarPanel,
        setMobileSidebarPanel,
    } = useAppStore(
        useShallow((s) => ({
            servers: s.servers,
            serversLoading: s.serversLoading,
            activeServerId: s.activeServerId,
            activeChannelId: s.activeChannelId,
            channels: s.channels,
            members: s.members,
            setServers: s.setServers,
            setServersLoading: s.setServersLoading,
            setActiveServer: s.setActiveServer,
            setActiveChannel: s.setActiveChannel,
            setChannels: s.setChannels,
            setMembers: s.setMembers,
            setChannelsForServer: s.setChannelsForServer,
            setMembersForServer: s.setMembersForServer,
            channelsByServerId: s.channelsByServerId,
            friends: s.friends,
            setFriends: s.setFriends,
            dmChannels: s.dmChannels,
            setDmChannels: s.setDmChannels,
            setActiveDmChannelId: s.setActiveDmChannelId,
            setDmChannelIds: s.setDmChannelIds,
            voiceControls: s.voiceControls,
            serverUnreadByChannel: s.serverUnreadByChannel,
            serverMentionsByChannel: s.serverMentionsByChannel,
            incrementServerUnread: s.incrementServerUnread,
            incrementServerMention: s.incrementServerMention,
            clearServerUnread: s.clearServerUnread,
            clearServerMention: s.clearServerMention,
            mutedServerIds: s.mutedServerIds,
            mutedChannelIds: s.mutedChannelIds,
            setShowCreateServer: s.setShowCreateServer,
            setShowJoinServer: s.setShowJoinServer,
            showCreateServer: s.showCreateServer,
            showJoinServer: s.showJoinServer,
            openServerSettingsForServerId: s.openServerSettingsForServerId,
            setOpenServerSettingsForServerId: s.setOpenServerSettingsForServerId,
            openServerSettingsForServerTab: s.openServerSettingsForServerTab,
            setOpenServerSettingsForServerTab: s.setOpenServerSettingsForServerTab,
            mobileSidebarPanel: s.mobileSidebarPanel,
            setMobileSidebarPanel: s.setMobileSidebarPanel,
        }))
    )

    const [messages, setMessages] = useState<UiMessage[]>([])
    const [messageInput, setMessageInput] = useState('')
    const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; contentSnippet: string } | null>(null)
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [editingContent, setEditingContent] = useState('')
    const [editingReplyQuotePart, setEditingReplyQuotePart] = useState<string | null>(null)
    const [draftAttachments, setDraftAttachments] = useState<DraftAttachmentItem[]>([])
    const [emptyInviteCopied, setEmptyInviteCopied] = useState(false)
    const [newServerName, setNewServerName] = useState('')
    const [newServerDescription, setNewServerDescription] = useState('')
    const [inviteCode, setInviteCode] = useState('')
    const [createServerError, setCreateServerError] = useState<string | null>(null)
    const [isCreatingServer, setIsCreatingServer] = useState(false)
    const [joinServerError, setJoinServerError] = useState<string | null>(null)
    const [showServerSettings, setShowServerSettings] = useState(false)
    const [serverSettingsServerId, setServerSettingsServerId] = useState<string | null>(null)
    const [serverSettingsTab, setServerSettingsTab] = useState<ServerSettingsLocalTab>('overview')
    const [safetySettingsTab, setSafetySettingsTab] = useState<SafetySettingsTab>('reports')
    const [isMobileViewport, setIsMobileViewport] = useState(() =>
        typeof window !== 'undefined' ? window.matchMedia(COMPACT_LAYOUT_MEDIA_QUERY).matches : false,
    )
    const [memberPanelOpen, setMemberPanelOpenState] = useState(getMemberPanelOpen)
    const toggleMemberPanel = useCallback(() => {
        setMemberPanelOpenState((open) => !open)
    }, [])

    useEffect(() => {
        setMemberPanelOpen(memberPanelOpen)
    }, [memberPanelOpen])

    useEffect(() => {
        setMessageInput(readMessageDraft(user?.id, 'channel', activeChannelId))
        setDraftAttachments([])
    }, [activeChannelId, user?.id])

    const handleMessageInputChange = useCallback((value: string) => {
        setMessageInput(value)
        saveMessageDraft(user?.id, 'channel', activeChannelId, value)
    }, [activeChannelId, user?.id])
    const [serverSettingsName, setServerSettingsName] = useState('')
    const [serverSettingsDescription, setServerSettingsDescription] = useState('')
    const [serverSettingsIconDraft, setServerSettingsIconDraft] = useState<string | null | undefined>(undefined)
    const [serverIconEditor, setServerIconEditor] = useState<{ file: File; key: number } | null>(null)
    const serverIconEditorKeyRef = useRef(0)
    const [serverSettingsError, setServerSettingsError] = useState<string | null>(null)
    const [showDeleteServerConfirm, setShowDeleteServerConfirm] = useState(false)
    const [deleteServerInput, setDeleteServerInput] = useState('')
    const [deleteServerError, setDeleteServerError] = useState<string | null>(null)
    const [showCreateChannel, setShowCreateChannel] = useState(false)
    const [showCreateCategory, setShowCreateCategory] = useState(false)
    const [createChannelName, setCreateChannelName] = useState('')
    const [createChannelType, setCreateChannelType] = useState<'text' | 'voice'>('text')
    const [createChannelCategory, setCreateChannelCategory] = useState('')
    const [createChannelDescription, setCreateChannelDescription] = useState('')
    const [createChannelError, setCreateChannelError] = useState<string | null>(null)
    const [createCategoryName, setCreateCategoryName] = useState('')
    const [createCategoryError, setCreateCategoryError] = useState<string | null>(null)
    const [channelCategoriesByServerId, setChannelCategoriesByServerId] = useState<Record<string, string[]>>({})
    const channelCategories = useMemo(
        () => activeServerId ? (channelCategoriesByServerId[activeServerId] ?? []) : [],
        [activeServerId, channelCategoriesByServerId],
    )
    const setChannelCategoriesForServer = useCallback((serverId: string, categories: string[]) => {
        setChannelCategoriesByServerId((current) => ({ ...current, [serverId]: categories }))
    }, [])
    const [categoryPermissionsTarget, setCategoryPermissionsTarget] = useState<string | null>(null)
    const [deleteCategoryConfirm, setDeleteCategoryConfirm] = useState<string | null>(null)
    const [deleteCategoryError, setDeleteCategoryError] = useState<string | null>(null)
    const [showRenameCategory, setShowRenameCategory] = useState(false)
    const [renameCategoryFrom, setRenameCategoryFrom] = useState<string | null>(null)
    const [renameCategoryName, setRenameCategoryName] = useState('')
    const [renameCategoryError, setRenameCategoryError] = useState<string | null>(null)
    const [showRenameChannel, setShowRenameChannel] = useState(false)
    const [renameChannelId, setRenameChannelId] = useState<string | null>(null)
    const [renameChannelName, setRenameChannelName] = useState('')
    const [renameChannelDescription, setRenameChannelDescription] = useState('')
    const [renameChannelError, setRenameChannelError] = useState<string | null>(null)
    const [channelServerMap, setChannelServerMap] = useState<Record<string, string>>({})
    const [deleteMessageConfirmId, setDeleteMessageConfirmId] = useState<string | null>(null)
    const [deleteChannelConfirm, setDeleteChannelConfirm] = useState<Channel | null>(null)
    const [channelSettingsTarget, setChannelSettingsTarget] = useState<Channel | null>(null)
    const [copiedInvite, setCopiedInvite] = useState<'link' | 'code' | null>(null)
    const [hasMoreOlder, setHasMoreOlder] = useState(true)
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [olderMessagesReady, setOlderMessagesReady] = useState(false)
    const [channelUnreadDividerCount, setChannelUnreadDividerCount] = useState(0)
    const [channelSearch, setChannelSearch] = useState('')
    const [channelSearchResults, setChannelSearchResults] = useState<MessageWithAuthor[] | null>(null)
    const [channelPins, setChannelPins] = useState<MessageWithAuthor[]>([])
    const [pinnedJumpTargetId, setPinnedJumpTargetId] = useState<string | null>(null)
    const [pinnedJumpLoadingId, setPinnedJumpLoadingId] = useState<string | null>(null)
    const [historicalChannelId, setHistoricalChannelId] = useState<string | null>(null)
    const [returningToLatest, setReturningToLatest] = useState(false)
    const [showMobileMemberSheet, setShowMobileMemberSheet] = useState(false)
    const [serverBootstrapLoadingId, setServerBootstrapLoadingId] = useState<string | null>(null)
    const [serverListReady, setServerListReady] = useState(false)
    const currentServerMember = useMemo(
        () => (user?.id ? members.find((member) => member.user_id === user.id) ?? null : null),
        [members, user?.id],
    )
    const pushToast = useToastStore((s) => s.pushToast)
    const { connect, send, subscribe, isConnected, onReconnect } = useSocketStore()
    const [showUnsavedServerSettingsConfirm, setShowUnsavedServerSettingsConfirm] = useState(false)
    const [serverRoles, setServerRoles] = useState<ServerRole[]>([])
    const [visibleRoleCount, setVisibleRoleCount] = useState(40)
    const [rolesLoading, setRolesLoading] = useState(false)
    const [rolesError, setRolesError] = useState<string | null>(null)
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
    const [draggingRoleId, setDraggingRoleId] = useState<string | null>(null)
    const [roleEditName, setRoleEditName] = useState('')
    const [roleEditPermissions, setRoleEditPermissions] = useState(0)
    const [roleEditPreAdminPermissions, setRoleEditPreAdminPermissions] = useState<number | null>(null)
    const [roleEditColor, setRoleEditColor] = useState<string | null>(null)
    const [deleteRoleConfirmId, setDeleteRoleConfirmId] = useState<string | null>(null)
    const [serverRules, setServerRules] = useState<ServerRule[]>([])
    const [rulesLoading, setRulesLoading] = useState(false)
    const [rulesError, setRulesError] = useState<string | null>(null)
    const [newRuleText, setNewRuleText] = useState('')
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
    const [editingRuleText, setEditingRuleText] = useState('')
    const [activeOnboardingGuide, setActiveOnboardingGuide] = useState<ServerOnboardingGuide | null>(null)
    const [welcomeGuideDismissed, setWelcomeGuideDismissed] = useState(false)
    const [settingsOnboardingGuide, setSettingsOnboardingGuide] = useState<ServerOnboardingGuide | null>(null)
    const [onboardingLoading, setOnboardingLoading] = useState(false)
    const [onboardingSaving, setOnboardingSaving] = useState(false)
    const [onboardingError, setOnboardingError] = useState<string | null>(null)
    const [auditLogEntries, setAuditLogEntries] = useState<AuditLogEntry[] | null>(null)
    const [auditLogLoading, setAuditLogLoading] = useState(false)
    const [auditLogLoadingMore, setAuditLogLoadingMore] = useState(false)
    const [auditLogError, setAuditLogError] = useState<string | null>(null)
    const [auditLogActionFilter, setAuditLogActionFilter] = useState('')
    const [auditLogNextBefore, setAuditLogNextBefore] = useState<string | null>(null)
    const auditLogRequestSequence = useRef(0)
    const [reportEntries, setReportEntries] = useState<ServerReportEntry[] | null>(null)
    const [reportEntriesLoading, setReportEntriesLoading] = useState(false)
    const [reportEntriesError, setReportEntriesError] = useState<string | null>(null)
    const [resolveReportInFlightId, setResolveReportInFlightId] = useState<string | null>(null)
    const [timeoutEntries, setTimeoutEntries] = useState<ServerTimeoutEntry[] | null>(null)
    const [raidEventEntries, setRaidEventEntries] = useState<RaidEventEntry[] | null>(null)
    const [clearTimeoutInFlightUserId, setClearTimeoutInFlightUserId] = useState<string | null>(null)
    const [banEntries, setBanEntries] = useState<ServerBanEntry[] | null>(null)
    const [banEntriesLoading, setBanEntriesLoading] = useState(false)
    const [banEntriesError, setBanEntriesError] = useState<string | null>(null)
    const [unbanInFlightUserId, setUnbanInFlightUserId] = useState<string | null>(null)
    const [reportTarget, setReportTarget] = useState<{
        kind: 'user' | 'message'
        userId: string
        username: string
        messageId?: string
        messageContent?: string
    } | null>(null)
    const [reportReason, setReportReason] = useState<(typeof REPORT_REASONS)[number]['value']>('spam')
    const [reportDetails, setReportDetails] = useState('')
    const [reportSubmitting, setReportSubmitting] = useState(false)
    const memberUsernameById = useMemo(() => {
        const byId = new Map<string, string>()
        for (const member of members) byId.set(member.user_id, member.username)
        return byId
    }, [members])
    const allKnownChannelIds = useMemo(() => {
        const seen = new Set<string>()
        for (const channel of channels) seen.add(channel.id)
        Object.values(channelsByServerId).forEach((serverChannels) => {
            serverChannels.forEach((channel) => seen.add(channel.id))
        })
        return Array.from(seen)
    }, [channels, channelsByServerId])
    const visibleServerRoles = useMemo(
        () => serverRoles.slice(0, Math.min(visibleRoleCount, serverRoles.length)),
        [serverRoles, visibleRoleCount]
    )
    const hasMoreServerRoles = visibleServerRoles.length < serverRoles.length

    // Refs to avoid stale closures in WebSocket handlers
    const activeChannelIdRef = useRef(activeChannelId)
    const pendingMessageFingerprintsRef = useRef(new Set<string>())
    const activeServerIdRef = useRef(activeServerId)
    const channelServerMapRef = useRef<Record<string, string>>({})
    const tokenRef = useRef(token)
    const selectedRoleIdRef = useRef<string | null>(selectedRoleId)
    const createServerInFlightRef = useRef(false)
    const createServerRequestIdRef = useRef<string | null>(null)
    const serverDialogRef = useRef<HTMLFormElement | null>(null)
    const serverDialogTriggerRef = useRef<HTMLElement | null>(null)
    const serverSettingsReturnFocusRef = useRef<HTMLElement | null>(null)
    const channelDialogReturnFocusRef = useRef<HTMLElement | null>(null)
    const serverIconInputRef = useRef<HTMLInputElement | null>(null)
    const messagesByChannelRef = useRef<Record<string, UiMessage[]>>({})
    const historicalChannelIdRef = useRef<string | null>(null)
    const serverBootstrapRequestRef = useRef(0)
    const channelMessagesRequestRef = useRef(0)

    useDialogFocus(serverDialogRef, showCreateServer || showJoinServer, undefined, serverDialogTriggerRef)

    useEffect(() => { activeChannelIdRef.current = activeChannelId }, [activeChannelId])
    useEffect(() => { activeServerIdRef.current = activeServerId }, [activeServerId])
    useEffect(() => { channelServerMapRef.current = channelServerMap }, [channelServerMap])
    useEffect(() => { tokenRef.current = token }, [token])
    useEffect(() => { selectedRoleIdRef.current = selectedRoleId }, [selectedRoleId])

    useEffect(() => {
        setEditingMessageId(null)
        setEditingContent('')
        setEditingReplyQuotePart(null)
        setReplyingTo(null)
    }, [activeChannelId])

    // ─── Data Fetching ─────────────────────────
    // Use user (not token) so web works: on web token is null and auth is via httpOnly cookie.
    const isLoggedIn = !!user
    const inviteBaseUrl = resolveInviteBaseUrl()

    useEffect(() => {
        if (!isLoggedIn) {
            setChannelCategoriesByServerId({})
            setServerBootstrapLoadingId(null)
        }
    }, [isLoggedIn])

    useEffect(() => {
        if (!isLoggedIn) {
            setServerListReady(false)
            return
        }
        setServerListReady(false)
        setServersLoading(true)
        serverApi.list(token)
            .then(setServers)
            .catch(console.error)
            .finally(() => {
                setServerListReady(true)
                setServersLoading(false)
            })
    }, [isLoggedIn, token, setServers, setServersLoading])

    useEffect(() => {
        if (!isLoggedIn || servers.length === 0) return
        const missingServerIds = servers
            .map((server) => server.id)
            .filter((serverId) => !(serverId in channelsByServerId))
        if (missingServerIds.length === 0) return
        let cancelled = false
        void Promise.all(
            missingServerIds.map(async (serverId) => {
                try {
                    const chs = await serverApi.channels(serverId, token)
                    if (!cancelled) {
                        setChannelsForServer(serverId, chs)
                        setChannelServerMap((prev) => {
                            const next = { ...prev }
                            for (const ch of chs) next[ch.id] = ch.server_id
                            return next
                        })
                    }
                } catch {
                    // ignore prefetch failures; active server fetch still handles visible route
                }
            }),
        )
        return () => {
            cancelled = true
        }
    }, [channelsByServerId, isLoggedIn, servers, setChannelsForServer, token])

    useEffect(() => {
        if (!isLoggedIn) return
        friendApi.list(token).then(setFriends).catch(() => { })
    }, [isLoggedIn, token, setFriends])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const media = window.matchMedia(COMPACT_LAYOUT_MEDIA_QUERY)
        const sync = () => setIsMobileViewport(media.matches)
        sync()
        media.addEventListener('change', sync)
        return () => media.removeEventListener('change', sync)
    }, [])

    useEffect(() => {
        if (!isMobileViewport) setShowMobileMemberSheet(false)
    }, [isMobileViewport])

    useEffect(() => {
        if (typeof document === 'undefined') return
        const root = document.documentElement
        if (isMobileViewport && showMobileMemberSheet) {
            root.classList.add('mobile-member-sheet-open')
            return () => {
                root.classList.remove('mobile-member-sheet-open')
            }
        }
        root.classList.remove('mobile-member-sheet-open')
        return () => {
            root.classList.remove('mobile-member-sheet-open')
        }
    }, [isMobileViewport, showMobileMemberSheet])

    useEffect(() => {
        if (!isMobileViewport || !showMobileMemberSheet) return
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const closeButton = document.querySelector<HTMLElement>('.mobile-member-sheet-close')
        closeButton?.focus()
        const onKeyDown = (event: KeyboardEvent) => {
            if (document.querySelector('.member-profile-dialog, .member-context-menu')) return
            if (event.key === 'Escape') {
                event.preventDefault()
                setShowMobileMemberSheet(false)
            } else if (event.key === 'Tab') {
                const controls = Array.from(document.querySelectorAll<HTMLElement>('.mobile-member-sheet button:not(:disabled), .mobile-member-sheet [href]'))
                    .filter((control) => control.getClientRects().length > 0)
                if (controls.length === 0) return
                const first = controls[0]
                const last = controls[controls.length - 1]
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault()
                    last.focus()
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault()
                    first.focus()
                }
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            previousFocus?.focus()
        }
    }, [isMobileViewport, showMobileMemberSheet])

    useEffect(() => {
        setShowMobileMemberSheet(false)
    }, [activeServerId, activeChannelId])

    // Auto-select a default server (prefer the Voxpery default server) when logging in.
    useEffect(() => {
        if (!isLoggedIn) return
        if (activeServerId || servers.length === 0) return
        const preferred = servers.find((s) => s.invite_code === 'voxpery' || s.name === 'Voxpery') || servers[0]
        if (preferred) {
            setActiveServer(preferred.id)
        }
    }, [activeServerId, servers, setActiveServer, isLoggedIn])

    // When unified sidebar requested server settings for this server, open the modal.
    useEffect(() => {
        if (!openServerSettingsForServerId || openServerSettingsForServerId !== activeServerId) return
        const initialTab = openServerSettingsForServerTab ?? 'overview'
        if (isSafetySettingsTab(initialTab)) setSafetySettingsTab(initialTab)
        setServerSettingsTab(normalizeServerSettingsTab(initialTab))
        setServerSettingsServerId(activeServerId)
        setShowServerSettings(true)
        setOpenServerSettingsForServerId(null)
        setOpenServerSettingsForServerTab(null)
    }, [
        activeServerId,
        openServerSettingsForServerId,
        openServerSettingsForServerTab,
        setOpenServerSettingsForServerId,
        setOpenServerSettingsForServerTab,
    ])

    useEffect(() => {
        if (!activeServerId || !isLoggedIn) return
        const serverId = activeServerId
        const requestId = ++serverBootstrapRequestRef.current
        let cancelled = false
        const hasCachedChannels = (useAppStore.getState().channelsByServerId[serverId] ?? []).length > 0
        setServerBootstrapLoadingId(hasCachedChannels ? null : serverId)
        Promise.all([
            serverApi.channels(serverId, token),
            channelApi.listCategories(serverId, token).catch(() => []),
        ]).then(([chs, categories]) => {
            setChannelsForServer(serverId, chs)
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            if (cancelled || requestId !== serverBootstrapRequestRef.current || activeServerIdRef.current !== serverId) {
                return
            }
            setChannels(chs)
            setChannelCategoriesForServer(serverId, categories.map((c) => c.name))
            const currentActive = activeChannelIdRef.current
            const stillValid = !!currentActive && chs.some((c) => c.id === currentActive)
            if (!stillValid) {
                const stored = getStoredChannelId(serverId)
                const storedValid = !!stored && chs.some((c) => c.id === stored && c.channel_type === 'text')
                const target = storedValid ? stored : (chs.find((c) => c.channel_type === 'text')?.id ?? chs[0]?.id ?? null)
                setActiveChannel(target)
            }
        }).catch(console.error).finally(() => {
            if (!cancelled && requestId === serverBootstrapRequestRef.current && activeServerIdRef.current === serverId) {
                setServerBootstrapLoadingId(null)
            }
        })

        serverApi.get(serverId, token).then((detail) => {
            setMembersForServer(serverId, detail.members)
            setMyServerPermissions((prev) => ({ ...prev, [detail.id]: detail.my_permissions ?? 0 }))
            if (!cancelled && requestId === serverBootstrapRequestRef.current && activeServerIdRef.current === serverId) {
                setMembers(detail.members)
            }
        }).catch(console.error)
        return () => {
            cancelled = true
        }
    }, [activeServerId, isLoggedIn, token, setActiveChannel, setChannelCategoriesForServer, setChannels, setMembers, setChannelsForServer, setMembersForServer])

    useEffect(() => {
        if (!activeServerId || !isLoggedIn) {
            setActiveOnboardingGuide(null)
            setWelcomeGuideDismissed(false)
            return
        }

        const serverId = activeServerId
        let cancelled = false
        setActiveOnboardingGuide(null)
        setWelcomeGuideDismissed(isWelcomeGuideDismissed(serverId))
        serverApi.getOnboardingGuide(serverId, token)
            .then((guide) => {
                if (!cancelled && activeServerIdRef.current === serverId) {
                    setActiveOnboardingGuide(guide)
                }
            })
            .catch(() => {
                if (!cancelled && activeServerIdRef.current === serverId) {
                    setActiveOnboardingGuide(null)
                }
            })

        return () => {
            cancelled = true
        }
    }, [activeServerId, isLoggedIn, token])

    const refreshActiveServerView = useCallback(async (serverId: string) => {
        if (!isLoggedIn) return
        try {
            const [chs, categories, detail] = await Promise.all([
                serverApi.channels(serverId, token),
                channelApi.listCategories(serverId, token).catch(() => []),
                serverApi.get(serverId, token),
            ])
            setChannelsForServer(serverId, chs)
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            setMembersForServer(serverId, detail.members)
            setMyServerPermissions((prev) => ({ ...prev, [detail.id]: detail.my_permissions ?? 0 }))
            if (activeServerIdRef.current === serverId) {
                setChannels(chs)
                setChannelCategoriesForServer(serverId, categories.map((c) => c.name))
                setMembers(detail.members)
            }
        } catch (err) {
            console.error(err)
        }
    }, [isLoggedIn, token, setChannelCategoriesForServer, setChannels, setChannelsForServer, setMembers, setMembersForServer])

    useEffect(() => {
        if (activeServerId && activeChannelId) {
            const currentChannel = channels.find((c) => c.id === activeChannelId)
            if (currentChannel && currentChannel.server_id === activeServerId && currentChannel.channel_type === 'text') {
                setStoredChannelId(activeServerId, activeChannelId)
            }
        }
    }, [activeServerId, activeChannelId, channels])

    useEffect(() => {
        if (!activeChannelId || !isLoggedIn) return
        const channelId = activeChannelId
        const requestId = ++channelMessagesRequestRef.current
        let cancelled = false
        setChannelSearch('')
        setChannelSearchResults(null)
        setPinnedJumpTargetId(null)
        setPinnedJumpLoadingId(null)
        setHistoricalChannelId(null)
        setHasMoreOlder(true)
        setOlderMessagesReady(false)
        const cached = historicalChannelIdRef.current === channelId ? undefined : messagesByChannelRef.current[channelId]
        setMessages(cached ?? [])
        messageApi.list(channelId, token, undefined, MESSAGE_PAGE_SIZE).then((rows) => {
            const ui = rows.map((m) => ({ ...m, clientStatus: undefined, clientId: undefined, clientError: undefined, clientDraft: undefined }))
            const merged = mergeLatestPageWithHistory(ui, withAuthorsFrom(cached ?? [], ui))
            if (cancelled || requestId !== channelMessagesRequestRef.current || activeChannelIdRef.current !== channelId) {
                return
            }
            messagesByChannelRef.current[channelId] = merged
            setMessages(merged)
            setHasMoreOlder(rows.length >= MESSAGE_PAGE_SIZE)
            setOlderMessagesReady(true)
            if (historicalChannelIdRef.current === channelId) historicalChannelIdRef.current = null
        }).catch((err) => {
            console.error(err)
            if (cancelled || requestId !== channelMessagesRequestRef.current || activeChannelIdRef.current !== channelId) {
                return
            }
            setHasMoreOlder(false)
            setOlderMessagesReady(true)
        })
        return () => {
            cancelled = true
        }
    }, [activeChannelId, isLoggedIn, token])

    const refreshActiveChannelMessages = useCallback(async (channelId: string) => {
        if (!isLoggedIn) return
        const requestId = ++channelMessagesRequestRef.current
        try {
            const cached = messagesByChannelRef.current[channelId] ?? []
            const rows = await messageApi.list(channelId, token, undefined, MESSAGE_PAGE_SIZE)
            if (requestId !== channelMessagesRequestRef.current) return
            const ui = rows.map((m) => ({ ...m, clientStatus: undefined, clientId: undefined, clientError: undefined, clientDraft: undefined }))
            const merged = mergeLatestPageWithHistory(ui, withAuthorsFrom(cached, ui))
            messagesByChannelRef.current[channelId] = merged
            if (activeChannelIdRef.current === channelId) {
                setMessages(merged)
                setHistoricalChannelId(null)
                if (historicalChannelIdRef.current === channelId) historicalChannelIdRef.current = null
                setHasMoreOlder(rows.length >= MESSAGE_PAGE_SIZE)
                setOlderMessagesReady(true)
            }
        } catch (err) {
            console.error(err)
            if (activeChannelIdRef.current === channelId) {
                setHasMoreOlder(false)
                setOlderMessagesReady(true)
            }
        }
    }, [isLoggedIn, token])

    useEffect(() => {
        if (!activeChannelId || !isLoggedIn) return
        const channelId = activeChannelId
        let cancelled = false
        const q = channelSearch.trim()
        if (!q) {
            setChannelSearchResults(null)
            return
        }
        setChannelSearchResults(null)
        const id = window.setTimeout(() => {
            messageApi.search(channelId, q, token)
                .then((rows) => {
                    if (!cancelled && activeChannelIdRef.current === channelId) setChannelSearchResults(rows)
                })
                .catch(() => {
                    if (!cancelled && activeChannelIdRef.current === channelId) setChannelSearchResults([])
                })
        }, 220)
        return () => {
            cancelled = true
            window.clearTimeout(id)
        }
    }, [activeChannelId, channelSearch, token, isLoggedIn])

    useEffect(() => {
        if (!activeChannelId || !isLoggedIn) return
        const channelId = activeChannelId
        let cancelled = false
        messageApi.listPins(channelId, token)
            .then((pins) => {
                if (!cancelled && activeChannelIdRef.current === channelId) setChannelPins(pins)
            })
            .catch(() => {
                if (!cancelled && activeChannelIdRef.current === channelId) setChannelPins([])
            })
        return () => {
            cancelled = true
        }
    }, [activeChannelId, token, isLoggedIn])

    const refreshChannelPins = useCallback(() => {
        if (!activeChannelId) return
        const channelId = activeChannelId
        messageApi.listPins(channelId, token)
            .then((pins) => {
                if (activeChannelIdRef.current === channelId) setChannelPins(pins)
            })
            .catch(() => {
                if (activeChannelIdRef.current === channelId) setChannelPins([])
            })
    }, [activeChannelId, token])

    useEffect(() => {
        if (!isLoggedIn) return
        const unsubscribe = onReconnect(() => {
            setServersLoading(true)
            serverApi.list(token)
                .then(setServers)
                .catch(() => {})
                .finally(() => setServersLoading(false))

            friendApi.list(token).then(setFriends).catch(() => {})

            const currentServerId = activeServerIdRef.current
            if (currentServerId) {
                void refreshActiveServerView(currentServerId)
            }

            const currentChannelId = activeChannelIdRef.current
            if (currentChannelId) {
                void refreshActiveChannelMessages(currentChannelId)
                messageApi.listPins(currentChannelId, token)
                    .then((pins) => {
                        if (activeChannelIdRef.current === currentChannelId) setChannelPins(pins)
                    })
                    .catch(() => {
                        if (activeChannelIdRef.current === currentChannelId) setChannelPins([])
                    })
            }
        })
        return () => unsubscribe()
    }, [isLoggedIn, onReconnect, refreshActiveChannelMessages, refreshActiveServerView, setFriends, setServers, setServersLoading, token])

    const handlePinChannelMessage = useCallback(async (messageId: string) => {
        if (!activeChannelId || !isLoggedIn) return
        try {
            await messageApi.pinMessage(activeChannelId, messageId, token)
            refreshChannelPins()
        } catch (e) {
            pushToast({ level: 'error', title: 'Pin failed', message: e instanceof Error ? e.message : 'Failed to pin' })
        }
    }, [activeChannelId, token, isLoggedIn, refreshChannelPins, pushToast])

    const handleUnpinChannelMessage = useCallback(async (messageId: string) => {
        if (!activeChannelId || !isLoggedIn) return
        try {
            await messageApi.unpinMessage(activeChannelId, messageId, token)
            refreshChannelPins()
        } catch (e) {
            pushToast({ level: 'error', title: 'Unpin failed', message: e instanceof Error ? e.message : 'Failed to unpin' })
        }
    }, [activeChannelId, token, isLoggedIn, refreshChannelPins, pushToast])

    const loadOlderMessages = useCallback(async () => {
        if (!activeChannelId || !isLoggedIn || loadingOlder || !hasMoreOlder) return
        const channelId = activeChannelId
        const requestId = channelMessagesRequestRef.current
        const current = messagesByChannelRef.current[channelId] ?? []
        const oldestId = current[0]?.id
        if (!oldestId) return
        setLoadingOlder(true)
        try {
            const rows = await messageApi.list(channelId, token, oldestId, MESSAGE_PAGE_SIZE)
            if (requestId !== channelMessagesRequestRef.current || activeChannelIdRef.current !== channelId) return
            const ui = rows.map((m) => ({ ...m, clientStatus: undefined, clientId: undefined, clientError: undefined, clientDraft: undefined }))
            const merged = [...ui, ...current]
            messagesByChannelRef.current[channelId] = merged
            if (activeChannelIdRef.current !== channelId) return
            setMessages(merged)
            if (rows.length < MESSAGE_PAGE_SIZE) setHasMoreOlder(false)
        } catch (e) {
            console.error('Load older messages failed', e)
        } finally {
            setLoadingOlder(false)
        }
    }, [activeChannelId, isLoggedIn, token, loadingOlder, hasMoreOlder])

    const handleJumpToPinnedMessage = useCallback(async (messageId: string, source: 'pin' | 'search' = 'pin') => {
        if (!activeChannelId || !isLoggedIn || pinnedJumpLoadingId) return
        const channelId = activeChannelId
        if (messages.some((message) => message.id === messageId)) {
            setPinnedJumpTargetId(messageId)
            return
        }
        const requestId = ++channelMessagesRequestRef.current
        setPinnedJumpLoadingId(messageId)
        try {
            const rows = await messageApi.around(channelId, messageId, token, MESSAGE_PAGE_SIZE)
            if (requestId !== channelMessagesRequestRef.current || activeChannelIdRef.current !== channelId) return
            if (!rows.some((message) => message.id === messageId)) {
                throw new Error('Message not found in this channel')
            }
            const ui = rows.map((message) => ({ ...message, clientStatus: undefined, clientId: undefined, clientError: undefined, clientDraft: undefined }))
            messagesByChannelRef.current[channelId] = ui
            setMessages(ui)
            setHasMoreOlder(true)
            setOlderMessagesReady(true)
            setHistoricalChannelId(channelId)
            historicalChannelIdRef.current = channelId
            setPinnedJumpTargetId(messageId)
        } catch (error) {
            if (requestId !== channelMessagesRequestRef.current || activeChannelIdRef.current !== channelId) return
            pushToast({
                level: 'error',
                title: 'Message unavailable',
                message: error instanceof Error && error.message.includes('Message not found')
                    ? `This ${source === 'pin' ? 'pinned ' : ''}message is no longer available.`
                    : `Could not load this ${source === 'pin' ? 'pinned ' : ''}message. Try again.`,
            })
            if (source === 'pin') refreshChannelPins()
        } finally {
            if (requestId === channelMessagesRequestRef.current) setPinnedJumpLoadingId(null)
        }
    }, [activeChannelId, isLoggedIn, messages, pinnedJumpLoadingId, pushToast, refreshChannelPins, token])

    const handleReturnToLatest = useCallback(async () => {
        if (!activeChannelId || !isLoggedIn || returningToLatest) return
        const channelId = activeChannelId
        const requestId = ++channelMessagesRequestRef.current
        setReturningToLatest(true)
        try {
            const rows = await messageApi.list(channelId, token, undefined, MESSAGE_PAGE_SIZE)
            if (requestId !== channelMessagesRequestRef.current || activeChannelIdRef.current !== channelId) return
            const ui = rows.map((message) => ({ ...message, clientStatus: undefined, clientId: undefined, clientError: undefined, clientDraft: undefined }))
            const merged = mergeRemoteWithRetryableLocals(ui, messagesByChannelRef.current[channelId] ?? [])
            messagesByChannelRef.current[channelId] = merged
            setMessages(merged)
            setHasMoreOlder(rows.length >= MESSAGE_PAGE_SIZE)
            setHistoricalChannelId(null)
            historicalChannelIdRef.current = null
            setPinnedJumpTargetId(merged.at(-1)?.id ?? null)
        } catch {
            if (requestId === channelMessagesRequestRef.current && activeChannelIdRef.current === channelId) {
                pushToast({ level: 'error', title: 'Could not load latest messages', message: 'Try again.' })
            }
        } finally {
            setReturningToLatest(false)
        }
    }, [activeChannelId, isLoggedIn, pushToast, returningToLatest, token])

    const handlePinnedJumpVisible = useCallback(() => setPinnedJumpTargetId(null), [])

    useEffect(() => {
        if (!activeChannelId || !isViewActive) {
            setChannelUnreadDividerCount(0)
            return
        }

        const unreadCount = useAppStore.getState().serverUnreadByChannel[activeChannelId] ?? 0
        setChannelUnreadDividerCount(unreadCount > 0 ? unreadCount : 0)
        clearServerUnread(activeChannelId)
        clearServerMention(activeChannelId)

        // Messages that arrived while the app was in the background stay unread until the
        // user returns; then they get the divider and are marked read.
        const syncReadOnReturn = () => {
            if (isAppBackgrounded()) return
            const pendingUnread = useAppStore.getState().serverUnreadByChannel[activeChannelId] ?? 0
            if (pendingUnread <= 0) return
            setChannelUnreadDividerCount(pendingUnread)
            clearServerUnread(activeChannelId)
            clearServerMention(activeChannelId)
        }
        window.addEventListener('focus', syncReadOnReturn)
        document.addEventListener('visibilitychange', syncReadOnReturn)
        return () => {
            window.removeEventListener('focus', syncReadOnReturn)
            document.removeEventListener('visibilitychange', syncReadOnReturn)
        }
    }, [activeChannelId, clearServerMention, clearServerUnread, isViewActive])

    useEffect(() => {
        if (!activeChannelId) return
        const draft = sessionStorage.getItem('voxpery-draft-mention')
        if (!draft) return
        setMessageInput((prev) => {
            if (prev.trim()) return prev
            saveMessageDraft(user?.id, 'channel', activeChannelId, draft)
            return draft
        })
        sessionStorage.removeItem('voxpery-draft-mention')
    }, [activeChannelId, user?.id])

    // ─── WebSocket ─────────────────────────────

    // Handle incoming messages
    const handleWsEvent = useCallback((event: WsEvent) => {
        try {
            if (!event || typeof event.type !== 'string') return
            const refreshServerSnapshot = (sid: string, t: string | null, refreshChannels: boolean) => {
                const detailPromise = serverApi.get(sid, t)
                const channelsPromise = refreshChannels
                    ? serverApi.channels(sid, t).catch(() => [] as Channel[])
                    : Promise.resolve([] as Channel[])
                const categoriesPromise = refreshChannels
                    ? channelApi.listCategories(sid, t).catch(() => [])
                    : Promise.resolve([] as Array<{ name: string }>)
                Promise.all([detailPromise, channelsPromise, categoriesPromise])
                    .then(([detail, chs, categories]) => {
                        const store = useAppStore.getState()
                        store.setMembersForServer(sid, detail.members ?? [])
                        if (activeServerIdRef.current === sid) {
                            store.setMembers(detail.members ?? [])
                        }
                        setMyServerPermissions((prev) => ({ ...prev, [detail.id]: detail.my_permissions ?? 0 }))

                        if (!refreshChannels) return
                        store.setChannelsForServer(sid, chs)
                        setChannelServerMap((prev) => {
                            const next = { ...prev }
                            for (const ch of chs) next[ch.id] = ch.server_id
                            return next
                        })
                        if (activeServerIdRef.current !== sid) return
                        const currentActive = activeChannelIdRef.current
                        const lostChannel = currentActive
                            ? useAppStore.getState().channels.find((c) => c.id === currentActive && c.server_id === sid)
                            : undefined
                        setChannels(chs)
                        setChannelCategoriesForServer(sid, categories.map((c) => c.name))
                        const stillValid = !!currentActive && chs.some((c) => c.id === currentActive)
                        if (!stillValid && lostChannel) {
                            useToastStore.getState().pushToast({
                                level: 'info',
                                title: 'Channel unavailable',
                                message: `#${lostChannel.name} is no longer available to you.`,
                            })
                        }
                        if (!stillValid) {
                            const target = chs.find((c) => c.channel_type === 'text')?.id ?? chs[0]?.id ?? null
                            store.setActiveChannel(target)
                        }
                    })
                    .catch(() => { })
            }
            switch (event.type) {
                case 'NewMessage': {
                    const d = event.data
                    const incomingChannelId = d.channel_id
                    const incoming = d.message
                    if (!incomingChannelId || !incoming) break
                    const isCurrentVisibleChannel =
                        incomingChannelId === activeChannelIdRef.current
                        && isViewActive
                    if (isCurrentVisibleChannel) {
                        setMessages((prev) => {
                            if (prev.some((m) => m.id === incoming.id)) return prev
                            const withoutMatchingOptimistic = prev.filter((m) => !(
                                m.clientStatus === 'sending' &&
                                m.author?.user_id === incoming.author?.user_id &&
                                m.content === incoming.content
                            ))
                            const next = [...withoutMatchingOptimistic, incoming]
                            messagesByChannelRef.current[incomingChannelId] = next
                            return next
                        })
                    } else {
                        const cached = messagesByChannelRef.current[incomingChannelId]
                        if (cached?.length && !cached.some((m) => m.id === incoming.id)) {
                            messagesByChannelRef.current[incomingChannelId] = [...cached, incoming]
                        }
                    }
                    // An open channel only reads its messages while the app is in the foreground.
                    if (!isCurrentVisibleChannel || isAppBackgrounded()) {
                        if (incoming.author?.user_id !== user?.id) {
                            const incomingServerId = channelServerMapRef.current[incomingChannelId]
                            const isMention = messageMentionsUser(incoming.content, user?.username)
                            const isMutedServer = !!incomingServerId && mutedServerIds.includes(incomingServerId)
                            const isMutedChannel = mutedChannelIds.includes(incomingChannelId)
                            if (shouldTrackServerUnread({ isMention, isMutedServer, isMutedChannel })) {
                                incrementServerUnread(incomingChannelId)
                                if (isMention) {
                                    incrementServerMention(incomingChannelId)
                                }
                            }

                            if (
                                incomingServerId
                                && shouldNotifyForServerMessage({
                                    preference: getServerNotificationPreference(),
                                    isMention,
                                    isMutedServer,
                                    isMutedChannel,
                                })
                            ) {
                                if (shouldPlayNotificationSound(user?.status)) {
                                    playMessageNotificationSound()
                                }
                                if (shouldShowPushNotification(user?.status)) {
                                    const channelName =
                                        channelsByServerId[incomingServerId]?.find((channel) => channel.id === incomingChannelId)?.name
                                        ?? channels.find((channel) => channel.id === incomingChannelId)?.name
                                        ?? 'channel'
                                    showPushNotification({
                                        title: isMention ? `Mention in #${channelName}` : `New message in #${channelName}`,
                                        body: `${incoming.author?.username ?? 'Someone'}: ${incoming.content.slice(0, 120)}`,
                                        tag: `server:${incomingServerId}:channel:${incomingChannelId}`,
                                        onClick: () => {
                                            setActiveServer(incomingServerId)
                                            setActiveChannel(incomingChannelId)
                                        },
                                    })
                                }
                            }
                        }
                    }
                    break
                }
                case 'MessageDeleted': {
                    const d = event.data
                    const channelId = d.channel_id
                    const messageId = d.message_id
                    if (!channelId || !messageId) break
                    if (channelId === activeChannelIdRef.current) {
                        setMessages((prev) => prev.filter((m) => m.id !== messageId))
                    }
                    const cached = messagesByChannelRef.current[channelId]
                    if (cached) {
                        messagesByChannelRef.current[channelId] = cached.filter((m) => m.id !== messageId)
                    }
                    break
                }
                case 'MessageUpdated': {
                    const d = event.data
                    const channelId = d.channel_id
                    const message = d.message
                    if (!channelId || !message?.id) break
                    if (channelId === activeChannelIdRef.current) {
                        setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)))
                    }
                    const cached = messagesByChannelRef.current[channelId]
                    if (cached) {
                        messagesByChannelRef.current[channelId] = cached.map((m) => (m.id === message.id ? message : m))
                    }
                    break
                }
                case 'PresenceUpdate': {
                    const d = event.data
                    const user_id = d.user_id
                    const status = d.status
                    if (!user_id || !status) break
                    const store = useAppStore.getState()

                    const members = store.members ?? []
                    if (members.some((m) => m.user_id === user_id)) {
                        store.setMembers(members.map((m) => m.user_id === user_id ? { ...m, status } : m))
                    }

                    Object.entries(store.membersByServerId ?? {}).forEach(([sid, cache]) => {
                        if (cache.some((m) => m.user_id === user_id)) {
                            store.setMembersForServer(sid, cache.map((m) => m.user_id === user_id ? { ...m, status } : m))
                        }
                    })
                    break
                }
                case 'UserUpdated': {
                    const d = event.data
                    const updated = d.user
                    const user_id = updated?.id
                    if (!user_id) break
                    const store = useAppStore.getState()

                    // Messages carry a copy of their author; refresh it in the open channel,
                    // every cached channel and the pinned list.
                    const profile = { id: user_id, username: updated.username, avatar_url: updated.avatar_url ?? null }
                    setMessages((prev) => withUpdatedAuthor(prev, profile))
                    Object.entries(messagesByChannelRef.current).forEach(([cachedChannelId, cached]) => {
                        messagesByChannelRef.current[cachedChannelId] = withUpdatedAuthor(cached, profile)
                    })
                    setChannelPins((prev) => withUpdatedAuthor(prev, profile))

                    const members = store.members ?? []
                    if (members.some((m) => m.user_id === user_id)) {
                        store.setMembers(
                            members.map((m) =>
                                m.user_id === user_id
                                    ? {
                                        ...m,
                                        username: updated.username ?? m.username,
                                        avatar_url: updated.avatar_url ?? null,
                                        status: updated.status ?? m.status,
                                    }
                                    : m,
                            ),
                        )
                    }

                    Object.entries(store.membersByServerId ?? {}).forEach(([sid, cache]) => {
                        if (!cache.some((m) => m.user_id === user_id)) return
                        store.setMembersForServer(
                            sid,
                            cache.map((m) =>
                                m.user_id === user_id
                                    ? {
                                        ...m,
                                        username: updated.username ?? m.username,
                                        avatar_url: updated.avatar_url ?? null,
                                        status: updated.status ?? m.status,
                                    }
                                    : m,
                            ),
                        )
                    })
                    break
                }
                case 'MemberJoined': {
                    const d = event.data
                    const eventSid = d.server_id
                    if (!eventSid) break
                    const t = tokenRef.current ?? null
                    refreshServerSnapshot(eventSid, t, false)
                    break
                }
                case 'MemberRoleUpdated': {
                    const d = event.data
                    const sid = d.server_id
                    if (!sid) break
                    const t = tokenRef.current ?? null
                    refreshServerSnapshot(sid, t, true)
                    break
                }
                case 'MemberTimeoutUpdated': {
                    const d = event.data
                    if (!d.server_id || !d.user_id) break
                    const store = useAppStore.getState()
                    const withTimeout = (list: typeof store.members) => list.map((member) => (
                        member.user_id === d.user_id ? { ...member, timed_out_until: d.timed_out_until } : member
                    ))
                    if (activeServerIdRef.current === d.server_id) store.setMembers(withTimeout(store.members ?? []))
                    const cached = store.membersByServerId[d.server_id] ?? []
                    if (cached.length > 0) store.setMembersForServer(d.server_id, withTimeout(cached))
                    break
                }
                case 'ServerRolesUpdated': {
                    const d = event.data
                    const sid = d.server_id
                    if (!sid) break
                    const t = tokenRef.current ?? null
                    refreshServerSnapshot(sid, t, true)
                    break
                }
                case 'ServerChannelsUpdated': {
                    const d = event.data
                    const sid = d.server_id
                    if (!sid) break
                    const t = tokenRef.current ?? null
                    refreshServerSnapshot(sid, t, true)
                    break
                }
                case 'MemberLeft': {
                    const d = event.data
                    const leftUserId = d.user_id
                    const sid = d.server_id
                    if (!leftUserId || !sid) break
                    const store = useAppStore.getState()
                    if (leftUserId === useAuthStore.getState().user?.id) {
                        // This account was kicked, banned or left elsewhere: drop the server
                        // instead of keeping its channels and composer on screen.
                        const serverName = store.servers.find((server) => server.id === sid)?.name
                        const removalNotice = serverName && removalNoticeFor(d.reason, serverName)
                        if (removalNotice) useToastStore.getState().pushToast({ level: 'info', ...removalNotice })
                        const remaining = store.servers.filter((server) => server.id !== sid)
                        store.setServers(remaining)
                        if (activeServerIdRef.current === sid) store.setActiveServer(remaining[0]?.id ?? null)
                        break
                    }
                    const filterList = (list: typeof store.members) => list.filter((m) => m.user_id !== leftUserId)

                    if (activeServerIdRef.current === sid) {
                        store.setMembers(filterList(store.members ?? []))
                    }
                    const cached = store.membersByServerId[sid] ?? []
                    if (cached.length > 0) {
                        store.setMembersForServer(sid, filterList(cached))
                    }
                    break
                }
                case 'VoiceStateUpdate': {
                    const d = event.data
                    const channel_id = d.channel_id
                    const user_id = d.user_id
                    const server_id = d.server_id
                    const channel_active_since_ms = d.channel_active_since_ms
                    if (!user_id) break
                    const store = useAppStore.getState()
                    store.setVoiceState(user_id, channel_id ?? null, channel_active_since_ms ?? null)
                    store.setVoiceStateServerId(user_id, server_id ?? null)
                    if (server_id && channel_id) {
                        const activeMembers = activeServerIdRef.current === server_id ? (store.members ?? []) : []
                        const cachedMembers = store.membersByServerId[server_id] ?? []
                        const knowsMember =
                            activeMembers.some((m) => m.user_id === user_id)
                            || cachedMembers.some((m) => m.user_id === user_id)
                        if (!knowsMember) {
                            const t = tokenRef.current ?? null
                            refreshServerSnapshot(server_id, t, false)
                        }
                    }
                    break
                }
                case 'VoiceControlUpdate': {
                    const d = event.data
                    const user_id = d.user_id
                    const muted = d.muted
                    const deafened = d.deafened
                    const server_muted = d.server_muted
                    const server_deafened = d.server_deafened
                    const screen_sharing = d.screen_sharing
                    const camera_on = d.camera_on
                    if (!user_id) break
                    const store = useAppStore.getState()
                    store.setVoiceControl(
                        user_id,
                        !!muted,
                        !!deafened,
                        !!screen_sharing,
                        !!server_muted,
                        !!server_deafened,
                    )
                    store.setVoiceCamera(user_id, !!camera_on)
                    break
                }
                case 'VoiceMemberMoveRequested': {
                    const d = event.data
                    const requestId = d.request_id
                    const sourceChannelId = d.source_channel_id
                    const channelId = d.channel_id
                    if (!requestId || !sourceChannelId || !channelId) break
                    const joinVoice = (window as Window & {
                        __voxperyJoinVoice?: (targetChannelId: string) => Promise<void>
                    }).__voxperyJoinVoice
                    void handleVoiceMemberMoveRequested(
                        {
                            requestId,
                            sourceChannelId,
                            destinationChannelId: channelId,
                        },
                        {
                            getJoinedVoiceChannelId: () => useAppStore.getState().joinedVoiceChannelId,
                            joinVoice,
                            send,
                            onError: (message) => pushToast({
                                level: 'error',
                                title: 'Voice move failed',
                                message,
                            }),
                        },
                    )
                    break
                }
                case 'VoiceMemberMoveResult': {
                    const d = event.data
                    const success = d.success === true
                    if (!success) {
                        pushToast({
                            level: 'error',
                            title: 'Voice move failed',
                            message: typeof d.message === 'string'
                                ? d.message
                                : 'The member could not be moved.',
                        })
                    }
                    break
                }
            }
        } catch (err) {
            console.error('AppLayout WS handler error:', err)
        }
    }, [channels, channelsByServerId, incrementServerMention, incrementServerUnread, isViewActive, mutedChannelIds, mutedServerIds, pushToast, send, setActiveChannel, setActiveServer, setChannelCategoriesForServer, setChannels, user?.id, user?.status, user?.username])

    // Subscribe to WebSocket events (connection is managed globally by AppShell)
    useEffect(() => {
        if (!isLoggedIn) return

        const unsubscribe = subscribe(handleWsEvent)

        return () => {
            unsubscribe()
        }
    }, [isLoggedIn, token, connect, subscribe, handleWsEvent])

    // Subscribe to all known server channels so unread state works across servers.
    useEffect(() => {
        if (!isConnected || allKnownChannelIds.length === 0) return
        send('Subscribe', { channel_ids: allKnownChannelIds })
        return () => {
            send('Unsubscribe', { channel_ids: allKnownChannelIds })
        }
    }, [allKnownChannelIds, isConnected, send])

    // ─── Handlers ──────────────────────────────

    const handleSendMessage = async (e?: FormEvent, forceContent?: string) => {
        e?.preventDefault()
        if (!canSendMessages) return
        if (!activeChannelId || !isLoggedIn) return
        const channelId = activeChannelId
        if (hasPendingDraftAttachments(draftAttachments)) {
            pushToast({
                level: 'error',
                title: 'Attachment still pending',
                message: 'Finish uploading attachments or retry failed ones before sending.',
            })
            return
        }
        const attachments = getUploadedDraftAttachments(draftAttachments)
        const isForcedContent = typeof forceContent === 'string'
        const inputValue = isForcedContent ? forceContent : messageInput
        if ((!inputValue.trim() && attachments.length === 0)) return
        const bodyText = inputValue.trim()
        const content = replyingTo
            ? `> @${replyingTo.username}: ${replyingTo.contentSnippet}\n\n${bodyText}`
            : bodyText
        if (countMessageCharacters(content) > MESSAGE_MAX_CHARACTERS) {
            pushToast({ level: 'error', title: 'Message too long', message: 'Messages can contain up to 4000 characters, including the reply quote.' })
            return
        }
        const sendFingerprint = `${channelId}\n${content}\n${JSON.stringify(attachments)}`
        if (pendingMessageFingerprintsRef.current.has(sendFingerprint)) return
        pendingMessageFingerprintsRef.current.add(sendFingerprint)
        setReplyingTo(null)
        const clientId = createSecureId()
        const optimisticId = `local-${clientId}`
        const optimistic: UiMessage = {
            id: optimisticId,
            channel_id: channelId,
            content,
            attachments,
            created_at: new Date().toISOString(),
            edited_at: null,
            author: {
                user_id: user?.id ?? 'local',
                username: user?.username ?? 'You',
                avatar_url: user?.avatar_url,
                role_color: currentServerMember?.role_color ?? null,
            },
            clientId,
            clientStatus: 'sending',
        }
        if (!isForcedContent) setMessageInput('')
        setDraftAttachments([])
        setMessages((prev) => {
            const next = [...withoutFailedDuplicates(prev, content, attachments), optimistic]
            messagesByChannelRef.current[channelId] = next
            return next
        })
        try {
            const msg = await messageApi.send(channelId, content, attachments, token, clientId)
            const applySentMessage = (current: UiMessage[]) => {
                return reconcileConfirmedMessage(current, clientId, msg)
            }
            if (activeChannelIdRef.current === channelId) {
                setMessages((prev) => {
                    const next = applySentMessage(prev)
                    messagesByChannelRef.current[channelId] = next
                    return next
                })
            } else {
                messagesByChannelRef.current[channelId] = applySentMessage(messagesByChannelRef.current[channelId] ?? [])
            }
            if (!isForcedContent) {
                clearMessageDraftIfUnchanged(user?.id, 'channel', channelId, inputValue)
            }
        } catch (err) {
            console.error('Failed to send:', err)
            const applyFailedMessage = (current: UiMessage[]) =>
                current.map((m) =>
                    m.clientId === clientId
                        ? { ...m, clientStatus: 'failed' as const, clientError: err instanceof Error ? err.message : 'Send failed', clientDraft: isForcedContent ? undefined : inputValue }
                        : m
                ) as UiMessage[]
            if (activeChannelIdRef.current === channelId) {
                setMessages((prev) => {
                    const next = applyFailedMessage(prev)
                    messagesByChannelRef.current[channelId] = next
                    return next
                })
            } else {
                messagesByChannelRef.current[channelId] = applyFailedMessage(messagesByChannelRef.current[channelId] ?? [])
            }
            if (!isForcedContent && activeChannelIdRef.current === channelId) {
                setMessageInput((current) => current || inputValue)
            }
        } finally {
            pendingMessageFingerprintsRef.current.delete(sendFingerprint)
        }
    }

    const handleRetryMessage = async (clientId: string) => {
        if (!canSendMessages) return
        if (!activeChannelId || !isLoggedIn) return
        const channelId = activeChannelId
        const target = messages.find((m) => m.clientId === clientId)
        if (!target || target.clientStatus !== 'failed') return
        setMessages((prev) => {
            const next = prev.map((m) => (
                m.clientId === clientId ? { ...m, clientStatus: 'sending' as const, clientError: undefined } : m
            )) as UiMessage[]
            messagesByChannelRef.current[channelId] = next
            return next
        })
        try {
            const msg = await messageApi.send(
                channelId,
                target.content,
                target.attachments ?? [],
                token,
                clientId,
            )
            const applyRetriedMessage = (current: UiMessage[]) => {
                if (current.some((m) => m.id === msg.id)) {
                    return current.filter((m) => m.clientId !== clientId)
                }
                return current.map((m) => (m.clientId === clientId ? msg : m))
            }
            if (activeChannelIdRef.current === channelId) {
                setMessages((prev) => {
                    const next = applyRetriedMessage(prev)
                    messagesByChannelRef.current[channelId] = next
                    return next
                })
            } else {
                messagesByChannelRef.current[channelId] = applyRetriedMessage(messagesByChannelRef.current[channelId] ?? [])
            }
            if (target.clientDraft && activeChannelIdRef.current === channelId) {
                setMessageInput((current) => (current === target.clientDraft ? '' : current))
                clearMessageDraftIfUnchanged(user?.id, 'channel', channelId, target.clientDraft)
            }
        } catch (err) {
            const applyFailedRetry = (current: UiMessage[]) =>
                current.map((m) =>
                    m.clientId === clientId
                        ? { ...m, clientStatus: 'failed' as const, clientError: err instanceof Error ? err.message : 'Retry failed' }
                        : m
                ) as UiMessage[]
            if (activeChannelIdRef.current === channelId) {
                setMessages((prev) => {
                    const next = applyFailedRetry(prev)
                    messagesByChannelRef.current[channelId] = next
                    return next
                })
            } else {
                messagesByChannelRef.current[channelId] = applyFailedRetry(messagesByChannelRef.current[channelId] ?? [])
            }
        }
    }

    const handleToggleChannelReaction = async (
        messageId: string,
        emoji: string,
        reacted: boolean,
    ) => {
        if (!activeChannelId || !isLoggedIn || !canSendMessages) return
        try {
            const updated = reacted
                ? await messageApi.removeReaction(messageId, emoji, token)
                : await messageApi.addReaction(messageId, emoji, token)
            setMessages((prev) => {
                const next = prev.map((m) => (m.id === updated.id ? { ...updated } : m))
                messagesByChannelRef.current[activeChannelId] = next
                return next
            })
        } catch (err) {
            pushToast({
                level: 'error',
                title: 'Reaction failed',
                message: err instanceof Error ? err.message : 'Could not update reaction.',
            })
        }
    }

    const handleDeleteMessage = async (messageId: string) => {
        if (!activeChannelId || !isLoggedIn) return
        const isLocalOptimistic = messageId.startsWith('local-')
        if (isLocalOptimistic) {
            setMessages((prev) => {
                const next = prev.filter((m) => m.id !== messageId)
                messagesByChannelRef.current[activeChannelId] = next
                return next
            })
            setDeleteMessageConfirmId(null)
            return
        }
        try {
            await messageApi.delete(messageId, token)
            setMessages((prev) => {
                const next = prev.filter((m) => m.id !== messageId)
                messagesByChannelRef.current[activeChannelId] = next
                return next
            })
            setDeleteMessageConfirmId(null)
        } catch (err) {
            pushToast({
                level: 'error',
                title: 'Delete failed',
                message: err instanceof Error ? err.message : 'Could not delete message',
            })
            setDeleteMessageConfirmId(null)
        }
    }

    const handleReplyToMessage = useCallback((msg: { id: string; author?: { username?: string }; content: string }) => {
        const username = msg.author?.username ?? 'User'
        const snippet = createReplyContentSnippet(msg.content)
        setReplyingTo({ id: msg.id, username, contentSnippet: snippet })
    }, [])

    const handleSaveEdit = useCallback(async () => {
        if (!editingMessageId || !isLoggedIn) return
        const body = editingContent.trim()
        if (!body && !editingReplyQuotePart) return
        const contentToSend = editingReplyQuotePart ? `${editingReplyQuotePart}\n\n${body}` : body
        if (countMessageCharacters(contentToSend) > MESSAGE_MAX_CHARACTERS) {
            pushToast({ level: 'error', title: 'Edit too long', message: 'Messages can contain up to 4000 characters, including the reply quote.' })
            return
        }
        try {
            const updated = await messageApi.edit(editingMessageId, contentToSend, token)
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
            if (activeChannelId) messagesByChannelRef.current[activeChannelId] = (messagesByChannelRef.current[activeChannelId] ?? []).map((m) => (m.id === updated.id ? updated : m))
            setEditingMessageId(null)
            setEditingContent('')
            setEditingReplyQuotePart(null)
        } catch (err) {
            pushToast({
                level: 'error',
                title: 'Edit failed',
                message: err instanceof Error ? err.message : 'Could not edit message',
            })
        }
    }, [editingMessageId, editingContent, editingReplyQuotePart, token, activeChannelId, pushToast, isLoggedIn])

    const handleCancelEdit = useCallback(() => {
        setEditingMessageId(null)
        setEditingContent('')
        setEditingReplyQuotePart(null)
    }, [])

    const handleAttachmentPick = async (files: FileList | null) => {
        if (!files) return
        const incoming = Array.from(files)
        const remainingSlots = Math.max(0, 4 - draftAttachments.length)
        if (remainingSlots === 0) {
            pushToast({
                level: 'error',
                title: 'Upload blocked',
                message: 'Maximum 4 attachments per message.',
            })
            return
        }
        const list = incoming.slice(0, remainingSlots)
        if (incoming.length > remainingSlots) {
            pushToast({
                level: 'error',
                title: 'Upload blocked',
                message: 'Maximum 4 attachments per message.',
            })
        }
        const allowed: File[] = []
        const oversized: string[] = []
        for (const f of list) {
            if (f.size > MAX_CHAT_ATTACHMENT_BYTES) {
                oversized.push(f.name)
                continue
            }
            allowed.push(f)
        }
        if (oversized.length > 0) {
            const maxMb = getMaxChatAttachmentMb()
            pushToast({
                level: 'error',
                title: 'Upload blocked',
                message: `Maximum ${maxMb} MB per file. Too large: ${oversized.join(', ')}`,
            })
        }
        if (allowed.length === 0) return

        const pending = createUploadingDraftAttachments(allowed)
        const pendingIds = pending.map((attachment) => attachment.localId)
        setDraftAttachments((prev) => [...prev, ...pending].slice(0, 4))

        try {
            const uploaded = await attachmentApi.uploadFiles(allowed, token)
            setDraftAttachments((prev) => applyUploadedDraftAttachments(prev, pendingIds, uploaded))
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Could not upload attachment(s).'
            setDraftAttachments((prev) => markDraftAttachmentsFailed(prev, pendingIds, 'Upload failed'))
            pushToast({
                level: 'error',
                title: 'Upload failed',
                message: errorMessage,
            })
        }
    }

    const handleCreateServer = async (e: FormEvent) => {
        e.preventDefault()
        if (createServerInFlightRef.current) return
        setCreateServerError(null)
        if (!newServerName.trim() || !isLoggedIn) return
        createServerInFlightRef.current = true
        setIsCreatingServer(true)
        const requestId = createServerRequestIdRef.current ?? createSecureId()
        createServerRequestIdRef.current = requestId
        try {
            const server = await serverApi.create(
                newServerName,
                newServerDescription.trim() || undefined,
                token,
                requestId,
            )
            const allServers = await serverApi.list(token)
            setServers(allServers)
            setActiveServer(server.id)
            setNewServerName('')
            setNewServerDescription('')
            createServerRequestIdRef.current = null
            setShowCreateServer(false)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create server.'
            setCreateServerError(message)
        } finally {
            createServerInFlightRef.current = false
            setIsCreatingServer(false)
        }
    }

    const handleJoinServer = async (e: FormEvent) => {
        e.preventDefault()
        setJoinServerError(null)
        const parsedInviteCode = parseInviteInput(inviteCode)
        if (!parsedInviteCode || !isLoggedIn) return
        try {
            const server = await serverApi.join(parsedInviteCode, token)
            const allServers = await serverApi.list(token)
            setServers(allServers)
            setActiveServer(server.id)
            setInviteCode('')
            setShowJoinServer(false)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to join server.'
            setJoinServerError(message)
        }
    }

    const openCreateModal = (trigger?: HTMLElement) => {
        serverDialogTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
        createServerInFlightRef.current = false
        createServerRequestIdRef.current = null
        setIsCreatingServer(false)
        setCreateServerError(null)
        setShowCreateServer(true)
    }
    const openJoinModal = (trigger?: HTMLElement) => {
        serverDialogTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
        setJoinServerError(null)
        setShowJoinServer(true)
    }

    useEffect(() => {
        if (!showCreateServer && !showJoinServer) return
        const dialog = serverDialogRef.current
        const trigger = serverDialogTriggerRef.current
            ?? externalServerDialogTriggerRef?.current
        dialog?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                if (showCreateServer && createServerInFlightRef.current) return
                if (showCreateServer) {
                    setShowCreateServer(false)
                    setCreateServerError(null)
                    createServerRequestIdRef.current = null
                } else {
                    setShowJoinServer(false)
                    setJoinServerError(null)
                }
                return
            }
            if (event.key !== 'Tab' || !dialog) return
            const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
                'input:not(:disabled), button:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
            )).filter((control) => control.getClientRects().length > 0)
            if (controls.length === 0) {
                event.preventDefault()
                dialog.focus()
                return
            }
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (!dialog.contains(document.activeElement)) {
                event.preventDefault()
                ;(event.shiftKey ? last : first).focus()
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
            document.removeEventListener('keydown', onKeyDown, true)
            serverDialogTriggerRef.current = null
            if (externalServerDialogTriggerRef) externalServerDialogTriggerRef.current = null
            queueMicrotask(() => {
                if (trigger?.isConnected) trigger.focus()
            })
        }
    }, [externalServerDialogTriggerRef, setShowCreateServer, setShowJoinServer, showCreateServer, showJoinServer])
    const openServerSettingsModal = (
        serverId?: string | null,
        initialTab: ServerSettingsOpenTab = 'overview',
    ) => {
        serverSettingsReturnFocusRef.current = document.querySelector<HTMLElement>('.channel-header-server')
        setServerSettingsError(null)
        setDeleteServerError(null)
        setDeleteServerInput('')
        setShowDeleteServerConfirm(false)
        if (isSafetySettingsTab(initialTab)) setSafetySettingsTab(initialTab)
        setServerSettingsTab(normalizeServerSettingsTab(initialTab))
        setServerSettingsServerId(serverId ?? activeServerId ?? null)
        setShowServerSettings(true)
    }
    const openServerSettingsForServer = (
        serverId: string,
        initialTab: ServerSettingsOpenTab = 'overview',
    ) => {
        if (activeServerId !== serverId) setActiveServer(serverId)
        openServerSettingsModal(serverId, initialTab)
    }

    const activeServer = servers.find((s) => s.id === activeServerId)
    // Roles and permission overrides are managed by the server owner only.
    const isActiveServerOwner = !!(activeServer && user && activeServer.owner_id === user.id)
    const hasResolvedActiveChannel = !!activeChannelId && channels.some((c) => c.id === activeChannelId)
    const serverRouteLoading = isLoggedIn && (
        !serverListReady
        || (!!activeServerId && serverBootstrapLoadingId === activeServerId)
        || (servers.length > 0 && !activeServerId)
        || (!!activeServerId && channels.length > 0 && !hasResolvedActiveChannel)
    )
    const activeServerInviteLink = activeServer ? `${inviteBaseUrl}/invite/${activeServer.invite_code}` : ''
    const isSoloServer = !!activeServer && members.length <= 1
    const [myServerPermissions, setMyServerPermissions] = useState<Record<string, number>>({})
    const activePerms = activeServerId ? myServerPermissions[activeServerId] ?? 0 : 0
    const activeChannelForPerms = activeChannelId ? channels.find((c) => c.id === activeChannelId) : null
    const activeChannelPerms =
        activeChannelForPerms != null
            ? (activeChannelForPerms.my_permissions ?? 0)
            : activePerms
    // Permissions-based gating (backend enforces same).
    const canManageChannels = (activePerms & PERM_MANAGE_CHANNELS) === PERM_MANAGE_CHANNELS
    // A timed-out member cannot send until the timeout ends; re-render when it does.
    const [timeoutClock, setTimeoutClock] = useState(() => Date.now())
    const ownTimeoutUntil = activeTimeoutUntil(members.find((member) => member.user_id === user?.id)?.timed_out_until, timeoutClock)
    const ownTimeoutEnd = ownTimeoutUntil?.getTime() ?? null
    useEffect(() => {
        if (ownTimeoutEnd == null) return
        const timer = window.setTimeout(() => setTimeoutClock(Date.now()), Math.min(Math.max(ownTimeoutEnd - Date.now(), 0) + 500, 2_147_000_000))
        return () => window.clearTimeout(timer)
    }, [ownTimeoutEnd])
    const composerBlockedMessage = ownTimeoutUntil ? `You are timed out until ${formatTimeoutUntil(ownTimeoutUntil)}.` : null
    const canSendMessages = (activeChannelPerms & PERM_SEND_MESSAGES) === PERM_SEND_MESSAGES && !ownTimeoutUntil
    const canManageMessages = (activeChannelPerms & PERM_MANAGE_MESSAGES) === PERM_MANAGE_MESSAGES
    const canManagePins = (activeChannelPerms & PERM_MANAGE_PINS) === PERM_MANAGE_PINS
    const hasManageServer = (activePerms & PERM_MANAGE_SERVER) === PERM_MANAGE_SERVER
    const canMuteMembers =
        hasManageServer || (activePerms & PERM_MUTE_MEMBERS) === PERM_MUTE_MEMBERS
    const canDeafenMembers =
        hasManageServer || (activePerms & PERM_DEAFEN_MEMBERS) === PERM_DEAFEN_MEMBERS
    const canMoveMembers =
        hasManageServer || (activePerms & PERM_MOVE_MEMBERS) === PERM_MOVE_MEMBERS
    const canDisconnectMembers = hasManageServer || canMuteMembers || canDeafenMembers
    const canBanMembers = (activePerms & PERM_BAN_MEMBERS) === PERM_BAN_MEMBERS
    const canManageBans = canBanMembers
    const canViewAuditLog = (activePerms & PERM_VIEW_AUDIT_LOG) === PERM_VIEW_AUDIT_LOG
    const settingsServer = servers.find((s) => s.id === serverSettingsServerId) ?? activeServer
    const settingsServerId = settingsServer?.id ?? null
    const settingsServerInviteLink = settingsServer ? `${inviteBaseUrl}/invite/${settingsServer.invite_code}` : ''
    const isOwner = !!(settingsServer && user && settingsServer.owner_id === user.id)
    const canManageAutoMod = isOwner || (activePerms & PERM_MANAGE_MESSAGES) === PERM_MANAGE_MESSAGES
    const canViewReports = isOwner || canViewAuditLog || canManageBans || canManageAutoMod
    const availableSafetyTabs = useMemo(() => {
        const tabs: SafetySettingsTab[] = []
        if (canViewReports) tabs.push('reports')
        if (canManageAutoMod) tabs.push('automod')
        if (isOwner || canManageBans) tabs.push('bans')
        return tabs
    }, [canManageAutoMod, canManageBans, canViewReports, isOwner])
    const canViewSafety = availableSafetyTabs.length > 0
    const trimmedServerSettingsName = serverSettingsName.trim()
    const hasNameChanges = !!(
        isOwner &&
        settingsServer &&
        trimmedServerSettingsName.length > 0 &&
        trimmedServerSettingsName !== settingsServer.name
    )
    const effectiveServerIcon = serverSettingsIconDraft !== undefined
        ? serverSettingsIconDraft
        : (settingsServer?.icon_url ?? null)
    const effectiveServerIconSrc = resolveServerIconUrl(effectiveServerIcon)
    const hasIconChanges = !!(
        isOwner &&
        settingsServer &&
        serverSettingsIconDraft !== undefined &&
        serverSettingsIconDraft !== (settingsServer.icon_url ?? null)
    )
    const hasDescriptionChanges = !!(
        isOwner &&
        settingsServer &&
        serverSettingsDescription !== (settingsServer.description ?? '')
    )
    const canSaveServerSettings = hasNameChanges || hasIconChanges || hasDescriptionChanges

    useEffect(() => {
        setServerSettingsName(settingsServer?.name ?? '')
        setServerSettingsDescription(settingsServer?.description ?? '')
        setServerSettingsIconDraft(undefined)
    }, [settingsServer?.id, settingsServer?.name, settingsServer?.description])

    useEffect(() => {
        setEmptyInviteCopied(false)
    }, [activeServerId, activeChannelId])

    const copyActiveServerInvite = useCallback(() => {
        if (!activeServerInviteLink || typeof navigator === 'undefined' || !navigator.clipboard) {
            pushToast({
                level: 'error',
                title: 'Copy failed',
                message: 'Could not copy the invite link to your clipboard.',
            })
            return
        }
        navigator.clipboard.writeText(activeServerInviteLink).then(() => {
            setEmptyInviteCopied(true)
            window.setTimeout(() => setEmptyInviteCopied(false), 1400)
        }).catch(() => {
            pushToast({
                level: 'error',
                title: 'Copy failed',
                message: 'Could not copy the invite link to your clipboard.',
            })
        })
    }, [activeServerInviteLink, pushToast])

    const openUserReport = useCallback((target: { user_id: string; username: string }) => {
        setReportTarget({
            kind: 'user',
            userId: target.user_id,
            username: target.username,
        })
        setReportReason('spam')
        setReportDetails('')
    }, [])

    const openMessageReport = useCallback((target: { id: string; author?: { user_id?: string; username?: string }; content: string }) => {
        if (!target.author?.user_id) return
        setReportTarget({
            kind: 'message',
            userId: target.author.user_id,
            username: target.author.username ?? 'Unknown user',
            messageId: target.id,
            messageContent: target.content,
        })
        setReportReason('spam')
        setReportDetails('')
    }, [])

    const closeReportDialog = useCallback(() => {
        if (reportSubmitting) return
        setReportTarget(null)
        setReportReason('spam')
        setReportDetails('')
    }, [reportSubmitting])

    const handleSubmitReport = useCallback(async () => {
        if (!reportTarget || !activeServerId) return
        setReportSubmitting(true)
        try {
            if (reportTarget.kind === 'user') {
                await serverApi.reportUser(
                    activeServerId,
                    reportTarget.userId,
                    reportReason,
                    reportDetails.trim() || null,
                    token,
                )
            } else if (reportTarget.messageId) {
                await serverApi.reportMessage(
                    activeServerId,
                    reportTarget.messageId,
                    reportReason,
                    reportDetails.trim() || null,
                    token,
                )
            }
            pushToast({
                level: 'info',
                title: 'Report submitted',
                message: reportTarget.kind === 'message'
                    ? 'The message was reported to the server moderators.'
                    : 'The user was reported to the server moderators.',
            })
            if (showServerSettings && serverSettingsTab === 'safety' && safetySettingsTab === 'reports' && settingsServerId === activeServerId) {
                const refreshed = await serverApi.listReports(activeServerId, token)
                setReportEntries(refreshed)
            }
            setReportTarget(null)
            setReportReason('spam')
            setReportDetails('')
        } catch (err) {
            pushToast({
                level: 'error',
                title: 'Report failed',
                message: err instanceof Error ? err.message : 'Could not submit report.',
            })
        } finally {
            setReportSubmitting(false)
        }
    }, [activeServerId, pushToast, reportDetails, reportReason, reportTarget, safetySettingsTab, serverSettingsTab, settingsServerId, showServerSettings, token])

    // Load roles when Roles tab is opened.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'roles') return
        if (!isLoggedIn || !settingsServerId) return
        const load = async () => {
            setRolesLoading(true)
            setRolesError(null)
            try {
                const roles = await serverApi.listRoles(settingsServerId, token)
                setServerRoles(roles)
                if (roles.length === 0) {
                    // No roles yet: keep editor blank until user creates one.
                    setSelectedRoleId(null)
                    setRoleEditName('')
                    setRoleEditPermissions(0)
                } else if (selectedRoleIdRef.current) {
                    // If a specific role (or "new") was already selected, try to keep that state.
                    const existing = roles.find((r) => r.id === selectedRoleIdRef.current)
                    if (existing) {
                        setSelectedRoleId(existing.id)
                        setRoleEditName(existing.name)
                        setRoleEditPermissions(existing.permissions)
                    }
                } else {
                    // User hasn't selected anything yet: do not auto-select a role.
                    setRoleEditName('')
                    setRoleEditPermissions(0)
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to load roles.'
                setRolesError(message)
            } finally {
                setRolesLoading(false)
            }
        }
        void load()
    }, [showServerSettings, serverSettingsTab, isLoggedIn, settingsServerId, token])

    // Load rules when Rules tab is opened.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'rules') return
        if (!isLoggedIn || !settingsServerId) return
        const load = async () => {
            setRulesLoading(true)
            setRulesError(null)
            try {
                const rules = await serverApi.listRules(settingsServerId, token)
                setServerRules(rules)
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to load rules.'
                setRulesError(message)
            } finally {
                setRulesLoading(false)
            }
        }
        void load()
    }, [showServerSettings, serverSettingsTab, isLoggedIn, settingsServerId, token])

    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'rules') return
        if (!isLoggedIn || !settingsServerId) return
        let active = true
        setOnboardingLoading(true)
        setOnboardingError(null)
        serverApi.getOnboardingGuide(settingsServerId, token)
            .then((guide) => {
                if (active) setSettingsOnboardingGuide(guide)
            })
            .catch((err) => {
                if (active) setOnboardingError(err instanceof Error ? err.message : 'Failed to load welcome guide.')
            })
            .finally(() => {
                if (active) setOnboardingLoading(false)
            })
        return () => {
            active = false
        }
    }, [showServerSettings, serverSettingsTab, isLoggedIn, settingsServerId, token])

    // Load audit log when Audit tab is opened.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'audit') return
        if (!isLoggedIn || !settingsServerId) return
        const requestSequence = ++auditLogRequestSequence.current
        const load = async () => {
            setAuditLogLoading(true)
            setAuditLogLoadingMore(false)
            setAuditLogError(null)
            setAuditLogEntries(null)
            setAuditLogNextBefore(null)
            try {
                const page = await serverApi.auditLog(settingsServerId, token, {
                    action: auditLogActionFilter || undefined,
                    limit: 50,
                })
                if (auditLogRequestSequence.current !== requestSequence) return
                setAuditLogEntries(page.entries)
                setAuditLogNextBefore(page.next_before)
            } catch (err) {
                if (auditLogRequestSequence.current !== requestSequence) return
                const message =
                    err instanceof Error ? err.message : 'Failed to load audit log.'
                setAuditLogError(message)
            } finally {
                if (auditLogRequestSequence.current === requestSequence) {
                    setAuditLogLoading(false)
                }
            }
        }
        void load()
        return () => {
            if (auditLogRequestSequence.current === requestSequence) {
                auditLogRequestSequence.current += 1
            }
        }
    }, [showServerSettings, serverSettingsTab, isLoggedIn, settingsServerId, token, auditLogActionFilter])

    const loadOlderAuditLog = useCallback(async () => {
        if (!settingsServerId || !auditLogNextBefore || auditLogLoadingMore) return
        const requestSequence = auditLogRequestSequence.current
        setAuditLogLoadingMore(true)
        setAuditLogError(null)
        try {
            const page = await serverApi.auditLog(settingsServerId, token, {
                action: auditLogActionFilter || undefined,
                before: auditLogNextBefore,
                limit: 50,
            })
            if (auditLogRequestSequence.current !== requestSequence) return
            setAuditLogEntries((current) => [...(current ?? []), ...page.entries])
            setAuditLogNextBefore(page.next_before)
        } catch (err) {
            if (auditLogRequestSequence.current !== requestSequence) return
            setAuditLogError(err instanceof Error ? err.message : 'Failed to load older audit entries.')
        } finally {
            if (auditLogRequestSequence.current === requestSequence) {
                setAuditLogLoadingMore(false)
            }
        }
    }, [auditLogActionFilter, auditLogLoadingMore, auditLogNextBefore, settingsServerId, token])

    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'safety' || safetySettingsTab !== 'reports' || !canViewReports) return
        if (!isLoggedIn || !settingsServerId) return

        let active = true
        setReportEntriesLoading(true)
        setReportEntriesError(null)
        void Promise.all([
            serverApi.listReports(settingsServerId, token),
            serverApi.listTimeouts(settingsServerId, token),
            serverApi.listRaidEvents(settingsServerId, token),
        ])
            .then(([entries, timeouts, raidEvents]) => {
                if (!active) return
                setReportEntries(entries)
                setTimeoutEntries(timeouts)
                setRaidEventEntries(raidEvents)
            })
            .catch((err) => {
                if (!active) return
                setReportEntriesError(err instanceof Error ? err.message : 'Failed to load moderation activity.')
            })
            .finally(() => {
                if (!active) return
                setReportEntriesLoading(false)
            })

        return () => {
            active = false
        }
    }, [showServerSettings, serverSettingsTab, safetySettingsTab, canViewReports, isLoggedIn, settingsServerId, token])

    // Load bans when Bans tab is opened.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'safety' || safetySettingsTab !== 'bans' || !(isOwner || canManageBans)) return
        if (!isLoggedIn || !settingsServerId) return
        const load = async () => {
            setBanEntriesLoading(true)
            setBanEntriesError(null)
            try {
                const entries = await serverApi.listBans(settingsServerId, token)
                setBanEntries(entries)
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to load banned members.'
                setBanEntriesError(message)
            } finally {
                setBanEntriesLoading(false)
            }
        }
        void load()
    }, [showServerSettings, serverSettingsTab, safetySettingsTab, isOwner, canManageBans, isLoggedIn, settingsServerId, token])

    // When leaving Roles tab or closing Server Settings, drop any unsaved role edits.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'roles') {
            setSelectedRoleId(null)
            setRoleEditName('')
            setRoleEditPermissions(0)
            setRoleEditPreAdminPermissions(null)
            setRolesError(null)
        }
    }, [showServerSettings, serverSettingsTab])

    useEffect(() => {
        setVisibleRoleCount(40)
    }, [serverSettingsServerId, serverRoles])

    useEffect(() => {
        if (availableSafetyTabs.length === 0) return
        if (!availableSafetyTabs.includes(safetySettingsTab)) {
            setSafetySettingsTab(availableSafetyTabs[0])
        }
    }, [availableSafetyTabs, safetySettingsTab])

    const handleCreateRoleDraft = () => {
        setRolesError(null)
        setSelectedRoleId('new')
        setRoleEditName('')
        setRoleEditPermissions(0)
        setRoleEditPreAdminPermissions(null)
        setRoleEditColor(null)
    }

    const handleSelectRole = (role: ServerRole) => {
        if (selectedRoleId === role.id) {
            // Toggle off: collapse editor for this role.
            setSelectedRoleId(null)
            setRoleEditName('')
            setRoleEditPermissions(0)
            setRoleEditPreAdminPermissions(null)
            return
        }
        setSelectedRoleId(role.id)
        setRoleEditName(role.name)
        setRoleEditPermissions(role.permissions)
        setRoleEditPreAdminPermissions(null)
        setRoleEditColor(role.color)
    }

    const handleDropRole = async (targetRoleId: string) => {
        if (!draggingRoleId || !settingsServer) return
        if (draggingRoleId === targetRoleId) return
        const fromIndex = serverRoles.findIndex((r) => r.id === draggingRoleId)
        const toIndex = serverRoles.findIndex((r) => r.id === targetRoleId)
        if (fromIndex === -1 || toIndex === -1) return

        const previous = [...serverRoles]
        const next = [...serverRoles]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        setServerRoles(next)
        setDraggingRoleId(null)
        try {
            await serverApi.reorderRoles(
                settingsServer.id,
                next.map((r) => r.id),
                token,
            )
        } catch (err) {
            setServerRoles(previous)
            const message =
                err instanceof Error
                    ? err.message
                    : 'Failed to reorder roles.'
            setRolesError(message)
        }
    }

    const handleToggleRolePermission = (bit: number, isFullAdmin: boolean, checked: boolean) => {
        const ADMIN_MASK =
            PERM_VIEW_SERVER |
            PERM_MANAGE_SERVER |
            PERM_MANAGE_ROLES |
            PERM_MANAGE_CHANNELS |
            PERM_KICK_MEMBERS |
            PERM_BAN_MEMBERS |
            PERM_VIEW_AUDIT_LOG |
            PERM_SEND_MESSAGES |
            PERM_MANAGE_MESSAGES |
            PERM_MANAGE_PINS |
            PERM_CONNECT_VOICE |
            PERM_MUTE_MEMBERS |
            PERM_DEAFEN_MEMBERS |
            PERM_MOVE_MEMBERS

        if (isFullAdmin) {
            if (checked) {
                // Snapshot current custom set once, so unchecking Full admin can restore it.
                if ((roleEditPermissions & PERM_MANAGE_SERVER) !== PERM_MANAGE_SERVER) {
                    setRoleEditPreAdminPermissions(roleEditPermissions)
                }
                setRoleEditPermissions(roleEditPermissions | ADMIN_MASK)
            } else {
                const restored =
                    roleEditPreAdminPermissions != null
                        ? roleEditPreAdminPermissions
                        : (roleEditPermissions & ~ADMIN_MASK)
                setRoleEditPermissions(restored)
                setRoleEditPreAdminPermissions(null)
            }
            return
        }

        const next = checked ? roleEditPermissions | bit : roleEditPermissions & ~bit
        setRoleEditPermissions(next)
    }

    const handleCancelRoleEdit = () => {
        setSelectedRoleId(null)
        setRoleEditName('')
        setRoleEditPermissions(0)
        setRoleEditPreAdminPermissions(null)
        setRoleEditColor(null)
    }

    const handleSaveRole = async () => {
        if (!settingsServer) return
        const existing = selectedRoleId
            ? serverRoles.find((r) => r.id === selectedRoleId)
            : undefined
        try {
            if (!existing) {
                await serverApi.createRole(
                    settingsServer.id,
                    roleEditName.trim(),
                    roleEditPermissions,
                    token,
                    roleEditColor,
                )
            } else {
                await serverApi.updateRole(
                    settingsServer.id,
                    existing.id,
                    {
                        name: roleEditName.trim(),
                        permissions: roleEditPermissions,
                        color: roleEditColor,
                    },
                    token,
                )
            }
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : 'Failed to save role.'
            setRolesError(message)
            return
        }

        // Prevent duplicate submissions if the follow-up refresh fails.
        handleCancelRoleEdit()

        try {
            const roles = await serverApi.listRoles(
                settingsServer.id,
                token,
            )
            setServerRoles(roles)
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : 'Role was saved, but the latest role list could not be loaded.'
            setRolesError(message)
            pushToast({
                level: 'error',
                title: 'Role refresh failed',
                message: 'The role change was saved, but the role list could not be refreshed yet.',
            })
        }
    }

    const handleRetryDraftAttachment = useCallback(async (localId: string) => {
        const target = draftAttachments.find((attachment) => attachment.localId === localId)
        if (!target?.file) return
        setDraftAttachments((prev) => setDraftAttachmentUploading(prev, localId))
        try {
            const [uploaded] = await attachmentApi.uploadFiles([target.file], token)
            if (!uploaded) throw new Error('Could not upload attachment.')
            setDraftAttachments((prev) => applyUploadedDraftAttachments(prev, [localId], [uploaded]))
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Could not upload attachment(s).'
            setDraftAttachments((prev) => markDraftAttachmentsFailed(prev, [localId], 'Upload failed'))
            pushToast({
                level: 'error',
                title: 'Upload failed',
                message: errorMessage,
            })
        }
    }, [draftAttachments, token, pushToast])

    const handleServerSettingsProfileRender = useCallback(
        (
            id: string,
            phase: 'mount' | 'update' | 'nested-update',
            actualDuration: number,
            baseDuration: number,
            startTime: number,
            commitTime: number,
        ) => {
            const store = ((window as unknown as { __voxperyProfile?: Array<Record<string, unknown>> }).__voxperyProfile ??= [])
            store.push({
                id,
                phase,
                actualDuration,
                baseDuration,
                startTime,
                commitTime,
                at: Date.now(),
            })
            if (store.length > 400) {
                store.splice(0, store.length - 400)
            }
        },
        []
    )

    const refreshServerList = useCallback(async () => {
        if (!isLoggedIn) return []
        const allServers = await serverApi.list(token)
        setServers(allServers)
        return allServers
    }, [setServers, isLoggedIn, token])

    const handleUpdateServerSettings = async () => {
        if (!isLoggedIn || !settingsServer) return
        if (!canSaveServerSettings) return
        setServerSettingsError(null)
        try {
            const payload: { name?: string; icon_url?: string; description?: string; clear_icon?: boolean } = {}
            if (hasNameChanges) payload.name = trimmedServerSettingsName
            if (hasDescriptionChanges) payload.description = serverSettingsDescription.trim() || undefined
            if (hasIconChanges) {
                if (serverSettingsIconDraft == null) payload.clear_icon = true
                else payload.icon_url = serverSettingsIconDraft
            }
            await serverApi.update(settingsServer.id, payload, token)
            await refreshServerList()
            setServerSettingsIconDraft(undefined)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to update server settings.'
            setServerSettingsError(message)
        }
    }

    const handleSaveOnboardingGuide = async (payload: UpdateServerOnboardingGuideRequest) => {
        if (!isLoggedIn || !settingsServerId) return
        setOnboardingSaving(true)
        setOnboardingError(null)
        try {
            const guide = await serverApi.updateOnboardingGuide(settingsServerId, payload, token)
            setSettingsOnboardingGuide(guide)
            if (activeServerId === settingsServerId) {
                setActiveOnboardingGuide(guide)
                if (guide.enabled) setWelcomeGuideDismissed(isWelcomeGuideDismissed(settingsServerId))
            }
            pushToast({
                level: 'info',
                title: 'Welcome guide saved',
                message: guide.enabled ? 'New members will see the welcome guide.' : 'The welcome guide is disabled.',
            })
        } catch (err) {
            setOnboardingError(err instanceof Error ? err.message : 'Failed to save welcome guide.')
        } finally {
            setOnboardingSaving(false)
        }
    }

    const handleResolveSafetyReport = useCallback((reportId: string) => {
        if (!settingsServerId) return
        void (async () => {
            setResolveReportInFlightId(reportId)
            setReportEntriesError(null)
            try {
                await serverApi.resolveReport(settingsServerId, reportId, token)
                const refreshed = await serverApi.listReports(settingsServerId, token)
                setReportEntries(refreshed)
            } catch (err) {
                setReportEntriesError(err instanceof Error ? err.message : 'Failed to resolve report.')
            } finally {
                setResolveReportInFlightId(null)
            }
        })()
    }, [settingsServerId, token])

    const handleClearSafetyTimeout = useCallback((userId: string) => {
        if (!settingsServerId) return
        void (async () => {
            setClearTimeoutInFlightUserId(userId)
            setReportEntriesError(null)
            try {
                await serverApi.clearMemberTimeout(settingsServerId, userId, token)
                const refreshed = await serverApi.listTimeouts(settingsServerId, token)
                setTimeoutEntries(refreshed)
            } catch (err) {
                setReportEntriesError(err instanceof Error ? err.message : 'Failed to clear timeout.')
            } finally {
                setClearTimeoutInFlightUserId(null)
            }
        })()
    }, [settingsServerId, token])

    const handleUnbanSafetyMember = useCallback((userId: string) => {
        if (!settingsServerId) return
        void (async () => {
            setUnbanInFlightUserId(userId)
            setBanEntriesError(null)
            try {
                await serverApi.unbanMember(settingsServerId, userId, token)
                const refreshed = await serverApi.listBans(settingsServerId, token)
                setBanEntries(refreshed)
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to unban member.'
                setBanEntriesError(message)
            } finally {
                setUnbanInFlightUserId(null)
            }
        })()
    }, [settingsServerId, token])

    const actuallyCloseServerSettings = useCallback(() => {
        setShowServerSettings(false)
        setServerSettingsError(null)
        setServerSettingsServerId(null)
        setCopiedInvite(null)
        setServerSettingsName(settingsServer?.name ?? '')
        setServerSettingsDescription(settingsServer?.description ?? '')
        setServerSettingsIconDraft(undefined)
        setServerIconEditor(null)
        setShowDeleteServerConfirm(false)
        setDeleteServerError(null)
        setDeleteServerInput('')
    }, [settingsServer?.name, settingsServer?.description])

    const handleCloseServerSettings = useCallback(() => {
        if (canSaveServerSettings || serverIconEditor) {
            setShowUnsavedServerSettingsConfirm(true)
            return
        }
        actuallyCloseServerSettings()
    }, [canSaveServerSettings, serverIconEditor, actuallyCloseServerSettings])

    const handleServerIconPick = (files: FileList | null) => {
        if (!files || files.length === 0 || !settingsServer) return
        const file = files[0]
        if (!file.type.startsWith('image/')) {
            pushToast({
                level: 'error',
                title: 'Invalid file type',
                message: 'Only image files are supported for server icon uploads.',
            })
            return
        }
        if (file.size > MAX_IMAGE_BYTES) {
            const maxMb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024))
            pushToast({
                level: 'error',
                title: 'Image too large',
                message: `Server icon must be ${maxMb} MB or smaller.`,
            })
            return
        }
        // The icon changes only when the cropped photo is saved from the editor.
        serverIconEditorKeyRef.current += 1
        setServerIconEditor({ file, key: serverIconEditorKeyRef.current })
        setServerSettingsError(null)
    }

    const saveServerIcon = async (iconDataUrl: string): Promise<boolean> => {
        if (!isLoggedIn || !settingsServer) return false
        await serverApi.update(settingsServer.id, { icon_url: iconDataUrl }, token)
        setServerIconEditor(null)
        setServerSettingsIconDraft(undefined)
        setServerSettingsError(null)
        try {
            await refreshServerList()
        } catch {
            // The icon is saved; the realtime server update refreshes the list as well.
        }
        return true
    }

    const handleClearServerIcon = () => {
        if (!settingsServer) return
        setServerSettingsIconDraft(null)
        setServerSettingsError(null)
    }

    const handleDeleteServer = useCallback(async () => {
        if (!isLoggedIn || !settingsServer) return
        setServerSettingsError(null)
        setDeleteServerError(null)
        if (deleteServerInput.trim() !== settingsServer.name) {
            setDeleteServerError('Server name does not match.')
            return
        }
        try {
            await serverApi.delete(settingsServer.id, token)
            const allServers = await refreshServerList()
            const next = allServers.find((s) => s.invite_code === 'voxpery' || s.name === 'Voxpery')?.id ?? allServers[0]?.id ?? null
            setActiveServer(next)
            setShowServerSettings(false)
            setServerSettingsServerId(null)
            setShowDeleteServerConfirm(false)
            setDeleteServerInput('')
            setDeleteServerError(null)
            setCopiedInvite(null)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to delete server.'
            setDeleteServerError(message)
        }
    }, [deleteServerInput, refreshServerList, setActiveServer, token, settingsServer, isLoggedIn])

    useEffect(() => {
        if (!showServerSettings) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (
                    channelSettingsTarget
                    || categoryPermissionsTarget
                    || showUnsavedServerSettingsConfirm
                    || deleteRoleConfirmId
                    || showDeleteServerConfirm
                    || showRenameCategory
                    || deleteCategoryConfirm
                    || showRenameChannel
                    || deleteChannelConfirm
                    || deleteMessageConfirmId
                ) {
                    return
                }
                e.preventDefault()
                handleCloseServerSettings()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [
        showServerSettings,
        handleCloseServerSettings,
        channelSettingsTarget,
        categoryPermissionsTarget,
        showUnsavedServerSettingsConfirm,
        deleteRoleConfirmId,
        showDeleteServerConfirm,
        showRenameCategory,
        deleteCategoryConfirm,
        showRenameChannel,
        deleteChannelConfirm,
        deleteMessageConfirmId,
    ])

    useEffect(() => {
        if (
            !showCreateChannel
            && !showCreateCategory
            && !showCreateServer
            && !showJoinServer
            && !showRenameChannel
            && !showRenameCategory
            && !showDeleteServerConfirm
            && !showUnsavedServerSettingsConfirm
            && !deleteRoleConfirmId
            && !deleteMessageConfirmId
            && !deleteChannelConfirm
            && !deleteCategoryConfirm
            && !channelSettingsTarget
            && !categoryPermissionsTarget
        ) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            if (deleteCategoryConfirm) {
                setDeleteCategoryConfirm(null)
                setDeleteCategoryError(null)
                return
            }
            if (deleteChannelConfirm) {
                setDeleteChannelConfirm(null)
                return
            }
            if (deleteMessageConfirmId) {
                setDeleteMessageConfirmId(null)
                return
            }
            if (deleteRoleConfirmId) {
                setDeleteRoleConfirmId(null)
                return
            }
            if (showUnsavedServerSettingsConfirm) {
                setShowUnsavedServerSettingsConfirm(false)
                return
            }
            if (showDeleteServerConfirm) {
                setShowDeleteServerConfirm(false)
                setDeleteServerError(null)
                return
            }
            if (showRenameCategory) {
                setShowRenameCategory(false)
                setRenameCategoryError(null)
                setRenameCategoryFrom(null)
                return
            }
            if (showRenameChannel) {
                setShowRenameChannel(false)
                setRenameChannelError(null)
                setRenameChannelId(null)
                return
            }
            if (categoryPermissionsTarget) {
                setCategoryPermissionsTarget(null)
                return
            }
            if (channelSettingsTarget) {
                setChannelSettingsTarget(null)
                return
            }
            if (showCreateChannel) {
                setShowCreateChannel(false)
                setCreateChannelError(null)
                setCreateChannelCategory('')
                return
            }
            if (showCreateCategory) {
                setShowCreateCategory(false)
                setCreateCategoryError(null)
                return
            }
            if (showJoinServer) {
                setShowJoinServer(false)
                setJoinServerError(null)
                return
            }
            if (showCreateServer) {
                setShowCreateServer(false)
                setCreateServerError(null)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [
        showCreateChannel,
        showCreateCategory,
        showCreateServer,
        showJoinServer,
        showRenameChannel,
        showRenameCategory,
        showDeleteServerConfirm,
        showUnsavedServerSettingsConfirm,
        deleteRoleConfirmId,
        deleteMessageConfirmId,
        deleteChannelConfirm,
        deleteCategoryConfirm,
        channelSettingsTarget,
        categoryPermissionsTarget,
        setShowCreateServer,
        setShowJoinServer,
    ])

    const activeChannel = channels.find((c) => c.id === activeChannelId)
    // Search results open in their own panel; the conversation stays visible.
    const displayedChannelMessages = useMemo(() => (
        messages.filter((message) => message.channel_id === activeChannelId)
    ), [activeChannelId, messages])
    const channelCategorySuggestions = useMemo(
        () =>
            Array.from(
                new Set(
                    [...channelCategories, ...channels.map((c) => c.category ?? '')]
                        .map((c) => c.trim())
                        .filter((c): c is string => !!c),
                ),
            ).sort((a, b) => a.localeCompare(b)),
        [channels, channelCategories],
    )
    const welcomeGuideNode = activeServer && activeOnboardingGuide && shouldShowServerWelcomeGuide({
        activeServerId: activeServer.id,
        activeChannelType: activeChannel?.channel_type,
        guide: activeOnboardingGuide,
        dismissed: welcomeGuideDismissed,
    }) ? (
        <ServerWelcomeGuide
            guide={activeOnboardingGuide}
            channels={channels}
            serverName={activeServer.name}
            onSelectChannel={(channelId) => {
                setActiveChannel(channelId)
                if (isMobileViewport) setMobileSidebarPanel('none')
            }}
            onJoinVoice={(channelId) => { void joinVoiceChannelFromNavigation(channelId) }}
            onDismiss={() => {
                dismissWelcomeGuide(activeServer.id)
                setWelcomeGuideDismissed(true)
            }}
        />
    ) : undefined

    const handleCreateChannel = async (e: FormEvent) => {
        e.preventDefault()
        if (!isLoggedIn || !activeServerId || !createChannelName.trim()) return
        const validationError = validateChannelNameInput(createChannelName)
        if (validationError) {
            setCreateChannelError(validationError)
            return
        }
        const normalizedCategory = createChannelCategory.trim() || 'GENERAL'
        const categoryValidation = validateCategoryNameInput(normalizedCategory)
        if (categoryValidation) {
            setCreateChannelError(categoryValidation)
            return
        }
        const descriptionValidation = validateChannelDescriptionInput(createChannelDescription)
        if (descriptionValidation) {
            setCreateChannelError(descriptionValidation)
            return
        }
        setCreateChannelError(null)
        try {
            await channelApi.create(
                activeServerId,
                createChannelName.trim(),
                createChannelType,
                token,
                normalizedCategory,
                createChannelDescription.trim() || undefined,
            )
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
            const categories = await channelApi.listCategories(activeServerId, token)
            setChannelCategoriesForServer(activeServerId, categories.map((c) => c.name))
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            setShowCreateChannel(false)
            setCreateChannelName('')
            setCreateChannelType('text')
            setCreateChannelCategory('')
            setCreateChannelDescription('')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create channel.'
            setCreateChannelError(message)
        }
    }

    const openCreateChannelModal = (category?: string) => {
        channelDialogReturnFocusRef.current = document.querySelector<HTMLElement>('.channel-header-server')
        setCreateChannelError(null)
        setCreateChannelName('')
        setCreateChannelType('text')
        setCreateChannelCategory(category ?? '')
        setCreateChannelDescription('')
        setShowCreateChannel(true)
    }

    const openCreateCategoryModal = () => {
        channelDialogReturnFocusRef.current = document.querySelector<HTMLElement>('.channel-header-server')
        setCreateCategoryError(null)
        setCreateCategoryName('')
        setShowCreateCategory(true)
    }

    const handleCreateCategory = async (e: FormEvent) => {
        e.preventDefault()
        if (!isLoggedIn || !activeServerId || !createCategoryName.trim()) return
        const validationError = validateCategoryNameInput(createCategoryName)
        if (validationError) {
            setCreateCategoryError(validationError)
            return
        }
        setCreateCategoryError(null)
        try {
            await channelApi.createCategory(activeServerId, createCategoryName.trim(), token)
            const categories = await channelApi.listCategories(activeServerId, token)
            setChannelCategoriesForServer(activeServerId, categories.map((c) => c.name))
            setShowCreateCategory(false)
            setCreateCategoryName('')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create category.'
            setCreateCategoryError(message)
        }
    }

    const openRenameCategoryModal = (category: string) => {
        channelDialogReturnFocusRef.current = document.querySelector<HTMLElement>('.channel-header-server')
        setRenameCategoryError(null)
        setRenameCategoryFrom(category)
        setRenameCategoryName(category)
        setShowRenameCategory(true)
    }

    const handleRenameCategory = async (e: FormEvent) => {
        e.preventDefault()
        if (!isLoggedIn || !activeServerId || !renameCategoryFrom || !renameCategoryName.trim()) return
        const nextName = renameCategoryName.trim()
        const validationError = validateCategoryNameInput(nextName)
        if (validationError) {
            setRenameCategoryError(validationError)
            return
        }
        setRenameCategoryError(null)
        try {
            await channelApi.renameCategory(activeServerId, renameCategoryFrom, nextName, token)
            const [chs, categories] = await Promise.all([
                serverApi.channels(activeServerId, token),
                channelApi.listCategories(activeServerId, token),
            ])
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
            setChannelCategoriesForServer(activeServerId, categories.map((c) => c.name))
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            setShowRenameCategory(false)
            setRenameCategoryFrom(null)
            setRenameCategoryName('')
        } catch (err: unknown) {
            setRenameCategoryError(err instanceof Error ? err.message : 'Failed to rename category.')
        }
    }

    /** Category that receives the deleted category's channels; `null` when no other category exists. */
    const resolveDeleteCategoryMoveTarget = useCallback(
        (categoryName: string): string | null => {
            const normalized = categoryName.trim().toLowerCase()
            const preferredGeneral = channelCategories.find(
                (name) => name.trim().toLowerCase() === 'general',
            )

            if (preferredGeneral && preferredGeneral.trim().toLowerCase() !== normalized) {
                return preferredGeneral
            }

            const firstOther = channelCategories.find(
                (name) => name.trim().toLowerCase() !== normalized,
            )
            return firstOther ?? null
        },
        [channelCategories],
    )

    const openRenameChannelModal = (channel: Channel) => {
        channelDialogReturnFocusRef.current = document.querySelector<HTMLElement>('.channel-header-server')
        setRenameChannelError(null)
        setRenameChannelId(channel.id)
        setRenameChannelName(channel.name)
        setRenameChannelDescription(channel.description ?? '')
        setShowRenameChannel(true)
    }

    const handleRenameChannel = async (e: FormEvent) => {
        e.preventDefault()
        if (!isLoggedIn || !renameChannelId || !renameChannelName.trim()) return
        const validationError = validateChannelNameInput(renameChannelName)
        if (validationError) {
            setRenameChannelError(validationError)
            return
        }
        const descriptionValidation = validateChannelDescriptionInput(renameChannelDescription)
        if (descriptionValidation) {
            setRenameChannelError(descriptionValidation)
            return
        }
        setRenameChannelError(null)
        try {
            await channelApi.rename(
                renameChannelId,
                renameChannelName.trim(),
                token,
                undefined,
                renameChannelDescription.trim() || undefined,
            )
            if (!activeServerId) return
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            setShowRenameChannel(false)
            setRenameChannelId(null)
            setRenameChannelName('')
            setRenameChannelDescription('')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to rename channel.'
            setRenameChannelError(message)
        }
    }

    const handleDeleteChannel = async (channel: Channel) => {
        if (!isLoggedIn || !activeServerId) return
        const previousChannels = channels
        const newChs = previousChannels.filter((c) => c.id !== channel.id)
        setChannels(newChs)
        setChannelsForServer(activeServerId, newChs)
        setChannelServerMap((prev) => {
            const next = { ...prev }
            delete next[channel.id]
            return next
        })
        if (activeChannelId === channel.id) {
            const nextText = newChs.find((c) => c.channel_type === 'text')
            setActiveChannel(nextText?.id ?? newChs[0]?.id ?? null)
        }
        try {
            await channelApi.delete(channel.id, token)
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
            const categories = await channelApi.listCategories(activeServerId, token)
            setChannelCategoriesForServer(activeServerId, categories.map((c) => c.name))
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
        } catch (err) {
            setChannels(previousChannels)
            setChannelsForServer(activeServerId, previousChannels)
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of previousChannels) next[ch.id] = ch.server_id
                return next
            })
            if (activeChannelId === channel.id) setActiveChannel(channel.id)
            pushToast({
                level: 'error',
                title: 'Failed to delete channel',
                message: err instanceof Error ? err.message : 'Could not delete channel',
            })
        } finally {
            setDeleteChannelConfirm(null)
        }
    }

    const orderedChannelIds = (source: Channel[]) =>
        [...source]
            .sort(compareChannelsForSidebar)
            .map((c) => c.id)

    const handleReorderChannels = async (
        draggedChannelId: string,
        targetChannelId: string,
        position: 'before' | 'after',
    ) => {
        if (!isLoggedIn || !activeServerId) return
        const dragged = channels.find((c) => c.id === draggedChannelId)
        const target = channels.find((c) => c.id === targetChannelId)
        if (!dragged || !target) return
        if (dragged.channel_type !== target.channel_type) return

        const previous = [...channels]
        const targetCategory = target.category ?? 'Channels'
        const shouldMoveCategory = (dragged.category ?? 'Channels') !== targetCategory

        const ordered = [...channels].sort(compareChannelsForSidebar)
        const withoutDragged = ordered.filter((c) => c.id !== draggedChannelId)
        const targetIndex = withoutDragged.findIndex((c) => c.id === targetChannelId)
        if (targetIndex < 0) return

        const moved = ordered.find((c) => c.id === draggedChannelId)
        if (!moved) return

        const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
        withoutDragged.splice(insertIndex, 0, {
            ...moved,
            category: shouldMoveCategory ? targetCategory : moved.category,
        })

        const positionByCategory = new Map<string, number>()
        const nextChannels = withoutDragged.map((channel) => {
            const category = channel.category ?? 'Channels'
            const nextPosition = positionByCategory.get(category) ?? 0
            positionByCategory.set(category, nextPosition + 1)
            if (channel.position === nextPosition) return channel
            return { ...channel, position: nextPosition }
        })

        setChannels(nextChannels)
        setChannelsForServer(activeServerId, nextChannels)
        try {
            if (shouldMoveCategory) {
                await channelApi.rename(
                    dragged.id,
                    dragged.name,
                    token,
                    targetCategory,
                    dragged.description ?? undefined,
                )
            }
            await channelApi.reorder(activeServerId, orderedChannelIds(nextChannels), token)
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
        } catch (err) {
            console.error('Failed to reorder channels:', err)
            setChannels(previous)
            setChannelsForServer(activeServerId, previous)
        }
    }

    const handleMoveChannelToCategory = async (
        draggedChannelId: string,
        targetCategory: string,
        placement: 'start' | 'end' = 'end',
    ) => {
        if (!isLoggedIn || !activeServerId) return
        const dragged = channels.find((c) => c.id === draggedChannelId)
        if (!dragged) return
        const currentCategory = dragged.category ?? 'Channels'
        if (currentCategory === targetCategory) return

        const previous = [...channels]
        const movedBase = channels.map((ch) =>
            ch.id === draggedChannelId
                ? {
                    ...ch,
                    category: targetCategory,
                    position: placement === 'start' ? -1 : Number.MAX_SAFE_INTEGER,
                }
                : ch,
        )
        const sortedByCategory = [...movedBase].sort(compareChannelsForSidebar)
        const positionByCategory = new Map<string, number>()
        const nextChannels = sortedByCategory.map((ch) => {
            const cat = ch.category ?? 'Channels'
            const nextPos = positionByCategory.get(cat) ?? 0
            positionByCategory.set(cat, nextPos + 1)
            if (ch.position === nextPos) return ch
            return { ...ch, position: nextPos }
        })

        setChannels(nextChannels)
        setChannelsForServer(activeServerId, nextChannels)
        try {
            await channelApi.rename(dragged.id, dragged.name, token, targetCategory, dragged.description ?? undefined)
            await channelApi.reorder(activeServerId, orderedChannelIds(nextChannels), token)
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
        } catch (err) {
            console.error('Failed to move channel to category:', err)
            setChannels(previous)
            setChannelsForServer(activeServerId, previous)
        }
    }

    const handleReorderCategories = async (
        draggedCategory: string,
        targetCategory: string,
        position: 'before' | 'after',
    ) => {
        if (!isLoggedIn || !activeServerId) return
        if (draggedCategory === targetCategory) return
        const derivedFromChannels = Array.from(
            new Set(
                channels
                    .map((c) => c.category?.trim())
                    .filter((c): c is string => !!c),
            ),
        )
        const baseCategories = Array.from(new Set([...channelCategories, ...derivedFromChannels]))
        const next = baseCategories.filter((c) => c !== draggedCategory)
        const targetIndex = next.findIndex((c) => c === targetCategory)
        if (targetIndex < 0) return
        const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
        next.splice(insertIndex, 0, draggedCategory)
        setChannelCategoriesForServer(activeServerId, next)
        try {
            await channelApi.reorderCategories(activeServerId, next, token)
        } catch (err) {
            console.error('Failed to reorder categories:', err)
            const categories = await channelApi.listCategories(activeServerId, token).catch(() => [])
            setChannelCategoriesForServer(activeServerId, categories.map((c) => c.name))
        }
    }

    // ─── Render ────────────────────────────────

    return (
        <div className={`app-layout ${mobileSidebarPanel === 'channels' ? 'app-layout--mobile-sidebar-open' : ''}`}>
            {!skipServerSidebar && (
                <ServerSidebar
                    onCreateServer={openCreateModal}
                    onJoinServer={openJoinModal}
                    onOpenServerSettings={openServerSettingsForServer}
                />
            )}
            <ChannelSidebar
                loading={serverRouteLoading || (!activeServerId && serversLoading)}
                onOpenServerSettings={() => openServerSettingsModal()}
                inviteLink={activeServerInviteLink || undefined}
                onOpenCreateChannel={openCreateChannelModal}
                onOpenCreateCategory={openCreateCategoryModal}
                onOpenCategoryPermissions={isActiveServerOwner ? (category) => setCategoryPermissionsTarget(category) : undefined}
                onRenameCategory={openRenameCategoryModal}
                onDeleteCategory={(category) => {
                    setDeleteCategoryError(null)
                    setDeleteCategoryConfirm(category)
                }}
                onReorderCategories={handleReorderCategories}
                onMoveChannelToCategory={handleMoveChannelToCategory}
                channelCategories={channelCategories}
                canManageChannels={canManageChannels}
                canMuteMembers={canMuteMembers}
                canDeafenMembers={canDeafenMembers}
                canMoveMembers={canMoveMembers}
                canDisconnectMembers={canDisconnectMembers}
                unreadByChannel={serverUnreadByChannel}
                mentionByChannel={serverMentionsByChannel}
                voiceControls={voiceControls}
                onRenameChannel={openRenameChannelModal}
                onOpenChannelPermissions={isActiveServerOwner ? (channel) => setChannelSettingsTarget(channel) : undefined}
                onDeleteChannel={(channel) => setDeleteChannelConfirm(channel)}
                onReorderChannels={handleReorderChannels}
                onOpenDirectMessage={(userId) => navigate(ROUTES.dm, { state: { openDmUserId: userId } })}
            />
            {mobileSidebarPanel === 'channels' && (
                <button
                    type="button"
                    className="mobile-sidebar-backdrop"
                    aria-label="Close channel sidebar"
                    onClick={() => setMobileSidebarPanel('none')}
                />
            )}
            <ChatArea
                activeChannel={activeChannel}
                loading={serverRouteLoading || (!activeServerId && serversLoading) || (!olderMessagesReady && displayedChannelMessages.length === 0)}
                messages={displayedChannelMessages}
                unreadDividerCount={channelUnreadDividerCount}
                draftAttachments={draftAttachments}
                messageInput={messageInput}
                topContent={welcomeGuideNode}
                onPickAttachments={handleAttachmentPick}
                onRemoveAttachment={(index) => setDraftAttachments((prev) => prev.filter((_, i) => i !== index))}
                onRetryAttachment={handleRetryDraftAttachment}
                onMessageInputChange={handleMessageInputChange}
                onSendMessage={handleSendMessage}
                onRetryMessage={handleRetryMessage}
                onDeleteMessage={(messageId) => setDeleteMessageConfirmId(messageId)}
                onReportMessage={openMessageReport}
                onReplyToMessage={handleReplyToMessage}
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
                editingMessageId={editingMessageId}
                editingContent={editingContent}
                onEditMessage={(msg) => {
                    setEditingMessageId(msg.id)
                    setEditingContent(msg.contentToEdit ?? msg.content)
                    setEditingReplyQuotePart(msg.replyQuotePart ?? null)
                }}
                onEditingContentChange={setEditingContent}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                currentUserId={user?.id ?? null}
                canModerate={canManageMessages}
                mentionUsers={members.map((member) => ({
                    user_id: member.user_id,
                    username: member.username,
                    avatar_url: member.avatar_url,
                    status: member.status,
                }))}
                isViewActive={isViewActive}
                hasMoreOlder={olderMessagesReady && hasMoreOlder}
                loadingOlder={loadingOlder}
                onLoadOlder={loadOlderMessages}
                searchQuery={channelSearch}
                onSearchChange={setChannelSearch}
                pinnedMessages={channelPins}
                onGoToPinnedMessage={handleJumpToPinnedMessage}
                searchResults={channelSearch.trim() ? channelSearchResults : null}
                searchScopeLabel={activeChannel ? `#${activeChannel.name}` : 'this channel'}
                onGoToSearchResult={(messageId) => { void handleJumpToPinnedMessage(messageId, 'search') }}
                searchJumpingMessageId={pinnedJumpLoadingId}
                pinnedJumpLoadingId={pinnedJumpLoadingId}
                onReturnToLatest={historicalChannelId === activeChannelId ? handleReturnToLatest : undefined}
                returningToLatest={returningToLatest}
                jumpToMessageId={pinnedJumpTargetId}
                onJumpToMessageHandled={handlePinnedJumpVisible}
                onPinMessage={canManagePins ? handlePinChannelMessage : undefined}
                onUnpinMessage={canManagePins ? handleUnpinChannelMessage : undefined}
                onToggleReaction={canSendMessages ? handleToggleChannelReaction : undefined}
                canSendMessages={canSendMessages}
                composerBlockedMessage={composerBlockedMessage}
                showMemberSheetButton={!!activeServerId}
                onOpenMemberSheet={isMobileViewport ? () => setShowMobileMemberSheet(true) : toggleMemberPanel}
                memberPanelOpen={isMobileViewport ? undefined : memberPanelOpen}
                onOpenInviteLink={(code) => navigate(ROUTES.invite(code))}
                onOpenChannelList={isMobileViewport && activeServerId ? () => setMobileSidebarPanel('channels') : undefined}
                emptyStateDescription={activeServer
                    ? isSoloServer
                        ? 'You are the first member here. Share the invite link or send the first message to get the server moving.'
                        : 'This channel is quiet for now. Send the first message to get things moving.'
                    : undefined}
                emptyStateActions={activeServer && isSoloServer ? [
                    {
                        label: emptyInviteCopied ? 'Copied' : 'Copy invite',
                        onClick: copyActiveServerInvite,
                    },
                ] : undefined}
            />
            <MemberSidebar
                canKickMembers={(activePerms & PERM_KICK_MEMBERS) === PERM_KICK_MEMBERS}
                canBanMembers={canBanMembers}
                canTimeoutMembers={(activePerms & PERM_MANAGE_MESSAGES) === PERM_MANAGE_MESSAGES}
                onReportMember={openUserReport}
                collapsed={!isMobileViewport && !memberPanelOpen}
            />
            {showMobileMemberSheet && isMobileViewport && createPortal(
                <>
                    <button
                        type="button"
                        className="mobile-member-sheet-backdrop"
                        aria-label="Close members panel"
                        onClick={() => setShowMobileMemberSheet(false)}
                    />
                    <aside
                        className="mobile-member-sheet"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Server members"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <header className="mobile-member-sheet-header">
                            <div className="mobile-member-sheet-copy">
                                <h3>Members</h3>
                                <p>{members.length} {members.length === 1 ? 'member' : 'members'}</p>
                            </div>
                            <button
                                type="button"
                                className="mobile-member-sheet-close"
                                onClick={() => setShowMobileMemberSheet(false)}
                                aria-label="Close members panel"
                            >
                                <X size={16} />
                            </button>
                        </header>
                        <MemberSidebar
                            canKickMembers={(activePerms & PERM_KICK_MEMBERS) === PERM_KICK_MEMBERS}
                            canBanMembers={canBanMembers}
                            canTimeoutMembers={(activePerms & PERM_MANAGE_MESSAGES) === PERM_MANAGE_MESSAGES}
                            onReportMember={openUserReport}
                            variant="sheet"
                        />
                    </aside>
                </>,
                document.body,
            )}

            {createPortal(
                <>
                    <ServerCreationDialogs
                      activeServerId={activeServerId}
                      channelCategorySuggestions={channelCategorySuggestions}
                      channelDialogReturnFocusRef={channelDialogReturnFocusRef}
                      createCategoryError={createCategoryError}
                      createCategoryName={createCategoryName}
                      createChannelCategory={createChannelCategory}
                      createChannelDescription={createChannelDescription}
                      createChannelError={createChannelError}
                      createChannelName={createChannelName}
                      createChannelType={createChannelType}
                      createServerError={createServerError}
                      createServerRequestIdRef={createServerRequestIdRef}
                      handleCreateCategory={handleCreateCategory}
                      handleCreateChannel={handleCreateChannel}
                      handleCreateServer={handleCreateServer}
                      handleJoinServer={handleJoinServer}
                      handleRenameChannel={handleRenameChannel}
                      inviteCode={inviteCode}
                      isCreatingServer={isCreatingServer}
                      isMobileViewport={isMobileViewport}
                      joinServerError={joinServerError}
                      newServerDescription={newServerDescription}
                      newServerName={newServerName}
                      renameChannelDescription={renameChannelDescription}
                      renameChannelError={renameChannelError}
                      renameChannelName={renameChannelName}
                      serverDialogRef={serverDialogRef}
                      setCreateCategoryError={setCreateCategoryError}
                      setCreateCategoryName={setCreateCategoryName}
                      setCreateChannelCategory={setCreateChannelCategory}
                      setCreateChannelDescription={setCreateChannelDescription}
                      setCreateChannelError={setCreateChannelError}
                      setCreateChannelName={setCreateChannelName}
                      setCreateChannelType={setCreateChannelType}
                      setCreateServerError={setCreateServerError}
                      setInviteCode={setInviteCode}
                      setJoinServerError={setJoinServerError}
                      setNewServerDescription={setNewServerDescription}
                      setNewServerName={setNewServerName}
                      setRenameChannelDescription={setRenameChannelDescription}
                      setRenameChannelError={setRenameChannelError}
                      setRenameChannelId={setRenameChannelId}
                      setRenameChannelName={setRenameChannelName}
                      setShowCreateCategory={setShowCreateCategory}
                      setShowCreateChannel={setShowCreateChannel}
                      setShowCreateServer={setShowCreateServer}
                      setShowJoinServer={setShowJoinServer}
                      setShowRenameChannel={setShowRenameChannel}
                      showCreateCategory={showCreateCategory}
                      showCreateChannel={showCreateChannel}
                      showCreateServer={showCreateServer}
                      showJoinServer={showJoinServer}
                      showRenameChannel={showRenameChannel}
                    />

                    {/* Server Settings Modal */}
                    <ServerSettingsModal
                      auditLogActionFilter={auditLogActionFilter}
                      auditLogEntries={auditLogEntries}
                      auditLogError={auditLogError}
                      auditLogLoading={auditLogLoading}
                      auditLogLoadingMore={auditLogLoadingMore}
                      auditLogNextBefore={auditLogNextBefore}
                      banEntries={banEntries}
                      banEntriesError={banEntriesError}
                      banEntriesLoading={banEntriesLoading}
                      canManageAutoMod={canManageAutoMod}
                      canManageBans={canManageBans}
                      canSaveServerSettings={canSaveServerSettings}
                      canViewAuditLog={canViewAuditLog}
                      canViewReports={canViewReports}
                      canViewSafety={canViewSafety}
                      channels={channels}
                      clearTimeoutInFlightUserId={clearTimeoutInFlightUserId}
                      copiedInvite={copiedInvite}
                      editingRuleId={editingRuleId}
                      editingRuleText={editingRuleText}
                      effectiveServerIcon={effectiveServerIcon}
                      effectiveServerIconSrc={effectiveServerIconSrc}
                      handleCancelRoleEdit={handleCancelRoleEdit}
                      handleClearSafetyTimeout={handleClearSafetyTimeout}
                      handleClearServerIcon={handleClearServerIcon}
                      handleCloseServerSettings={handleCloseServerSettings}
                      handleCreateRoleDraft={handleCreateRoleDraft}
                      handleDropRole={handleDropRole}
                      handleResolveSafetyReport={handleResolveSafetyReport}
                      handleSaveOnboardingGuide={handleSaveOnboardingGuide}
                      handleSaveRole={handleSaveRole}
                      handleSelectRole={handleSelectRole}
                      handleServerIconPick={handleServerIconPick}
                      handleServerSettingsProfileRender={handleServerSettingsProfileRender}
                      handleToggleRolePermission={handleToggleRolePermission}
                      handleUnbanSafetyMember={handleUnbanSafetyMember}
                      handleUpdateServerSettings={handleUpdateServerSettings}
                      hasMoreServerRoles={hasMoreServerRoles}
                      isMobileViewport={isMobileViewport}
                      isOwner={isOwner}
                      loadOlderAuditLog={loadOlderAuditLog}
                      memberUsernameById={memberUsernameById}
                      newRuleText={newRuleText}
                      onboardingError={onboardingError}
                      onboardingLoading={onboardingLoading}
                      onboardingSaving={onboardingSaving}
                      pushToast={pushToast}
                      raidEventEntries={raidEventEntries}
                      reportEntries={reportEntries}
                      reportEntriesError={reportEntriesError}
                      reportEntriesLoading={reportEntriesLoading}
                      resolveReportInFlightId={resolveReportInFlightId}
                      roleEditColor={roleEditColor}
                      roleEditName={roleEditName}
                      roleEditPermissions={roleEditPermissions}
                      rolesError={rolesError}
                      rolesLoading={rolesLoading}
                      rulesError={rulesError}
                      rulesLoading={rulesLoading}
                      safetySettingsTab={safetySettingsTab}
                      saveServerIcon={saveServerIcon}
                      selectedRoleId={selectedRoleId}
                      serverIconEditor={serverIconEditor}
                      serverIconInputRef={serverIconInputRef}
                      serverRoles={serverRoles}
                      serverRules={serverRules}
                      serverSettingsDescription={serverSettingsDescription}
                      serverSettingsError={serverSettingsError}
                      serverSettingsName={serverSettingsName}
                      serverSettingsReturnFocusRef={serverSettingsReturnFocusRef}
                      serverSettingsTab={serverSettingsTab}
                      setAuditLogActionFilter={setAuditLogActionFilter}
                      setCopiedInvite={setCopiedInvite}
                      setDeleteRoleConfirmId={setDeleteRoleConfirmId}
                      setDeleteServerError={setDeleteServerError}
                      setDeleteServerInput={setDeleteServerInput}
                      setDraggingRoleId={setDraggingRoleId}
                      setEditingRuleId={setEditingRuleId}
                      setEditingRuleText={setEditingRuleText}
                      setNewRuleText={setNewRuleText}
                      setRoleEditColor={setRoleEditColor}
                      setRoleEditName={setRoleEditName}
                      setRulesError={setRulesError}
                      setSafetySettingsTab={setSafetySettingsTab}
                      setServerIconEditor={setServerIconEditor}
                      setServerRules={setServerRules}
                      setServerSettingsDescription={setServerSettingsDescription}
                      setServerSettingsName={setServerSettingsName}
                      setServerSettingsTab={setServerSettingsTab}
                      setShowDeleteServerConfirm={setShowDeleteServerConfirm}
                      setVisibleRoleCount={setVisibleRoleCount}
                      settingsOnboardingGuide={settingsOnboardingGuide}
                      settingsServer={settingsServer}
                      settingsServerId={settingsServerId}
                      settingsServerInviteLink={settingsServerInviteLink}
                      showServerSettings={showServerSettings}
                      timeoutEntries={timeoutEntries}
                      token={token}
                      unbanInFlightUserId={unbanInFlightUserId}
                      visibleServerRoles={visibleServerRoles}
                    />
                    <ServerConfirmDialogs
                      activeServerId={activeServerId}
                      actuallyCloseServerSettings={actuallyCloseServerSettings}
                      categoryPermissionsTarget={categoryPermissionsTarget}
                      channelDialogReturnFocusRef={channelDialogReturnFocusRef}
                      channelSettingsTarget={channelSettingsTarget}
                      channels={channels}
                      closeReportDialog={closeReportDialog}
                      deleteCategoryConfirm={deleteCategoryConfirm}
                      deleteCategoryError={deleteCategoryError}
                      deleteChannelConfirm={deleteChannelConfirm}
                      deleteMessageConfirmId={deleteMessageConfirmId}
                      deleteRoleConfirmId={deleteRoleConfirmId}
                      deleteServerError={deleteServerError}
                      deleteServerInput={deleteServerInput}
                      handleDeleteChannel={handleDeleteChannel}
                      handleDeleteMessage={handleDeleteMessage}
                      handleDeleteServer={handleDeleteServer}
                      handleRenameCategory={handleRenameCategory}
                      handleSubmitReport={handleSubmitReport}
                      isActiveServerOwner={isActiveServerOwner}
                      isLoggedIn={isLoggedIn}
                      renameCategoryError={renameCategoryError}
                      renameCategoryName={renameCategoryName}
                      reportDetails={reportDetails}
                      reportReason={reportReason}
                      reportSubmitting={reportSubmitting}
                      reportTarget={reportTarget}
                      resolveDeleteCategoryMoveTarget={resolveDeleteCategoryMoveTarget}
                      serverRoles={serverRoles}
                      serverSettingsReturnFocusRef={serverSettingsReturnFocusRef}
                      setCategoryPermissionsTarget={setCategoryPermissionsTarget}
                      setChannelCategoriesForServer={setChannelCategoriesForServer}
                      setChannelSettingsTarget={setChannelSettingsTarget}
                      setChannels={setChannels}
                      setChannelsForServer={setChannelsForServer}
                      setDeleteCategoryConfirm={setDeleteCategoryConfirm}
                      setDeleteCategoryError={setDeleteCategoryError}
                      setDeleteChannelConfirm={setDeleteChannelConfirm}
                      setDeleteMessageConfirmId={setDeleteMessageConfirmId}
                      setDeleteRoleConfirmId={setDeleteRoleConfirmId}
                      setDeleteServerError={setDeleteServerError}
                      setDeleteServerInput={setDeleteServerInput}
                      setRenameCategoryError={setRenameCategoryError}
                      setRenameCategoryFrom={setRenameCategoryFrom}
                      setRenameCategoryName={setRenameCategoryName}
                      setReportDetails={setReportDetails}
                      setReportReason={setReportReason}
                      setRoleEditName={setRoleEditName}
                      setRoleEditPermissions={setRoleEditPermissions}
                      setRoleEditPreAdminPermissions={setRoleEditPreAdminPermissions}
                      setRolesError={setRolesError}
                      setSelectedRoleId={setSelectedRoleId}
                      setServerRoles={setServerRoles}
                      setShowDeleteServerConfirm={setShowDeleteServerConfirm}
                      setShowRenameCategory={setShowRenameCategory}
                      setShowUnsavedServerSettingsConfirm={setShowUnsavedServerSettingsConfirm}
                      settingsServer={settingsServer}
                      showDeleteServerConfirm={showDeleteServerConfirm}
                      showRenameCategory={showRenameCategory}
                      showUnsavedServerSettingsConfirm={showUnsavedServerSettingsConfirm}
                      token={token}
                    />
                </>,
                document.body
            )}
        </div>
    )
}
