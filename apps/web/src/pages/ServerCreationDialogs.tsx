import { type FormEvent, type RefObject, type Dispatch, type SetStateAction } from 'react'
import ModalSurface from '../components/ModalSurface'
import { MessageSquare, Mic } from 'lucide-react'
import { CHANNEL_NAME_MAX, CATEGORY_NAME_MAX, CHANNEL_DESCRIPTION_MAX, parseInviteInput } from './appLayoutModel'

export interface ServerCreationDialogsProps {
    activeServerId: string | null
    channelCategorySuggestions: string[]
    channelDialogReturnFocusRef: RefObject<HTMLElement | null>
    createCategoryError: string | null
    createCategoryName: string
    createChannelCategory: string
    createChannelDescription: string
    createChannelError: string | null
    createChannelName: string
    createChannelType: "text" | "voice"
    createServerError: string | null
    createServerRequestIdRef: RefObject<string | null>
    handleCreateCategory: (e: FormEvent) => Promise<void>
    handleCreateChannel: (e: FormEvent) => Promise<void>
    handleCreateServer: (e: FormEvent) => Promise<void>
    handleJoinServer: (e: FormEvent) => Promise<void>
    handleRenameChannel: (e: FormEvent) => Promise<void>
    inviteCode: string
    isCreatingServer: boolean
    isMobileViewport: boolean
    joinServerError: string | null
    newServerDescription: string
    newServerName: string
    renameChannelDescription: string
    renameChannelError: string | null
    renameChannelName: string
    serverDialogRef: RefObject<HTMLFormElement | null>
    setCreateCategoryError: Dispatch<SetStateAction<string | null>>
    setCreateCategoryName: Dispatch<SetStateAction<string>>
    setCreateChannelCategory: Dispatch<SetStateAction<string>>
    setCreateChannelDescription: Dispatch<SetStateAction<string>>
    setCreateChannelError: Dispatch<SetStateAction<string | null>>
    setCreateChannelName: Dispatch<SetStateAction<string>>
    setCreateChannelType: Dispatch<SetStateAction<"text" | "voice">>
    setCreateServerError: Dispatch<SetStateAction<string | null>>
    setInviteCode: Dispatch<SetStateAction<string>>
    setJoinServerError: Dispatch<SetStateAction<string | null>>
    setNewServerDescription: Dispatch<SetStateAction<string>>
    setNewServerName: Dispatch<SetStateAction<string>>
    setRenameChannelDescription: Dispatch<SetStateAction<string>>
    setRenameChannelError: Dispatch<SetStateAction<string | null>>
    setRenameChannelId: Dispatch<SetStateAction<string | null>>
    setRenameChannelName: Dispatch<SetStateAction<string>>
    setShowCreateCategory: Dispatch<SetStateAction<boolean>>
    setShowCreateChannel: Dispatch<SetStateAction<boolean>>
    setShowCreateServer: (show: boolean) => void
    setShowJoinServer: (show: boolean) => void
    setShowRenameChannel: Dispatch<SetStateAction<boolean>>
    showCreateCategory: boolean
    showCreateChannel: boolean
    showCreateServer: boolean
    showJoinServer: boolean
    showRenameChannel: boolean
}

/** Moved unchanged out of AppLayout.tsx. */
export default function ServerCreationDialogs({
    activeServerId,
    channelCategorySuggestions,
    channelDialogReturnFocusRef,
    createCategoryError,
    createCategoryName,
    createChannelCategory,
    createChannelDescription,
    createChannelError,
    createChannelName,
    createChannelType,
    createServerError,
    createServerRequestIdRef,
    handleCreateCategory,
    handleCreateChannel,
    handleCreateServer,
    handleJoinServer,
    handleRenameChannel,
    inviteCode,
    isCreatingServer,
    isMobileViewport,
    joinServerError,
    newServerDescription,
    newServerName,
    renameChannelDescription,
    renameChannelError,
    renameChannelName,
    serverDialogRef,
    setCreateCategoryError,
    setCreateCategoryName,
    setCreateChannelCategory,
    setCreateChannelDescription,
    setCreateChannelError,
    setCreateChannelName,
    setCreateChannelType,
    setCreateServerError,
    setInviteCode,
    setJoinServerError,
    setNewServerDescription,
    setNewServerName,
    setRenameChannelDescription,
    setRenameChannelError,
    setRenameChannelId,
    setRenameChannelName,
    setShowCreateCategory,
    setShowCreateChannel,
    setShowCreateServer,
    setShowJoinServer,
    setShowRenameChannel,
    showCreateCategory,
    showCreateChannel,
    showCreateServer,
    showJoinServer,
    showRenameChannel,
}: ServerCreationDialogsProps) {
    return (
        <>
            {/* Create Server Modal */}
            {showCreateServer && (
                <div
                    className={`modal-overlay${isMobileViewport ? ' modal-overlay--compact' : ''}`}
                    onClick={() => {
                        if (isCreatingServer) return
                        setShowCreateServer(false)
                        setCreateServerError(null)
                        createServerRequestIdRef.current = null
                    }}
                >
                    <form ref={serverDialogRef} className={`modal${isMobileViewport ? ' modal-compact-mobile' : ''}`} role="dialog" aria-modal="true" aria-labelledby="create-server-dialog-title" tabIndex={-1} onClick={(e) => e.stopPropagation()} onSubmit={handleCreateServer}>
                        <h2 id="create-server-dialog-title">Create a Server</h2>
                        {createServerError && (
                            <div className="auth-error" role="alert" style={{ marginBottom: 16 }}>{createServerError}</div>
                        )}
                        <div className="form-group">
                            <label htmlFor="server-creation-dialogs-server-name">Server Name</label>
                            <input id="server-creation-dialogs-server-name"
                                type="text"
                                value={newServerName}
                                onChange={(e) => {
                                    setNewServerName(e.target.value)
                                    createServerRequestIdRef.current = null
                                }}
                                placeholder="My Awesome Server"
                                autoFocus
                                disabled={isCreatingServer}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="server-creation-dialogs-description">Description <span style={{ opacity: 0.6 }}>(optional)</span></label>
                            <input id="server-creation-dialogs-description"
                                type="text"
                                value={newServerDescription}
                                onChange={(e) => {
                                    setNewServerDescription(e.target.value)
                                    createServerRequestIdRef.current = null
                                }}
                                placeholder="What's this server about?"
                                maxLength={500}
                                disabled={isCreatingServer}
                            />
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={isCreatingServer}
                                onClick={() => {
                                    if (isCreatingServer) return
                                    setShowCreateServer(false)
                                    setCreateServerError(null)
                                }}
                            >
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={isCreatingServer || !newServerName.trim()}>
                                {isCreatingServer ? 'Creating...' : 'Create'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Join Server Modal */}
            {showJoinServer && (
                <div className={`modal-overlay${isMobileViewport ? ' modal-overlay--compact' : ''}`} onClick={() => { setShowJoinServer(false); setJoinServerError(null); }}>
                    <form ref={serverDialogRef} className={`modal${isMobileViewport ? ' modal-compact-mobile' : ''}`} role="dialog" aria-modal="true" aria-labelledby="join-server-dialog-title" tabIndex={-1} onClick={(e) => e.stopPropagation()} onSubmit={handleJoinServer}>
                        <h2 id="join-server-dialog-title">Join a Server</h2>
                        {joinServerError && (
                            <div className="auth-error" role="alert" style={{ marginBottom: 16 }}>{joinServerError}</div>
                        )}
                        <div className="form-group">
                            <label htmlFor="server-creation-dialogs-invite-link-or-code">Invite link or code</label>
                            <input id="server-creation-dialogs-invite-link-or-code"
                                type="text"
                                value={inviteCode}
                                onChange={(e) => setInviteCode(e.target.value)}
                                placeholder="Paste an invite link or short code"
                                autoFocus
                                required
                            />
                            <div className="form-hint">Invite links are preferred. Short codes still work.</div>
                        </div>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => { setShowJoinServer(false); setJoinServerError(null); }}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={!parseInviteInput(inviteCode)}>Join</button>
                        </div>
                    </form>
                </div>
            )}

            {/* Create Channel Modal */}
            {showCreateChannel && activeServerId && (
                <div className="modal-overlay" onClick={() => { setShowCreateChannel(false); setCreateChannelError(null); setCreateChannelCategory(''); setCreateChannelDescription('') }}>
                    <ModalSurface returnFocusRef={channelDialogReturnFocusRef} as="form" name="Create Channel" className="modal modal-create-channel" onClick={(e) => e.stopPropagation()} onSubmit={handleCreateChannel}>
                        <h2>Create Channel</h2>
                        {createChannelError && (
                            <div className="auth-error" role="alert" style={{ marginBottom: 16 }}>{createChannelError}</div>
                        )}
                        <div className="form-group">
                            <label htmlFor="server-creation-dialogs-channel-name">Channel name</label>
                            <input id="server-creation-dialogs-channel-name"
                                type="text"
                                value={createChannelName}
                                onChange={(e) => setCreateChannelName(e.target.value)}
                                placeholder="e.g. general"
                                required
                                maxLength={CHANNEL_NAME_MAX}
                            />
                        </div>
                        <div className="form-group">
                            <label id="create-channel-type-label">Channel type</label>
                            <div className="channel-type-selector" role="group" aria-labelledby="create-channel-type-label">
                                <button
                                    type="button"
                                    className={`channel-type-option ${createChannelType === 'text' ? 'channel-type-option--selected' : ''}`}
                                    aria-pressed={createChannelType === 'text'}
                                    onClick={() => setCreateChannelType('text')}
                                >
                                    <MessageSquare size={24} strokeWidth={1.8} />
                                    <span className="channel-type-option__label">Text</span>
                                    <span className="channel-type-option__desc">Chat and share files</span>
                                </button>
                                <button
                                    type="button"
                                    className={`channel-type-option ${createChannelType === 'voice' ? 'channel-type-option--selected' : ''}`}
                                    aria-pressed={createChannelType === 'voice'}
                                    onClick={() => setCreateChannelType('voice')}
                                >
                                    <Mic size={24} strokeWidth={1.8} />
                                    <span className="channel-type-option__label">Voice</span>
                                    <span className="channel-type-option__desc">Talk with voice</span>
                                </button>
                            </div>
                        </div>
                        <div className="form-group">
                            <label htmlFor="server-creation-dialogs-category">Category (optional, default: GENERAL)</label>
                            <input id="server-creation-dialogs-category"
                                type="text"
                                value={createChannelCategory}
                                onChange={(e) => setCreateChannelCategory(e.target.value)}
                                placeholder="GENERAL"
                                list="channel-category-suggestions"
                                maxLength={CATEGORY_NAME_MAX}
                            />
                            <datalist id="channel-category-suggestions">
                                {channelCategorySuggestions.map((category) => (
                                    <option key={category} value={category} />
                                ))}
                                </datalist>
                            </div>
                            <div className="form-group">
                                <label htmlFor="server-creation-dialogs-description-2">Description (optional)</label>
                                <textarea id="server-creation-dialogs-description-2"
                                    value={createChannelDescription}
                                    onChange={(e) => setCreateChannelDescription(e.target.value)}
                                    placeholder="What is this channel for?"
                                    maxLength={CHANNEL_DESCRIPTION_MAX}
                                    rows={3}
                                />
                            </div>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => { setShowCreateChannel(false); setCreateChannelError(null); setCreateChannelCategory(''); setCreateChannelDescription('') }}>Cancel</button>
                            <button type="submit" className="btn btn-primary">Create Channel</button>
                        </div>
                    </ModalSurface>
                </div>
            )}

            {/* Create Category Modal */}
            {showCreateCategory && activeServerId && (
                <div className="modal-overlay" onClick={() => { setShowCreateCategory(false); setCreateCategoryError(null) }}>
                    <ModalSurface returnFocusRef={channelDialogReturnFocusRef} as="form" name="Create Category" className="modal modal-create-channel" onClick={(e) => e.stopPropagation()} onSubmit={handleCreateCategory}>
                        <h2>Create Category</h2>
                        {createCategoryError && (
                            <div className="auth-error" role="alert" style={{ marginBottom: 16 }}>{createCategoryError}</div>
                        )}
                        <div className="form-group">
                            <label htmlFor="server-creation-dialogs-category-name">Category name</label>
                            <input id="server-creation-dialogs-category-name"
                                type="text"
                                value={createCategoryName}
                                onChange={(e) => setCreateCategoryName(e.target.value)}
                                placeholder="e.g. Squad 1"
                                required
                                maxLength={CATEGORY_NAME_MAX}
                            />
                        </div>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => { setShowCreateCategory(false); setCreateCategoryError(null); }}>Cancel</button>
                            <button type="submit" className="btn btn-primary">Create Category</button>
                        </div>
                    </ModalSurface>
                </div>
            )}

            {/* Rename Channel Modal */}
            {showRenameChannel && (
                <div className="modal-overlay" onClick={() => { setShowRenameChannel(false); setRenameChannelError(null); setRenameChannelId(null); setRenameChannelDescription('') }}>
                    <ModalSurface returnFocusRef={channelDialogReturnFocusRef} as="form" name="Edit Channel" className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleRenameChannel}>
                        <h2>Edit Channel</h2>
                        {renameChannelError && (
                            <div className="auth-error" role="alert" style={{ marginBottom: 16 }}>{renameChannelError}</div>
                        )}
                        <div className="form-group">
                            <label htmlFor="server-creation-dialogs-channel-name-2">Channel Name</label>
                            <input id="server-creation-dialogs-channel-name-2"
                                type="text"
                                value={renameChannelName}
                                onChange={(e) => setRenameChannelName(e.target.value)}
                                placeholder="new-channel-name"
                                required
                                maxLength={CHANNEL_NAME_MAX}
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="server-creation-dialogs-description-3">Description</label>
                            <textarea id="server-creation-dialogs-description-3"
                                value={renameChannelDescription}
                                onChange={(e) => setRenameChannelDescription(e.target.value)}
                                placeholder="What is this channel for?"
                                rows={3}
                                maxLength={CHANNEL_DESCRIPTION_MAX}
                            />
                        </div>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => { setShowRenameChannel(false); setRenameChannelError(null); setRenameChannelId(null); setRenameChannelDescription('') }}>Cancel</button>
                            <button type="submit" className="btn btn-primary">Save</button>
                        </div>
                    </ModalSurface>
                </div>
            )}
        </>
    )
}
