import type { ToastItem } from '../stores/toast'
import type { Server } from '../types'
import { Profiler, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { type Channel, type ServerRole, type ServerRule, type AuditLogEntry, type ServerBanEntry, type ServerReportEntry, type ServerTimeoutEntry, type RaidEventEntry, type ServerOnboardingGuide, type UpdateServerOnboardingGuideRequest } from '../api'
import ModalSurface from '../components/ModalSurface'
import { SERVER_NAME_MAX } from './appLayoutModel'
import ProfileAvatarEditor from '../components/ProfileAvatarEditor'
import ServerSettingsAuditLog from '../components/ServerSettingsAuditLog'
import ServerSettingsCommunity from '../components/ServerSettingsCommunity'
import ServerSettingsSafety, { type SafetySettingsTab } from '../components/ServerSettingsSafety'
import ServerRolesSidebar from '../components/ServerRolesSidebar'
import ServerRoleEditor from '../components/ServerRoleEditor'
import { AlertTriangle, LayoutDashboard, ListChecks, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ServerSettingsLocalTab } from './appLayoutModel'
import { SERVER_SETTINGS_SECTION_META, PERM_MANAGE_SERVER, PERM_MANAGE_ROLES, PERM_MANAGE_CHANNELS, PERM_KICK_MEMBERS, PERM_BAN_MEMBERS, PERM_VIEW_AUDIT_LOG, PERM_MANAGE_MESSAGES, PERM_MANAGE_PINS, PERM_MUTE_MEMBERS, PERM_DEAFEN_MEMBERS, PERM_MOVE_MEMBERS } from './appLayoutModel'

export interface ServerSettingsModalProps {
    auditLogActionFilter: string
    auditLogEntries: AuditLogEntry[] | null
    auditLogError: string | null
    auditLogLoading: boolean
    auditLogLoadingMore: boolean
    auditLogNextBefore: string | null
    banEntries: ServerBanEntry[] | null
    banEntriesError: string | null
    banEntriesLoading: boolean
    canManageAutoMod: boolean
    canManageBans: boolean
    canSaveServerSettings: boolean
    canViewAuditLog: boolean
    canViewReports: boolean
    canViewSafety: boolean
    channels: Channel[]
    clearTimeoutInFlightUserId: string | null
    copiedInvite: "link" | "code" | null
    editingRuleId: string | null
    editingRuleText: string
    effectiveServerIcon: string | null
    effectiveServerIconSrc: string | null
    handleCancelRoleEdit: () => void
    handleClearSafetyTimeout: (userId: string) => void
    handleClearServerIcon: () => void
    handleCloseServerSettings: () => void
    handleCreateRoleDraft: () => void
    handleDropRole: (targetRoleId: string) => Promise<void>
    handleResolveSafetyReport: (reportId: string) => void
    handleSaveOnboardingGuide: (payload: UpdateServerOnboardingGuideRequest) => Promise<void>
    handleSaveRole: () => Promise<void>
    handleSelectRole: (role: ServerRole) => void
    handleServerIconPick: (files: FileList | null) => void
    handleServerSettingsProfileRender: (id: string, phase: "mount" | "update" | "nested-update", actualDuration: number, baseDuration: number, startTime: number, commitTime: number) => void
    handleToggleRolePermission: (bit: number, isFullAdmin: boolean, checked: boolean) => void
    handleUnbanSafetyMember: (userId: string) => void
    handleUpdateServerSettings: () => Promise<void>
    hasMoreServerRoles: boolean
    isMobileViewport: boolean
    isOwner: boolean
    loadOlderAuditLog: () => Promise<void>
    memberUsernameById: Map<string, string>
    newRuleText: string
    onboardingError: string | null
    onboardingLoading: boolean
    onboardingSaving: boolean
    pushToast: (toast: Omit<ToastItem, "id">, ttlMs?: number) => void
    raidEventEntries: RaidEventEntry[] | null
    reportEntries: ServerReportEntry[] | null
    reportEntriesError: string | null
    reportEntriesLoading: boolean
    resolveReportInFlightId: string | null
    roleEditColor: string | null
    roleEditName: string
    roleEditPermissions: number
    rolesError: string | null
    rolesLoading: boolean
    rulesError: string | null
    rulesLoading: boolean
    safetySettingsTab: SafetySettingsTab
    saveServerIcon: (iconDataUrl: string) => Promise<boolean>
    selectedRoleId: string | null
    serverIconEditor: { file: File; key: number; } | null
    serverIconInputRef: RefObject<HTMLInputElement | null>
    serverRoles: ServerRole[]
    serverRules: ServerRule[]
    serverSettingsDescription: string
    serverSettingsError: string | null
    serverSettingsName: string
    serverSettingsReturnFocusRef: RefObject<HTMLElement | null>
    serverSettingsTab: ServerSettingsLocalTab
    setAuditLogActionFilter: Dispatch<SetStateAction<string>>
    setCopiedInvite: Dispatch<SetStateAction<"link" | "code" | null>>
    setDeleteRoleConfirmId: Dispatch<SetStateAction<string | null>>
    setDeleteServerError: Dispatch<SetStateAction<string | null>>
    setDeleteServerInput: Dispatch<SetStateAction<string>>
    setDraggingRoleId: Dispatch<SetStateAction<string | null>>
    setEditingRuleId: Dispatch<SetStateAction<string | null>>
    setEditingRuleText: Dispatch<SetStateAction<string>>
    setNewRuleText: Dispatch<SetStateAction<string>>
    setRoleEditColor: Dispatch<SetStateAction<string | null>>
    setRoleEditName: Dispatch<SetStateAction<string>>
    setRulesError: Dispatch<SetStateAction<string | null>>
    setSafetySettingsTab: Dispatch<SetStateAction<SafetySettingsTab>>
    setServerIconEditor: Dispatch<SetStateAction<{ file: File; key: number; } | null>>
    setServerRules: Dispatch<SetStateAction<ServerRule[]>>
    setServerSettingsDescription: Dispatch<SetStateAction<string>>
    setServerSettingsName: Dispatch<SetStateAction<string>>
    setServerSettingsTab: Dispatch<SetStateAction<ServerSettingsLocalTab>>
    setShowDeleteServerConfirm: Dispatch<SetStateAction<boolean>>
    setVisibleRoleCount: Dispatch<SetStateAction<number>>
    settingsOnboardingGuide: ServerOnboardingGuide | null
    settingsServer: Server | undefined
    settingsServerId: string | null
    settingsServerInviteLink: string
    showServerSettings: boolean
    timeoutEntries: ServerTimeoutEntry[] | null
    token: string | null
    unbanInFlightUserId: string | null
    visibleServerRoles: ServerRole[]
}

/** Moved unchanged out of AppLayout.tsx. */
export default function ServerSettingsModal({
    auditLogActionFilter,
    auditLogEntries,
    auditLogError,
    auditLogLoading,
    auditLogLoadingMore,
    auditLogNextBefore,
    banEntries,
    banEntriesError,
    banEntriesLoading,
    canManageAutoMod,
    canManageBans,
    canSaveServerSettings,
    canViewAuditLog,
    canViewReports,
    canViewSafety,
    channels,
    clearTimeoutInFlightUserId,
    copiedInvite,
    editingRuleId,
    editingRuleText,
    effectiveServerIcon,
    effectiveServerIconSrc,
    handleCancelRoleEdit,
    handleClearSafetyTimeout,
    handleClearServerIcon,
    handleCloseServerSettings,
    handleCreateRoleDraft,
    handleDropRole,
    handleResolveSafetyReport,
    handleSaveOnboardingGuide,
    handleSaveRole,
    handleSelectRole,
    handleServerIconPick,
    handleServerSettingsProfileRender,
    handleToggleRolePermission,
    handleUnbanSafetyMember,
    handleUpdateServerSettings,
    hasMoreServerRoles,
    isMobileViewport,
    isOwner,
    loadOlderAuditLog,
    memberUsernameById,
    newRuleText,
    onboardingError,
    onboardingLoading,
    onboardingSaving,
    pushToast,
    raidEventEntries,
    reportEntries,
    reportEntriesError,
    reportEntriesLoading,
    resolveReportInFlightId,
    roleEditColor,
    roleEditName,
    roleEditPermissions,
    rolesError,
    rolesLoading,
    rulesError,
    rulesLoading,
    safetySettingsTab,
    saveServerIcon,
    selectedRoleId,
    serverIconEditor,
    serverIconInputRef,
    serverRoles,
    serverRules,
    serverSettingsDescription,
    serverSettingsError,
    serverSettingsName,
    serverSettingsReturnFocusRef,
    serverSettingsTab,
    setAuditLogActionFilter,
    setCopiedInvite,
    setDeleteRoleConfirmId,
    setDeleteServerError,
    setDeleteServerInput,
    setDraggingRoleId,
    setEditingRuleId,
    setEditingRuleText,
    setNewRuleText,
    setRoleEditColor,
    setRoleEditName,
    setRulesError,
    setSafetySettingsTab,
    setServerIconEditor,
    setServerRules,
    setServerSettingsDescription,
    setServerSettingsName,
    setServerSettingsTab,
    setShowDeleteServerConfirm,
    setVisibleRoleCount,
    settingsOnboardingGuide,
    settingsServer,
    settingsServerId,
    settingsServerInviteLink,
    showServerSettings,
    timeoutEntries,
    token,
    unbanInFlightUserId,
    visibleServerRoles,
}: ServerSettingsModalProps) {
    return (
        <>
            {showServerSettings && settingsServer && (
                <div
                    className={`modal-overlay${isMobileViewport ? ' modal-overlay--compact' : ''}`}
                    onClick={handleCloseServerSettings}
                >
                    <ModalSurface returnFocusRef={serverSettingsReturnFocusRef} name={canViewReports ? 'Server Settings' : 'Server information'} className="modal modal-server-settings" onClick={(e) => e.stopPropagation()}>
                        <div className="server-settings-header">
                            <div className="server-settings-header__left">
                                {effectiveServerIconSrc ? (
                                    <img src={effectiveServerIconSrc} alt="" className="server-settings-header__icon" />
                                ) : (
                                    <div className="server-settings-header__icon server-settings-header__icon--placeholder">
                                        {settingsServer.name.charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div className="server-settings-header__text">
                                    <h2>{canViewReports ? 'Server Settings' : 'Server information'}</h2>
                                    <p className="server-settings-header__server-name" title={settingsServer.name}>{settingsServer.name}</p>
                                    <p className="server-settings-header__hint">{canViewReports ? 'Manage the server settings available to your role.' : 'View this server and its community settings.'}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="server-settings-close-btn"
                                onClick={handleCloseServerSettings}
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>

                        <div className="server-settings-body server-settings-body--with-tabs">
                            {serverSettingsError && (
                                <div className="auth-error server-settings-error" role="alert">{serverSettingsError}</div>
                            )}

                            <div className="server-settings-layout">
                                <nav className="server-settings-nav">
                                    <div className="server-settings-nav__meta">
                                        <span className="server-settings-nav__eyebrow">Server settings</span>
                                        <strong className="server-settings-nav__title" title={settingsServer.name}>{settingsServer.name}</strong>
                                    </div>
                                    <button
                                        type="button"
                                        className={`server-settings-nav__item ${
                                            serverSettingsTab === 'overview' ? 'server-settings-nav__item--active' : ''
                                        }`}
                                        onClick={() => setServerSettingsTab('overview')}
                                    >
                                        <span className="server-settings-nav__icon"><LayoutDashboard size={16} /></span>
                                        <span className="server-settings-nav__copy">
                                            <span className="server-settings-nav__label">Overview</span>
                                        </span>
                                    </button>
                                    {isOwner && (
                                        <button
                                            type="button"
                                            className={`server-settings-nav__item ${
                                                serverSettingsTab === 'roles' ? 'server-settings-nav__item--active' : ''
                                            }`}
                                            onClick={() => setServerSettingsTab('roles')}
                                        >
                                            <span className="server-settings-nav__icon"><ShieldCheck size={16} /></span>
                                            <span className="server-settings-nav__copy">
                                                <span className="server-settings-nav__label">Roles</span>
                                            </span>
                                        </button>
                                    )}
                                    {isOwner && (
                                        <button
                                            type="button"
                                            className={`server-settings-nav__item ${
                                                serverSettingsTab === 'rules' ? 'server-settings-nav__item--active' : ''
                                            }`}
                                            onClick={() => setServerSettingsTab('rules')}
                                        >
                                            <span className="server-settings-nav__icon"><ListChecks size={16} /></span>
                                            <span className="server-settings-nav__copy">
                                                <span className="server-settings-nav__label">Community</span>
                                            </span>
                                        </button>
                                    )}
                                    {canViewAuditLog && (
                                        <button
                                            type="button"
                                            className={`server-settings-nav__item ${
                                                serverSettingsTab === 'audit'
                                                    ? 'server-settings-nav__item--active'
                                                    : ''
                                            }`}
                                            onClick={() => setServerSettingsTab('audit')}
                                        >
                                            <span className="server-settings-nav__icon"><ScrollText size={16} /></span>
                                            <span className="server-settings-nav__copy">
                                                <span className="server-settings-nav__label">Audit Log</span>
                                            </span>
                                        </button>
                                    )}
                                    {canViewSafety && (
                                        <button
                                            type="button"
                                            className={
                                                serverSettingsTab === 'safety'
                                                    ? 'server-settings-nav__item server-settings-nav__item--active'
                                                    : 'server-settings-nav__item'
                                            }
                                            onClick={() => setServerSettingsTab('safety')}
                                        >
                                            <span className="server-settings-nav__icon"><ShieldAlert size={16} /></span>
                                            <span className="server-settings-nav__copy">
                                                <span className="server-settings-nav__label">Safety</span>
                                            </span>
                                        </button>
                                    )}
                                    {isOwner && (
                                        <button
                                            type="button"
                                            className={`server-settings-nav__item ${
                                                serverSettingsTab === 'danger' ? 'server-settings-nav__item--active' : ''
                                            }`}
                                            onClick={() => setServerSettingsTab('danger')}
                                        >
                                            <span className="server-settings-nav__icon"><AlertTriangle size={16} /></span>
                                            <span className="server-settings-nav__copy">
                                                <span className="server-settings-nav__label">Danger Zone</span>
                                            </span>
                                        </button>
                                    )}
                                </nav>

                                <Profiler id="ServerSettings" onRender={handleServerSettingsProfileRender}>
                                <div className="server-settings-content">
                                    <div className="server-settings-section-intro">
                                        <div className="server-settings-section-intro__icon">
                                            {serverSettingsTab === 'overview' && <LayoutDashboard size={18} />}
                                            {serverSettingsTab === 'roles' && <ShieldCheck size={18} />}
                                            {serverSettingsTab === 'rules' && <ListChecks size={18} />}
                                            {serverSettingsTab === 'audit' && <ScrollText size={18} />}
                                            {serverSettingsTab === 'safety' && <ShieldAlert size={18} />}
                                            {serverSettingsTab === 'danger' && <AlertTriangle size={18} />}
                                        </div>
                                        <div className="server-settings-section-intro__body">
                                            <div className="server-settings-section-intro__copy">
                                                <span className="server-settings-section-intro__eyebrow">
                                                    {SERVER_SETTINGS_SECTION_META[serverSettingsTab].eyebrow}
                                                </span>
                                                <h3 className="server-settings-section-intro__title">
                                                    {SERVER_SETTINGS_SECTION_META[serverSettingsTab].title}
                                                </h3>
                                            </div>
                                            <p className="server-settings-section-intro__hint">
                                                {serverSettingsTab === 'overview' && !isOwner
                                                    ? SERVER_SETTINGS_SECTION_META.overview.readOnlyHint
                                                    : SERVER_SETTINGS_SECTION_META[serverSettingsTab].hint}
                                            </p>
                                        </div>
                                    </div>
                                    {serverSettingsTab === 'overview' && (
                                        <section className="server-settings-card server-settings-card--overview">
                                            <div className="server-overview-layout">
                                                <section className="server-overview-profile">
                                                    <div className="server-overview-profile__hero">
                                                        <div className="server-overview-profile__icon">
                                                            {effectiveServerIconSrc ? (
                                                                <img
                                                                    src={effectiveServerIconSrc}
                                                                    alt={settingsServer.name}
                                                                    className="server-settings-icon-preview"
                                                                />
                                                            ) : (
                                                                <div className="server-settings-icon-placeholder">
                                                                    {settingsServer.name.charAt(0).toUpperCase()}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="server-overview-profile__copy">
                                                            <span className="server-overview-profile__eyebrow">Server profile</span>
                                                            <strong className="server-overview-profile__title">{settingsServer.name}</strong>
                                                            <span className="server-overview-profile__meta">
                                                                {isOwner ? 'Manage roles in the Roles tab' : 'Server roles are managed by the owner'}
                                                            </span>
                                                        </div>
                                                        {isOwner && (
                                                            <div className="server-overview-profile__actions">
                                                                {!serverIconEditor && (
                                                                    <>
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-secondary btn-sm"
                                                                            onClick={() => serverIconInputRef.current?.click()}
                                                                        >
                                                                            Upload image
                                                                        </button>
                                                                        {(effectiveServerIcon ?? null) && (
                                                                            <button
                                                                                type="button"
                                                                                className="btn btn-secondary btn-sm"
                                                                                onClick={handleClearServerIcon}
                                                                            >
                                                                                Remove
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-primary btn-sm"
                                                                            disabled={!canSaveServerSettings}
                                                                            onClick={() => void handleUpdateServerSettings()}
                                                                        >
                                                                            Save changes
                                                                        </button>
                                                                    </>
                                                                )}
                                                                <input
                                                                    ref={serverIconInputRef}
                                                                    type="file"
                                                                    accept="image/*"
                                                                    style={{ display: 'none' }}
                                                                    onChange={(e) => {
                                                                        handleServerIconPick(e.target.files)
                                                                        e.currentTarget.value = ''
                                                                    }}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                    {isOwner && serverIconEditor && (
                                                        <ProfileAvatarEditor
                                                            key={serverIconEditor.key}
                                                            file={serverIconEditor.file}
                                                            shape="rounded-square"
                                                            onChooseAnother={() => serverIconInputRef.current?.click()}
                                                            onCancel={() => setServerIconEditor(null)}
                                                            onSave={saveServerIcon}
                                                        />
                                                    )}

                                                    {isOwner ? (
                                                        <div className="server-overview-profile__form">
                                                            <div className="form-group">
                                                                <label htmlFor="server-settings-modal-server-name">Server name</label>
                                                                <input id="server-settings-modal-server-name"
                                                                    type="text"
                                                                    value={serverSettingsName}
                                                                    onChange={(e) => setServerSettingsName(e.target.value)}
                                                                    placeholder="Server name"
                                                                    maxLength={SERVER_NAME_MAX}
                                                                    aria-describedby="server-settings-modal-server-name-count"
                                                                />
                                                                <div id="server-settings-modal-server-name-count" className="form-field-counter">
                                                                    {Array.from(serverSettingsName).length}/{SERVER_NAME_MAX}
                                                                </div>
                                                            </div>
                                                            <div className="form-group">
                                                                <label htmlFor="server-settings-modal-description">Description</label>
                                                                <input id="server-settings-modal-description"
                                                                    type="text"
                                                                    value={serverSettingsDescription}
                                                                    onChange={(e) => setServerSettingsDescription(e.target.value)}
                                                                    placeholder="What's this server about?"
                                                                    maxLength={500}
                                                                />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        // Members who can only view settings see plain text instead of disabled inputs that look editable.
                                                        <dl className="server-overview-profile__form server-overview-profile__details">
                                                            <div className="form-group">
                                                                <dt className="form-label">Server name</dt>
                                                                <dd className="server-overview-profile__value">{serverSettingsName}</dd>
                                                            </div>
                                                            <div className="form-group">
                                                                <dt className="form-label">Description</dt>
                                                                <dd className={`server-overview-profile__value${serverSettingsDescription.trim() ? '' : ' is-empty'}`}>
                                                                    {serverSettingsDescription.trim() || 'No description yet.'}
                                                                </dd>
                                                            </div>
                                                        </dl>
                                                    )}
                                                </section>

                                                <aside className="server-overview-invite">
                                                    <div className="server-overview-invite__head">
                                                        <span className="server-overview-invite__eyebrow">Invite</span>
                                                        <p className="server-overview-invite__hint">
                                                            Share the invite link below. Short codes still work if someone needs one.
                                                        </p>
                                                    </div>
                                                    <div className="server-overview-invite__body">
                                                        <div className="invite-unified-row invite-unified-link">
                                                            <code>{settingsServerInviteLink}</code>
                                                        </div>
                                                        <div className="invite-unified-actions">
                                                            <button
                                                                type="button"
                                                                className="copy-btn"
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(settingsServerInviteLink).then(() => {
                                                                        setCopiedInvite('link')
                                                                        setTimeout(() => setCopiedInvite(null), 2000)
                                                                    }).catch(() => {
                                                                        pushToast({
                                                                            level: 'error',
                                                                            title: 'Copy failed',
                                                                            message: 'Could not copy the invite link to your clipboard.',
                                                                        })
                                                                    })
                                                                }}
                                                            >
                                                                {copiedInvite === 'link' ? 'Copied' : 'Copy link'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="copy-btn"
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(settingsServer.invite_code).then(() => {
                                                                        setCopiedInvite('code')
                                                                        setTimeout(() => setCopiedInvite(null), 2000)
                                                                    }).catch(() => {
                                                                        pushToast({
                                                                            level: 'error',
                                                                            title: 'Copy failed',
                                                                            message: 'Could not copy the invite code to your clipboard.',
                                                                        })
                                                                    })
                                                                }}
                                                            >
                                                                {copiedInvite === 'code' ? 'Copied' : 'Copy short code'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </aside>
                                            </div>
                                        </section>
                                    )}

                                    {serverSettingsTab === 'danger' && isOwner && (
                                        <section className="server-settings-card server-settings-card--danger">
                                            <h3 className="server-settings-card__title server-settings-card__title--danger">Delete server</h3>
                                            <div className="server-settings-panel-copy">
                                                <p className="server-settings-danger-text">
                                                    Deleting this server will permanently remove all channels, invites, and messages.
                                                    This action cannot be undone.
                                                </p>
                                                <div className="server-settings-danger-actions">
                                                    <button
                                                        type="button"
                                                        className="btn btn-danger-outline"
                                                        onClick={() => {
                                                            setDeleteServerError(null)
                                                            setDeleteServerInput('')
                                                            setShowDeleteServerConfirm(true)
                                                        }}
                                                    >
                                                        Delete server
                                                    </button>
                                                </div>
                                            </div>
                                        </section>
                                    )}

                                    {serverSettingsTab === 'audit' && canViewAuditLog && (
                                        <section className="server-settings-card server-settings-card--audit server-settings-card--stack server-settings-card--list-section">
                                            {auditLogError && (
                                                <div className="auth-error" role="alert" style={{ marginBottom: 12 }}>
                                                    {auditLogError}
                                                </div>
                                            )}
                                            {auditLogLoading && (
                                                <div className="server-settings-empty-state">
                                                    Loading audit log…
                                                </div>
                                            )}
                                            {!auditLogLoading && auditLogEntries && (
                                                <ServerSettingsAuditLog
                                                    entries={auditLogEntries}
                                                    memberUsernameById={memberUsernameById}
                                                    actionFilter={auditLogActionFilter}
                                                    onActionFilterChange={setAuditLogActionFilter}
                                                    hasMore={auditLogNextBefore !== null}
                                                    loadingMore={auditLogLoadingMore}
                                                    onLoadMore={() => void loadOlderAuditLog()}
                                                />
                                            )}
                                        </section>
                                    )}

                                    {serverSettingsTab === 'safety' && canViewSafety && (
                                        <ServerSettingsSafety
                                            activeTab={safetySettingsTab}
                                            onTabChange={setSafetySettingsTab}
                                            serverId={settingsServerId}
                                            token={token}
                                            canViewReports={canViewReports}
                                            canManageAutoMod={canManageAutoMod}
                                            canManageBans={isOwner || canManageBans}
                                            reportEntries={reportEntries}
                                            reportEntriesLoading={reportEntriesLoading}
                                            reportEntriesError={reportEntriesError}
                                            resolveReportInFlightId={resolveReportInFlightId}
                                            timeoutEntries={timeoutEntries}
                                            raidEventEntries={raidEventEntries}
                                            clearTimeoutInFlightUserId={clearTimeoutInFlightUserId}
                                            banEntries={banEntries}
                                            banEntriesLoading={banEntriesLoading}
                                            banEntriesError={banEntriesError}
                                            unbanInFlightUserId={unbanInFlightUserId}
                                            onResolveReport={handleResolveSafetyReport}
                                            onClearTimeout={handleClearSafetyTimeout}
                                            onUnban={handleUnbanSafetyMember}
                                        />
                                    )}
                                    {serverSettingsTab === 'roles' && isOwner && (
                                        <section className="server-settings-card server-settings-card--roles">
                                            {rolesError && (
                                                <div className="auth-error" role="alert" style={{ marginBottom: 12 }}>
                                                    {rolesError}
                                                </div>
                                            )}
                                            <div className="server-roles-layout">
                                                <aside className="server-roles-sidebar-shell">
                                                    <div className="server-roles-toolbar">
                                                        <div className="server-roles-toolbar__copy">
                                                            <span className="server-roles-toolbar__eyebrow">Roles</span>
                                                            <strong className="server-roles-toolbar__title">{serverRoles.length} {serverRoles.length === 1 ? 'role' : 'roles'}</strong>
                                                            <span className="server-roles-toolbar__hint">
                                                                Create, reorder, and fine-tune access without leaving the editor.
                                                            </span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="btn btn-primary btn-sm"
                                                            disabled={rolesLoading}
                                                            onClick={handleCreateRoleDraft}
                                                        >
                                                            Create role
                                                        </button>
                                                    </div>
                                                    <ServerRolesSidebar
                                                        rolesLoading={rolesLoading}
                                                        selectedRoleId={selectedRoleId}
                                                        serverRoles={serverRoles}
                                                        visibleServerRoles={visibleServerRoles}
                                                        hasMoreServerRoles={hasMoreServerRoles}
                                                        onRoleDragStart={setDraggingRoleId}
                                                        onRoleDrop={handleDropRole}
                                                        onRoleSelect={handleSelectRole}
                                                        onLoadMoreRoles={() => setVisibleRoleCount((prev) => prev + 40)}
                                                    />
                                                </aside>
                                                <div className="server-roles-detail server-roles-detail-shell">
                                                    <ServerRoleEditor
                                                        selectedRoleId={selectedRoleId}
                                                        roleEditName={roleEditName}
                                                        roleEditColor={roleEditColor}
                                                        roleEditPermissions={roleEditPermissions}
                                                        bits={{
                                                            manageServer: PERM_MANAGE_SERVER,
                                                            manageRoles: PERM_MANAGE_ROLES,
                                                            manageChannels: PERM_MANAGE_CHANNELS,
                                                            viewAuditLog: PERM_VIEW_AUDIT_LOG,
                                                            manageMessages: PERM_MANAGE_MESSAGES,
                                                            managePins: PERM_MANAGE_PINS,
                                                            muteMembers: PERM_MUTE_MEMBERS,
                                                            deafenMembers: PERM_DEAFEN_MEMBERS,
                                                            moveMembers: PERM_MOVE_MEMBERS,
                                                            kickMembers: PERM_KICK_MEMBERS,
                                                            banMembers: PERM_BAN_MEMBERS,
                                                        }}
                                                        onRoleNameChange={setRoleEditName}
                                                        onRoleColorChange={setRoleEditColor}
                                                        onTogglePermission={handleToggleRolePermission}
                                                    />
                                                    {selectedRoleId && (
                                                        <div className="server-role-editor-footer">
                                                            <div className="server-role-editor-actions">
                                                                {serverRoles.some((r) => r.id === selectedRoleId) && (
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-danger-outline btn-sm server-role-editor-action-btn"
                                                                    onClick={() => {
                                                                        if (!selectedRoleId) return
                                                                        setDeleteRoleConfirmId(selectedRoleId)
                                                                    }}
                                                                >
                                                                    Delete role
                                                                </button>
                                                                )}
                                                                <div className="server-role-editor-actions-right">
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-secondary btn-sm server-role-btn-cancel server-role-editor-action-btn"
                                                                        onClick={handleCancelRoleEdit}
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-primary btn-sm server-role-btn-save server-role-editor-action-btn"
                                                                        disabled={!roleEditName.trim() || rolesLoading || !settingsServer}
                                                                        onClick={() => void handleSaveRole()}
                                                                    >
                                                                        {serverRoles.find((r) => r.id === selectedRoleId) ? 'Save role' : 'Create role'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </section>
                                    )}

                                    {serverSettingsTab === 'rules' && isOwner && (
                                        <ServerSettingsCommunity
                                            serverId={settingsServerId}
                                            token={token}
                                            channels={channels}
                                            guide={settingsOnboardingGuide}
                                            onboardingLoading={onboardingLoading}
                                            onboardingSaving={onboardingSaving}
                                            onboardingError={onboardingError}
                                            rules={serverRules}
                                            rulesLoading={rulesLoading}
                                            rulesError={rulesError}
                                            newRuleText={newRuleText}
                                            editingRuleId={editingRuleId}
                                            editingRuleText={editingRuleText}
                                            onSaveGuide={handleSaveOnboardingGuide}
                                            onRulesChange={setServerRules}
                                            onRulesError={setRulesError}
                                            onNewRuleTextChange={setNewRuleText}
                                            onEditingRuleIdChange={setEditingRuleId}
                                            onEditingRuleTextChange={setEditingRuleText}
                                        />
                                    )}
                                </div>
                                </Profiler>
                            </div>
                        </div>

                        {/* Footer removed; Overview card now owns its own Save button when needed. */}
                    </ModalSurface>
                </div>
            )}
        </>
    )
}
