import { hasOnlyUsernameChars, hasUsernameBoundarySeparator, hasUsernameConsecutiveSeparator, isValidUsername } from './accountValidation'
import type { UserPublic } from '../api'
import type { User } from '../types'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { createPortal } from 'react-dom'
import { authApi, getAuthErrorMessage } from '../api'
import { refreshImageProxyGrant } from '../api/imageProxyGrantRefresh'

export interface AccountCredentialDialogsProps {
  closePasswordModal: () => void
  closeUsernameModal: () => void
  handleLogout: () => void
  isGoogleOnlyAccount: boolean
  passwordModalRef: RefObject<HTMLDivElement | null>
  pwConfirm: string
  pwError: string | null
  pwNew: string
  pwOld: string
  pwSaving: boolean
  pwShowNew: boolean
  pwShowOld: boolean
  pwSuccess: boolean
  setAuth: (token: string, user: UserPublic) => Promise<void>
  setPwConfirm: Dispatch<SetStateAction<string>>
  setPwError: Dispatch<SetStateAction<string | null>>
  setPwNew: Dispatch<SetStateAction<string>>
  setPwOld: Dispatch<SetStateAction<string>>
  setPwSaving: Dispatch<SetStateAction<boolean>>
  setPwShowNew: Dispatch<SetStateAction<boolean>>
  setPwShowOld: Dispatch<SetStateAction<boolean>>
  setPwSuccess: Dispatch<SetStateAction<boolean>>
  setUser: (user: UserPublic) => void
  setUsernameAvailable: Dispatch<SetStateAction<boolean | null>>
  setUsernameCheckFailed: Dispatch<SetStateAction<boolean>>
  setUsernameChecking: Dispatch<SetStateAction<boolean>>
  setUsernameEdit: Dispatch<SetStateAction<string>>
  setUsernameError: Dispatch<SetStateAction<string | null>>
  setUsernameSaving: Dispatch<SetStateAction<boolean>>
  showPwModal: boolean
  showUsernameModal: boolean
  token: string | null
  user: User | null
  usernameAvailable: boolean | null
  usernameCheckFailed: boolean
  usernameCheckTimeoutRef: RefObject<number | null>
  usernameChecking: boolean
  usernameEdit: string
  usernameError: string | null
  usernameModalRef: RefObject<HTMLDivElement | null>
  usernameSaving: boolean
}

/** Moved unchanged out of UserBar.tsx. */
export default function AccountCredentialDialogs({
  closePasswordModal,
  closeUsernameModal,
  handleLogout,
  isGoogleOnlyAccount,
  passwordModalRef,
  pwConfirm,
  pwError,
  pwNew,
  pwOld,
  pwSaving,
  pwShowNew,
  pwShowOld,
  pwSuccess,
  setAuth,
  setPwConfirm,
  setPwError,
  setPwNew,
  setPwOld,
  setPwSaving,
  setPwShowNew,
  setPwShowOld,
  setPwSuccess,
  setUser,
  setUsernameAvailable,
  setUsernameCheckFailed,
  setUsernameChecking,
  setUsernameEdit,
  setUsernameError,
  setUsernameSaving,
  showPwModal,
  showUsernameModal,
  token,
  user,
  usernameAvailable,
  usernameCheckFailed,
  usernameCheckTimeoutRef,
  usernameChecking,
  usernameEdit,
  usernameError,
  usernameModalRef,
  usernameSaving,
}: AccountCredentialDialogsProps) {
  return (
    <>
      {showUsernameModal && typeof document !== 'undefined' && createPortal((() => {
        const changedAt = user?.username_changed_at ? new Date(user.username_changed_at).getTime() : null
        const nextAllowedMs = changedAt ? changedAt + 7 * 24 * 60 * 60 * 1000 : null
        const cannotChangeYet = nextAllowedMs != null && Date.now() < nextAllowedMs
        const nextAllowedDate = nextAllowedMs != null ? new Date(nextAllowedMs) : null
        return (
        <div className="modal-overlay" onClick={() => closeUsernameModal()}>
          <div ref={usernameModalRef} className="modal pw-modal" role="dialog" aria-modal="true" aria-labelledby="change-username-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <header className="pw-modal-header">
              <h2 id="change-username-title">Change username</h2>
              <p className="pw-modal-subtitle">3–32 characters, letters, numbers, underscores, and periods.</p>
              <p className="pw-modal-subtitle" style={{ marginTop: 4, fontSize: 13 }}>
                You can only change your username once every 7 days.
                {cannotChangeYet && nextAllowedDate && (
                  <> Next change allowed: <strong>{nextAllowedDate.toLocaleDateString('en-US', { dateStyle: 'long' })}</strong>.</>
                )}
              </p>
            </header>
            <div className="pw-change-form">
              <div className="pw-field-wrap">
                <label className="user-setting-title" htmlFor="username-new">New username</label>
                <div className="pw-input-wrap">
                  <input
                    id="username-new"
                    type="text"
                    className="pw-input"
                    placeholder="e.g. myname"
                    value={usernameEdit}
                    disabled={cannotChangeYet}
                    onChange={(e) => {
                      const v = e.target.value
                      setUsernameEdit(v)
                      setUsernameError(null)
                      if (v.trim() === user?.username) {
                        setUsernameAvailable(true)
                        return
                      }
                      if (!isValidUsername(v.trim())) {
                        setUsernameAvailable(null)
                        setUsernameChecking(false)
                        setUsernameCheckFailed(false)
                        return
                      }
                      setUsernameCheckFailed(false)
                      if (usernameCheckTimeoutRef.current) clearTimeout(usernameCheckTimeoutRef.current)
                      usernameCheckTimeoutRef.current = setTimeout(() => {
                        usernameCheckTimeoutRef.current = null
                        setUsernameChecking(true)
                        authApi.checkUsername(v.trim(), token ?? null)
                          .then((r) => {
                            setUsernameAvailable(r.available)
                            setUsernameCheckFailed(false)
                          })
                          .catch(() => {
                            setUsernameAvailable(true)
                            setUsernameCheckFailed(true)
                          })
                          .finally(() => setUsernameChecking(false))
                      }, 300)
                    }}
                    onBlur={() => {
                      const v = usernameEdit.trim()
                      if (isValidUsername(v) && v.toLowerCase() !== user?.username?.toLowerCase()) {
                        setUsernameChecking(true)
                        setUsernameCheckFailed(false)
                        authApi.checkUsername(v, token ?? null)
                          .then((r) => {
                            setUsernameAvailable(r.available)
                            setUsernameCheckFailed(false)
                          })
                          .catch(() => {
                            setUsernameAvailable(true)
                            setUsernameCheckFailed(true)
                          })
                          .finally(() => setUsernameChecking(false))
                      }
                    }}
                    minLength={3}
                    maxLength={32}
                    autoComplete="off"
                  />
                </div>
                {usernameEdit.length > 0 && usernameEdit.length < 3 && (
                  <div className="pw-hint pw-hint-warn">At least 3 characters</div>
                )}
                {usernameEdit.length >= 3 && !hasOnlyUsernameChars(usernameEdit) && (
                  <div className="pw-hint pw-hint-warn">Only letters, numbers, underscores, and periods</div>
                )}
                {usernameEdit.length >= 3 && hasOnlyUsernameChars(usernameEdit) && hasUsernameBoundarySeparator(usernameEdit) && (
                  <div className="pw-hint pw-hint-warn">Cannot start or end with '_' or '.'</div>
                )}
                {usernameEdit.length >= 3 && hasOnlyUsernameChars(usernameEdit) && !hasUsernameBoundarySeparator(usernameEdit) && hasUsernameConsecutiveSeparator(usernameEdit) && (
                  <div className="pw-hint pw-hint-warn">Cannot contain consecutive '_' or '.'</div>
                )}
                {isValidUsername(usernameEdit) && usernameChecking && (
                  <div className="pw-hint">Checking availability…</div>
                )}
                {isValidUsername(usernameEdit) && !usernameChecking && usernameAvailable === false && (
                  <div className="pw-hint pw-hint-warn">Username already taken</div>
                )}
                {isValidUsername(usernameEdit) && !usernameChecking && usernameAvailable === true && !usernameCheckFailed && (
                  <div className="pw-hint pw-hint-ok">Available</div>
                )}
                {isValidUsername(usernameEdit) && usernameCheckFailed && (
                  <div className="pw-hint pw-hint-warn">Could not verify. You can try Save.</div>
                )}
                {usernameError && <div className="pw-error" role="alert">{usernameError}</div>}
              </div>
            </div>
            <footer className="pw-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => closeUsernameModal()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={cannotChangeYet || usernameSaving || !isValidUsername(usernameEdit.trim()) || usernameEdit.trim() === user?.username || usernameAvailable !== true}
                onClick={async () => {
                  const v = usernameEdit.trim()
                  if (v === user?.username || v.length < 3) return
                  setUsernameSaving(true)
                  setUsernameError(null)
                  try {
                    const updated = await authApi.updateProfile({ username: v }, token ?? null)
                    if (usernameCheckTimeoutRef.current) {
                      clearTimeout(usernameCheckTimeoutRef.current)
                      usernameCheckTimeoutRef.current = null
                    }
                    setUser(updated)
                    closeUsernameModal()
                  } catch (err: unknown) {
                    const msg = getAuthErrorMessage(err).message || 'Could not update username'
                    setUsernameError(msg)
                    if (/already taken|taken/i.test(msg)) setUsernameAvailable(false)
                  } finally {
                    setUsernameSaving(false)
                  }
                }}
              >
                {usernameSaving ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </div>
        </div>
        ); })(), document.body)}
      {showPwModal && typeof document !== 'undefined' && createPortal((
        <div className="modal-overlay" onClick={() => closePasswordModal()}>
          <div ref={passwordModalRef} className="modal pw-modal" role="dialog" aria-modal="true" aria-labelledby="change-password-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <header className="pw-modal-header">
              <Lock size={20} className="pw-modal-icon" />
              <h2 id="change-password-title">{isGoogleOnlyAccount ? 'Set password' : 'Change password'}</h2>
              <p className="pw-modal-subtitle">
                {isGoogleOnlyAccount
                  ? 'Set a password so you can sign in with email and password too.'
                  : 'You will be logged out after changing your password.'}
              </p>
            </header>
            <div className="pw-change-form">
              {!isGoogleOnlyAccount && (
                <div className="pw-field-wrap">
                  <label className="user-setting-title" htmlFor="pw-old">Current password</label>
                  <div className="pw-input-wrap">
                    <Lock size={14} className="pw-input-icon" />
                    <input
                      id="pw-old"
                      type={pwShowOld ? 'text' : 'password'}
                      className="pw-input"
                      placeholder="Enter current password"
                      value={pwOld}
                      onChange={(e) => { setPwOld(e.target.value); setPwError(null); setPwSuccess(false) }}
                      autoComplete="current-password"
                    />
                    <button type="button" className="pw-eye-btn" onClick={() => setPwShowOld(v => !v)} tabIndex={-1} aria-label="Toggle visibility">
                      {pwShowOld ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              )}
              <div className="pw-field-wrap">
                <label className="user-setting-title" htmlFor="pw-new">New password</label>
                <div className="pw-input-wrap">
                  <Lock size={14} className="pw-input-icon" />
                  <input
                    id="pw-new"
                    type={pwShowNew ? 'text' : 'password'}
                    className="pw-input"
                    placeholder="Min. 8 characters"
                    value={pwNew}
                    onChange={(e) => { setPwNew(e.target.value); setPwError(null); setPwSuccess(false) }}
                    autoComplete="new-password"
                  />
                  <button type="button" className="pw-eye-btn" onClick={() => setPwShowNew(v => !v)} tabIndex={-1} aria-label="Toggle visibility">
                    {pwShowNew ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {pwNew.length > 0 && pwNew.length < 8 && (
                  <div className="pw-hint pw-hint-warn">Password must be at least 8 characters</div>
                )}
                {pwNew.length >= 8 && (
                  <div className="pw-hint pw-hint-ok">Looks good!</div>
                )}
              </div>
              <div className="pw-field-wrap">
                <label className="user-setting-title" htmlFor="pw-confirm">Confirm new password</label>
                <div className="pw-input-wrap">
                  <Lock size={14} className="pw-input-icon" />
                  <input
                    id="pw-confirm"
                    type={pwShowNew ? 'text' : 'password'}
                    className="pw-input"
                    placeholder="Repeat new password"
                    value={pwConfirm}
                    onChange={(e) => { setPwConfirm(e.target.value); setPwError(null); setPwSuccess(false) }}
                    autoComplete="new-password"
                  />
                </div>
                {pwConfirm.length > 0 && pwNew !== pwConfirm && (
                  <div className="pw-hint pw-hint-warn">Passwords do not match</div>
                )}
              </div>
              {pwError && <div className="pw-error" role="alert">{pwError}</div>}
              {pwSuccess && (
                <div className="pw-success">
                  {isGoogleOnlyAccount ? 'Password set successfully.' : 'Password changed! Redirecting to login…'}
                </div>
              )}
            </div>
            <footer className="pw-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => closePasswordModal()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pwSaving || pwNew.length < 8 || pwNew !== pwConfirm || (!isGoogleOnlyAccount && !pwOld)}
                onClick={async () => {
                  setPwSaving(true)
                  setPwError(null)
                  try {
                    if (isGoogleOnlyAccount) {
                      const auth = await authApi.setPassword(pwNew, token ?? null)
                      if (token) await setAuth(auth.token, auth.user)
                      else setUser(auth.user)
                      // Setting a password ends the old token version, and with it the image grant.
                      void refreshImageProxyGrant(token ? auth.token : null).catch(() => {})
                      setPwSuccess(true)
                      setPwOld(''); setPwNew(''); setPwConfirm('')
                      setTimeout(() => {
                        closePasswordModal()
                      }, 900)
                    } else {
                      await authApi.changePassword(pwOld, pwNew, token ?? null)
                      setPwSuccess(true)
                      setPwOld(''); setPwNew(''); setPwConfirm('')
                      setTimeout(() => {
                        handleLogout()
                      }, 1500)
                    }
                  } catch (err: unknown) {
                    const errorObj = err as Record<string, Record<string, Record<string, string>>>
                    const msg = errorObj?.response?.data?.message || (err as Error)?.message || (isGoogleOnlyAccount ? 'Set password failed' : 'Password change failed')
                    setPwError(msg)
                  } finally {
                    setPwSaving(false)
                  }
                }}
              >
                {pwSaving ? (isGoogleOnlyAccount ? 'Saving…' : 'Changing…') : 'Confirm'}
              </button>
            </footer>
          </div>
        </div>
      ), document.body)}
    </>
  )
}
