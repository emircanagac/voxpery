import type { Server } from '../types'
import { type FormEvent, type RefObject, type Dispatch, type SetStateAction } from 'react'
import { serverApi, channelApi, type Channel, type ServerRole } from '../api'
import ChannelSettingsModal from '../components/ChannelSettingsModal'
import ModalSurface from '../components/ModalSurface'
import CategoryPermissionsModal from '../components/CategoryPermissionsModal'
import { CATEGORY_NAME_MAX, REPORT_REASONS } from './appLayoutModel'

export interface ServerConfirmDialogsProps {
    activeServerId: string | null
    actuallyCloseServerSettings: () => void
    categoryPermissionsTarget: string | null
    channelDialogReturnFocusRef: RefObject<HTMLElement | null>
    channelSettingsTarget: Channel | null
    channels: Channel[]
    closeReportDialog: () => void
    deleteCategoryConfirm: string | null
    deleteCategoryError: string | null
    deleteChannelConfirm: Channel | null
    deleteMessageConfirmId: string | null
    deleteRoleConfirmId: string | null
    deleteServerError: string | null
    deleteServerInput: string
    handleDeleteChannel: (channel: Channel) => Promise<void>
    handleDeleteMessage: (messageId: string) => Promise<void>
    handleDeleteServer: () => Promise<void>
    handleRenameCategory: (e: FormEvent) => Promise<void>
    handleSubmitReport: () => Promise<void>
    isActiveServerOwner: boolean
    isLoggedIn: boolean
    renameCategoryError: string | null
    renameCategoryName: string
    reportDetails: string
    reportReason: "spam" | "harassment" | "inappropriate_content" | "impersonation" | "other"
    reportSubmitting: boolean
    reportTarget: { kind: "user" | "message"; userId: string; username: string; messageId?: string; messageContent?: string; } | null
    resolveDeleteCategoryMoveTarget: (categoryName: string) => string
    serverRoles: ServerRole[]
    serverSettingsReturnFocusRef: RefObject<HTMLElement | null>
    setCategoryPermissionsTarget: Dispatch<SetStateAction<string | null>>
    setChannelCategoriesForServer: (serverId: string, categories: string[]) => void
    setChannelSettingsTarget: Dispatch<SetStateAction<Channel | null>>
    setChannels: (channels: Channel[]) => void
    setChannelsForServer: (serverId: string, channels: Channel[]) => void
    setDeleteCategoryConfirm: Dispatch<SetStateAction<string | null>>
    setDeleteCategoryError: Dispatch<SetStateAction<string | null>>
    setDeleteChannelConfirm: Dispatch<SetStateAction<Channel | null>>
    setDeleteMessageConfirmId: Dispatch<SetStateAction<string | null>>
    setDeleteRoleConfirmId: Dispatch<SetStateAction<string | null>>
    setDeleteServerError: Dispatch<SetStateAction<string | null>>
    setDeleteServerInput: Dispatch<SetStateAction<string>>
    setRenameCategoryError: Dispatch<SetStateAction<string | null>>
    setRenameCategoryFrom: Dispatch<SetStateAction<string | null>>
    setRenameCategoryName: Dispatch<SetStateAction<string>>
    setReportDetails: Dispatch<SetStateAction<string>>
    setReportReason: Dispatch<SetStateAction<"spam" | "harassment" | "inappropriate_content" | "impersonation" | "other">>
    setRoleEditName: Dispatch<SetStateAction<string>>
    setRoleEditPermissions: Dispatch<SetStateAction<number>>
    setRoleEditPreAdminPermissions: Dispatch<SetStateAction<number | null>>
    setRolesError: Dispatch<SetStateAction<string | null>>
    setSelectedRoleId: Dispatch<SetStateAction<string | null>>
    setServerRoles: Dispatch<SetStateAction<ServerRole[]>>
    setShowDeleteServerConfirm: Dispatch<SetStateAction<boolean>>
    setShowRenameCategory: Dispatch<SetStateAction<boolean>>
    setShowUnsavedServerSettingsConfirm: Dispatch<SetStateAction<boolean>>
    settingsServer: Server | undefined
    showDeleteServerConfirm: boolean
    showRenameCategory: boolean
    showUnsavedServerSettingsConfirm: boolean
    token: string | null
}

/** Moved unchanged out of AppLayout.tsx. */
export default function ServerConfirmDialogs({
    activeServerId,
    actuallyCloseServerSettings,
    categoryPermissionsTarget,
    channelDialogReturnFocusRef,
    channelSettingsTarget,
    channels,
    closeReportDialog,
    deleteCategoryConfirm,
    deleteCategoryError,
    deleteChannelConfirm,
    deleteMessageConfirmId,
    deleteRoleConfirmId,
    deleteServerError,
    deleteServerInput,
    handleDeleteChannel,
    handleDeleteMessage,
    handleDeleteServer,
    handleRenameCategory,
    handleSubmitReport,
    isActiveServerOwner,
    isLoggedIn,
    renameCategoryError,
    renameCategoryName,
    reportDetails,
    reportReason,
    reportSubmitting,
    reportTarget,
    resolveDeleteCategoryMoveTarget,
    serverRoles,
    serverSettingsReturnFocusRef,
    setCategoryPermissionsTarget,
    setChannelCategoriesForServer,
    setChannelSettingsTarget,
    setChannels,
    setChannelsForServer,
    setDeleteCategoryConfirm,
    setDeleteCategoryError,
    setDeleteChannelConfirm,
    setDeleteMessageConfirmId,
    setDeleteRoleConfirmId,
    setDeleteServerError,
    setDeleteServerInput,
    setRenameCategoryError,
    setRenameCategoryFrom,
    setRenameCategoryName,
    setReportDetails,
    setReportReason,
    setRoleEditName,
    setRoleEditPermissions,
    setRoleEditPreAdminPermissions,
    setRolesError,
    setSelectedRoleId,
    setServerRoles,
    setShowDeleteServerConfirm,
    setShowRenameCategory,
    setShowUnsavedServerSettingsConfirm,
    settingsServer,
    showDeleteServerConfirm,
    showRenameCategory,
    showUnsavedServerSettingsConfirm,
    token,
}: ServerConfirmDialogsProps) {
    return (
        <>
            {showUnsavedServerSettingsConfirm && (
                <div className="modal-overlay" onClick={() => setShowUnsavedServerSettingsConfirm(false)}>
                    <ModalSurface returnFocusRef={serverSettingsReturnFocusRef} name="Discard changes?" className="modal confirm-modal server-delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Discard changes?</h2>
                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                            You have unsaved changes to the server name or icon. If you close now, those changes will be
                            lost.
                        </p>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setShowUnsavedServerSettingsConfirm(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => {
                                    setShowUnsavedServerSettingsConfirm(false)
                                    actuallyCloseServerSettings()
                                }}
                            >
                                Discard changes
                            </button>
                        </div>
                    </ModalSurface>
                </div>
            )}
            {deleteRoleConfirmId && settingsServer && (
                <div className="modal-overlay" onClick={() => setDeleteRoleConfirmId(null)}>
                    <ModalSurface name="Delete role" className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Delete role</h2>
                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                            Are you sure you want to delete this role? This cannot be undone.
                        </p>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setDeleteRoleConfirmId(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={async () => {
                                    if (!isLoggedIn || !deleteRoleConfirmId) return
                                    setRolesError(null)
                                    try {
                                        await serverApi.deleteRole(settingsServer.id, deleteRoleConfirmId, token)
                                        const roles = await serverApi.listRoles(settingsServer.id, token)
                                        setServerRoles(roles)
                                        const next = roles[0]
                                        setSelectedRoleId(next?.id ?? null)
                                        setRoleEditName(next?.name ?? '')
                                        setRoleEditPermissions(next?.permissions ?? 0)
                                        setRoleEditPreAdminPermissions(null)
                                        setDeleteRoleConfirmId(null)
                                    } catch (err) {
                                        const message =
                                            err instanceof Error
                                                ? err.message
                                                : 'Failed to delete role.'
                                        setRolesError(message)
                                        setDeleteRoleConfirmId(null)
                                    }
                                }}
                            >
                                Delete
                            </button>
                        </div>
                    </ModalSurface>
                </div>
            )}
            {reportTarget && (
                <div className="modal-overlay" onClick={closeReportDialog}>
                    <ModalSurface name={reportTarget.kind === 'message' ? 'Report message' : 'Report user'} className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>{reportTarget.kind === 'message' ? 'Report message' : 'Report user'}</h2>
                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                            {reportTarget.kind === 'message'
                                ? <>Report <strong>{reportTarget.username}</strong>&rsquo;s message to the server moderators.</>
                                : <>Report <strong>{reportTarget.username}</strong> to the server moderators.</>}
                        </p>
                        {reportTarget.kind === 'message' && reportTarget.messageContent && (
                            <div className="server-report-excerpt" style={{ marginBottom: 16 }}>
                                “{reportTarget.messageContent.length > 220 ? `${reportTarget.messageContent.slice(0, 220)}...` : reportTarget.messageContent}”
                            </div>
                        )}
                        <div className="form-group">
                            <label>Reason</label>
                            <select
                                value={reportReason}
                                onChange={(e) => setReportReason(e.target.value as (typeof REPORT_REASONS)[number]['value'])}
                                disabled={reportSubmitting}
                            >
                                {REPORT_REASONS.map((reason) => (
                                    <option key={reason.value} value={reason.value}>
                                        {reason.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Extra details (optional)</label>
                            <textarea
                                value={reportDetails}
                                onChange={(e) => setReportDetails(e.target.value)}
                                rows={4}
                                maxLength={500}
                                placeholder="Add a short note to help moderators understand the issue."
                                disabled={reportSubmitting}
                            />
                        </div>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={closeReportDialog} disabled={reportSubmitting}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn-primary" onClick={() => void handleSubmitReport()} disabled={reportSubmitting}>
                                {reportSubmitting ? 'Submitting...' : 'Submit report'}
                            </button>
                        </div>
                    </ModalSurface>
                </div>
            )}
            {deleteMessageConfirmId && (
                <div className="modal-overlay" onClick={() => setDeleteMessageConfirmId(null)}>
                    <ModalSurface name="Delete message" className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Delete message</h2>
                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                            Are you sure you want to delete this message?
                        </p>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setDeleteMessageConfirmId(null)}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn-danger" onClick={() => void handleDeleteMessage(deleteMessageConfirmId)}>
                                Delete
                            </button>
                        </div>
                    </ModalSurface>
                </div>
            )}
            {deleteChannelConfirm && (
                <div className="modal-overlay" onClick={() => setDeleteChannelConfirm(null)}>
                    <ModalSurface name="Delete channel" className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Delete channel</h2>
                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                            Are you sure you want to permanently delete <strong>#{deleteChannelConfirm.name}</strong>?
                        </p>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setDeleteChannelConfirm(null)}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn-danger" onClick={() => void handleDeleteChannel(deleteChannelConfirm)}>
                                Delete
                            </button>
                        </div>
                    </ModalSurface>
                </div>
            )}
            {showDeleteServerConfirm && settingsServer && (
                <div className="modal-overlay" onClick={() => { setShowDeleteServerConfirm(false); setDeleteServerError(null) }}>
                    <ModalSurface name="Delete Server" className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Delete Server</h2>
                        <p style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>
                            Type <strong>{settingsServer.name}</strong> to confirm permanent deletion.
                        </p>
                        {deleteServerError && (
                            <div className="auth-error" style={{ marginBottom: 12 }}>{deleteServerError}</div>
                        )}
                        <div className="form-group">
                            <label>Server Name</label>
                            <input
                                type="text"
                                value={deleteServerInput}
                                onChange={(e) => setDeleteServerInput(e.target.value)}
                                placeholder={settingsServer.name}
                            />
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => { setShowDeleteServerConfirm(false); setDeleteServerError(null) }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => void handleDeleteServer()}
                            >
                                Delete Server
                            </button>
                        </div>
                    </ModalSurface>
                </div>
            )}
            {channelSettingsTarget && (
                <ChannelSettingsModal
                    channel={channelSettingsTarget}
                    serverRoles={serverRoles}
                    canManagePermissions={isActiveServerOwner}
                    initialTab="permissions"
                    onClose={() => setChannelSettingsTarget(null)}
                    onUpdated={async (updated: Channel) => {
                        setChannels(channels.map(c => c.id === updated.id ? updated : c))
                        if (activeServerId) {
                            const categories = await channelApi.listCategories(activeServerId, token).catch(() => [])
                            setChannelCategoriesForServer(activeServerId, categories.map((c) => c.name))
                        }
                    }}
                    onDeleted={async (id: string) => {
                        setChannels(channels.filter(c => c.id !== id))
                        if (activeServerId) {
                            const categories = await channelApi.listCategories(activeServerId, token).catch(() => [])
                            setChannelCategoriesForServer(activeServerId, categories.map((c) => c.name))
                        }
                    }}
                />
            )}

            {/* Rename Category Modal */}
            {showRenameCategory && (
                <div className="modal-overlay" onClick={() => { setShowRenameCategory(false); setRenameCategoryError(null); setRenameCategoryFrom(null) }}>
                    <ModalSurface returnFocusRef={channelDialogReturnFocusRef} as="form" name="Rename Category" className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleRenameCategory}>
                        <h2>Rename Category</h2>
                        {renameCategoryError && (
                            <div className="auth-error" style={{ marginBottom: 16 }}>{renameCategoryError}</div>
                        )}
                        <div className="form-group">
                            <label>Category Name</label>
                            <input
                                type="text"
                                value={renameCategoryName}
                                onChange={(e) => setRenameCategoryName(e.target.value)}
                                placeholder="new-category-name"
                                required
                                maxLength={CATEGORY_NAME_MAX}
                            />
                        </div>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => { setShowRenameCategory(false); setRenameCategoryError(null); setRenameCategoryFrom(null) }}>Cancel</button>
                            <button type="submit" className="btn btn-primary">Save</button>
                        </div>
                    </ModalSurface>
                </div>
            )}
            {categoryPermissionsTarget && activeServerId && (
                <CategoryPermissionsModal
                    serverId={activeServerId}
                    category={categoryPermissionsTarget}
                    serverRoles={serverRoles}
                    onClose={() => setCategoryPermissionsTarget(null)}
                />
            )}
            {deleteCategoryConfirm && activeServerId && (
                <div className="modal-overlay" onClick={() => setDeleteCategoryConfirm(null)}>
                    <ModalSurface name="Delete category" className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Delete category</h2>
                        {(() => {
                            const moveTarget = resolveDeleteCategoryMoveTarget(deleteCategoryConfirm)
                            const channelsInCategory = channels.filter(
                                (c) => (c.category ?? 'Channels') === deleteCategoryConfirm,
                            ).length
                            return channelsInCategory > 0 ? (
                                <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                                    Channels in <strong>{deleteCategoryConfirm}</strong> will be moved to <strong>{moveTarget}</strong>.
                                </p>
                            ) : (
                                <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                                    <strong>{deleteCategoryConfirm}</strong> is empty.
                                </p>
                            )
                        })()}
                        {deleteCategoryError && (
                            <div className="auth-error" style={{ marginBottom: 10 }}>{deleteCategoryError}</div>
                        )}
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setDeleteCategoryConfirm(null)}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={async () => {
                                    try {
                                        const moveTarget = resolveDeleteCategoryMoveTarget(deleteCategoryConfirm)
                                        await channelApi.deleteCategory(
                                            activeServerId,
                                            deleteCategoryConfirm,
                                            token,
                                            moveTarget,
                                        )
                                        const [chs, categories] = await Promise.all([
                                            serverApi.channels(activeServerId, token),
                                            channelApi.listCategories(activeServerId, token).catch(() => []),
                                        ])
                                        setChannels(chs)
                                        setChannelsForServer(activeServerId, chs)
                                        setChannelCategoriesForServer(activeServerId, categories.map((c) => c.name))
                                        setDeleteCategoryConfirm(null)
                                        setDeleteCategoryError(null)
                                    } catch (err: unknown) {
                                        setDeleteCategoryError(err instanceof Error ? err.message : 'Failed to delete category.')
                                    }
                                }}
                            >
                                Delete Category
                            </button>
                        </div>
                    </ModalSurface>
                </div>
            )}
        </>
    )
}
