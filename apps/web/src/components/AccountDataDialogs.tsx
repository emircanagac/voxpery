import { isValidEmailAddress } from './accountValidation'
import type { User } from '../types'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { Lock, Download, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'

export interface AccountDataDialogsProps {
  closeDeleteModal: () => void
  closeEmailModal: () => void
  closeExportModal: () => void
  deleteConfirm: string
  deleteError: string | null
  deleteModalRef: RefObject<HTMLDivElement | null>
  deleteNeedsGoogleSignIn: boolean
  deletePassword: string
  deleteSubmitting: boolean
  emailEdit: string
  emailError: string | null
  emailModalRef: RefObject<HTMLDivElement | null>
  emailNeedsGoogleSignIn: boolean
  emailPassword: string
  emailSaving: boolean
  exportError: string | null
  exportModalRef: RefObject<HTMLDivElement | null>
  exportMyData: () => Promise<void>
  exportPassword: string
  exportingData: boolean
  isGoogleOnlyAccount: boolean
  reauthenticateGoogleForExport: () => Promise<void>
  setDeleteConfirm: Dispatch<SetStateAction<string>>
  setDeletePassword: Dispatch<SetStateAction<string>>
  setEmailEdit: Dispatch<SetStateAction<string>>
  setEmailError: Dispatch<SetStateAction<string | null>>
  setEmailPassword: Dispatch<SetStateAction<string>>
  setExportPassword: Dispatch<SetStateAction<string>>
  showDeleteModal: boolean
  showEmailModal: boolean
  showExportModal: boolean
  submitDeleteAccount: () => Promise<void>
  submitEmailChange: () => Promise<void>
  user: User | null
}

/** Moved unchanged out of UserBar.tsx. */
export default function AccountDataDialogs({
  closeDeleteModal,
  closeEmailModal,
  closeExportModal,
  deleteConfirm,
  deleteError,
  deleteModalRef,
  deleteNeedsGoogleSignIn,
  deletePassword,
  deleteSubmitting,
  emailEdit,
  emailError,
  emailModalRef,
  emailNeedsGoogleSignIn,
  emailPassword,
  emailSaving,
  exportError,
  exportModalRef,
  exportMyData,
  exportPassword,
  exportingData,
  isGoogleOnlyAccount,
  reauthenticateGoogleForExport,
  setDeleteConfirm,
  setDeletePassword,
  setEmailEdit,
  setEmailError,
  setEmailPassword,
  setExportPassword,
  showDeleteModal,
  showEmailModal,
  showExportModal,
  submitDeleteAccount,
  submitEmailChange,
  user,
}: AccountDataDialogsProps) {
  return (
    <>
      {showExportModal && typeof document !== 'undefined' && createPortal((
        <div className="modal-overlay" onClick={closeExportModal}>
          <div ref={exportModalRef} className="modal pw-modal data-export-modal" role="dialog" aria-modal="true" aria-labelledby="data-export-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
            <header className="pw-modal-header">
              <Download size={20} className="pw-modal-icon" />
              <h2 id="data-export-title">Create data export</h2>
              <p className="pw-modal-subtitle">
                This ZIP can contain private messages and files. It is not encrypted; store it securely and delete it when no longer needed.
              </p>
            </header>
            <div className="pw-change-form">
              {isGoogleOnlyAccount ? (
                <p className="user-setting-desc">
                  A Google sign-in from the last 10 minutes is required. If this request is rejected, re-authenticate and try once more.
                </p>
              ) : (
                <div className="pw-field-wrap">
                  <label className="user-setting-title" htmlFor="export-password">Current password</label>
                  <div className="pw-input-wrap">
                    <Lock size={14} className="pw-input-icon" />
                    <input
                      id="export-password"
                      type="password"
                      className="pw-input"
                      value={exportPassword}
                      onChange={(event) => setExportPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                </div>
              )}
              <p className="user-setting-desc">
                For a complete KVKK/GDPR access request, follow the formal request process in the Privacy Notice.
              </p>
              {exportError && <div className="pw-error">{exportError}</div>}
            </div>
            <footer className="pw-modal-footer">
              <button type="button" className="btn btn-secondary" onClick={closeExportModal}>
                Cancel
              </button>
              {isGoogleOnlyAccount && exportError && (
                <button type="button" className="btn btn-secondary" onClick={() => void reauthenticateGoogleForExport()}>
                  Sign in with Google
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={exportingData || (!isGoogleOnlyAccount && !exportPassword.trim())}
                onClick={() => void exportMyData()}
              >
                {exportingData ? 'Creating…' : 'Download ZIP'}
              </button>
            </footer>
          </div>
        </div>
      ), document.body)}
      {showDeleteModal && typeof document !== 'undefined' && createPortal((
        <div className="modal-overlay" onClick={closeDeleteModal}>
          <div ref={deleteModalRef} className="modal pw-modal delete-account-modal" role="dialog" aria-modal="true" aria-labelledby="delete-account-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <header className="pw-modal-header">
              <Trash2 size={20} className="pw-modal-icon" />
              <h2 id="delete-account-title">Delete account</h2>
              <p className="pw-modal-subtitle delete-account-danger-note">
                This action permanently deletes your account. This cannot be undone.
              </p>
            </header>
            <div className="pw-change-form">
              <div className="pw-field-wrap">
                <label className="user-setting-title" htmlFor="delete-password">Current password</label>
                <div className="pw-input-wrap delete-account-input-wrap">
                  <Lock size={14} className="pw-input-icon" />
                  <input
                    id="delete-password"
                    type="password"
                    className="pw-input"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Required for password-based accounts"
                    autoComplete="current-password"
                  />
                </div>
              </div>
              <div className="pw-field-wrap">
                <label className="user-setting-title" htmlFor="delete-confirm">Type DELETE to confirm</label>
                <div className="pw-input-wrap delete-account-input-wrap">
                  <Trash2 size={14} className="pw-input-icon" />
                  <input
                    id="delete-confirm"
                    type="text"
                    className="pw-input"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                    autoComplete="off"
                  />
                </div>
                <div className={`delete-account-confirm-hint ${deleteConfirm.trim() === 'DELETE' ? 'is-valid' : ''}`}>
                  {deleteConfirm.trim() === 'DELETE' ? 'Confirmation text is valid.' : 'Type DELETE exactly to enable the action.'}
                </div>
              </div>
              {deleteError && <div className="pw-error">{deleteError}</div>}
              {deleteNeedsGoogleSignIn && (
                <button type="button" className="btn btn-secondary" onClick={() => void reauthenticateGoogleForExport()}>
                  Sign in with Google again
                </button>
              )}
            </div>
            <footer className="pw-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeDeleteModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={deleteSubmitting || deleteConfirm.trim() !== 'DELETE'}
                onClick={() => void submitDeleteAccount()}
              >
                {deleteSubmitting ? 'Processing…' : 'Delete account'}
              </button>
            </footer>
          </div>
        </div>
      ), document.body)}
      {showEmailModal && typeof document !== 'undefined' && createPortal((
        <div className="modal-overlay" onClick={() => closeEmailModal()}>
          <div ref={emailModalRef} className="modal pw-modal" role="dialog" aria-modal="true" aria-labelledby="change-email-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <header className="pw-modal-header">
              <h2 id="change-email-title">Change email</h2>
              <p className="pw-modal-subtitle">Update your sign-in email address and verify the new address.</p>
            </header>
            <div className="pw-change-form">
              <div className="pw-field-wrap">
                <label className="user-setting-title" htmlFor="email-new">Email address</label>
                <div className="pw-input-wrap">
                  <input
                    id="email-new"
                    type="email"
                    className="pw-input"
                    placeholder="name@example.com"
                    value={emailEdit}
                    onChange={(e) => {
                      setEmailEdit(e.target.value)
                      setEmailError(null)
                    }}
                    autoComplete="email"
                  />
                </div>
                {!isValidEmailAddress(emailEdit) && emailEdit.trim().length > 0 && (
                  <div className="pw-hint pw-hint-warn">Enter a valid email address</div>
                )}
              </div>
              {!isGoogleOnlyAccount && emailEdit.trim().toLowerCase() !== (user?.email ?? '').toLowerCase() && (
                <div className="pw-field-wrap">
                  <label className="user-setting-title" htmlFor="email-current-password">Current password</label>
                  <div className="pw-input-wrap">
                    <input
                      id="email-current-password"
                      type="password"
                      className="pw-input"
                      value={emailPassword}
                      onChange={(e) => {
                        setEmailPassword(e.target.value)
                        setEmailError(null)
                      }}
                      autoComplete="current-password"
                    />
                  </div>
                </div>
              )}
              {emailError && <div className="pw-error">{emailError}</div>}
              {emailNeedsGoogleSignIn && (
                <button type="button" className="btn btn-secondary" onClick={() => void reauthenticateGoogleForExport()}>
                  Sign in with Google again
                </button>
              )}
            </div>
            <footer className="pw-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => closeEmailModal()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={emailSaving || !isValidEmailAddress(emailEdit)}
                onClick={() => void submitEmailChange()}
              >
                {emailSaving ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </div>
        </div>
      ), document.body)}
    </>
  )
}
