import { Settings, Eye, EyeOff, Lock, Circle, Star, BellOff, Ghost } from 'lucide-react'
import { StatusIcon, type StatusValue } from './StatusIcon'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { useToastStore } from '../stores/toast'
import { isTauri } from '../secureStorage'
import { authApi, getAuthErrorMessage } from '../api'
import { useSocketStore } from '../stores/socket'
import { SENSITIVITY_THRESHOLD_KEY } from '../webrtc/sensitivityThreshold'
import SensitivityBar from './SensitivityBar'

const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024
const SETTINGS_CHANGED_EVENT = 'voxpery-voice-settings-changed'
const SOUND_KEY = 'voxpery-settings-sound-enabled'
const INPUT_VOL_KEY = 'voxpery-settings-input-volume'
const OUTPUT_VOL_KEY = 'voxpery-settings-output-volume'
const VOICE_MODE_KEY = 'voxpery-settings-voice-mode'
const PTT_KEY_KEY = 'voxpery-settings-ptt-key'
const NOISE_SUPPRESSION_KEY = 'voxpery-settings-noise-suppression'
const SPEAKING_THRESHOLD_KEY = SENSITIVITY_THRESHOLD_KEY
const SPEAKING_PRESET_KEY = 'voxpery-settings-speaking-preset'
const LAST_STATUS_KEY = 'voxpery-last-status'

function getInitial(name: string) {
  return name.charAt(0).toUpperCase()
}

function statusLabel(status?: string) {
  if (status === 'dnd') return 'Do Not Disturb'
  if (status === 'idle') return 'Idle'
  if (status === 'offline') return 'Offline'
  return 'Online'
}

/** Sensitivity threshold (0–100) per preset. Lower = more sensitive (quieter sounds pass / sent). */
function thresholdByPreset(preset: 'quiet' | 'normal' | 'noisy') {
  if (preset === 'quiet') return 16    // −36dB: sensitive but avoids false positives
  if (preset === 'noisy') return 55    // −15dB: only loud direct speech passes
  return 25    // −29dB: balanced for standard speaking volume
}

export default function UserBar() {
  const { user, token, setUserStatus, setUser, setAuth, logout } = useAuthStore()
  const { disconnect } = useSocketStore()
  const navigate = useNavigate()
  const pushToast = useToastStore((s) => s.pushToast)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [inputVolume, setInputVolume] = useState(80)
  const [outputVolume, setOutputVolume] = useState(100)
  const [voiceMode, setVoiceMode] = useState<'voice_activity' | 'push_to_talk'>('voice_activity')
  const [pttKey, setPttKey] = useState('V')
  const [capturingPtt, setCapturingPtt] = useState(false)
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(true)
  const [dmPrivacy, setDmPrivacy] = useState<'everyone' | 'friends'>(
    (user?.dm_privacy === 'everyone' || user?.dm_privacy === 'friends' ? user.dm_privacy : 'friends') ?? 'friends'
  )
  const [speakingThreshold, setSpeakingThreshold] = useState(30)
  const [speakingPreset, setSpeakingPreset] = useState<'quiet' | 'normal' | 'noisy' | 'custom'>('normal')
  const [pwOld, setPwOld] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwShowOld, setPwShowOld] = useState(false)
  const [pwShowNew, setPwShowNew] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [showUsernameModal, setShowUsernameModal] = useState(false)
  const [usernameEdit, setUsernameEdit] = useState('')
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernameChecking, setUsernameChecking] = useState(false)
  const [usernameCheckFailed, setUsernameCheckFailed] = useState(false)
  const statusMenuRef = useRef<HTMLDivElement>(null)
  const usernameCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusToggleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sound = localStorage.getItem(SOUND_KEY)
    const input = localStorage.getItem(INPUT_VOL_KEY)
    const output = localStorage.getItem(OUTPUT_VOL_KEY)
    const mode = localStorage.getItem(VOICE_MODE_KEY)
    const ptt = localStorage.getItem(PTT_KEY_KEY)
    const ns = localStorage.getItem(NOISE_SUPPRESSION_KEY)
    const speaking = localStorage.getItem(SPEAKING_THRESHOLD_KEY)
    const preset = localStorage.getItem(SPEAKING_PRESET_KEY)
    if (sound != null) setSoundEnabled(sound === '1')
    if (input != null) setInputVolume(Math.min(100, Math.max(1, Number(input) || 80)))
    if (output != null) setOutputVolume(Math.min(100, Math.max(1, Number(output) || 100)))
    if (mode === 'push_to_talk' || mode === 'voice_activity') setVoiceMode(mode)
    if (ptt) setPttKey(ptt)
    if (ns != null) setNoiseSuppressionEnabled(ns === '1')
    if (speaking != null) setSpeakingThreshold(Math.min(100, Math.max(0, Number(speaking) || 30)))
    if (preset === 'quiet' || preset === 'normal' || preset === 'noisy' || preset === 'custom') {
      setSpeakingPreset(preset)
    } else {
      setSpeakingPreset('normal')
      setSpeakingThreshold(thresholdByPreset('normal'))
      try {
        localStorage.setItem(SPEAKING_PRESET_KEY, 'normal')
        localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(thresholdByPreset('normal')))
        window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
      } catch {
        // ignore storage errors
      }
    }
  }, [])

  useEffect(() => {
    if (!showStatusMenu) return
    const close = (evt: MouseEvent) => {
      const target = evt.target as Node | null
      if (target && statusMenuRef.current?.contains(target)) return
      if (target && statusToggleRef.current?.contains(target)) return
      setShowStatusMenu(false)
      setStatusError(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [showStatusMenu])

  useEffect(() => {
    if (!capturingPtt) return
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      const key = e.key?.length === 1 ? e.key.toUpperCase() : e.key
      if (!key) return
      setPttKey(key)
      localStorage.setItem(PTT_KEY_KEY, key)
      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
      setCapturingPtt(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [capturingPtt])

  useEffect(() => {
    setDmPrivacy(user?.dm_privacy === 'everyone' || user?.dm_privacy === 'friends' ? user.dm_privacy : 'friends')
  }, [user?.dm_privacy])


  const updateMyStatus = async (status: 'online' | 'idle' | 'dnd' | 'offline') => {
    if (isTauri() && !token) return
    flushSync(() => {
      setShowStatusMenu(false)
      setStatusError(null)
    })
    setStatusSaving(true)
    try {
      const updated = await authApi.updateStatus(status, token ?? null)
      setUserStatus(updated.status)
      try {
        localStorage.setItem(LAST_STATUS_KEY, updated.status)
      } catch {
        // ignore
      }
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : 'Failed to update status')
      setShowStatusMenu(true)
    } finally {
      setStatusSaving(false)
    }
  }

  const updateProfileAvatar = async (avatarUrl: string | null) => {
    if (isTauri() && !token) return
    try {
      const updated = await authApi.updateProfile(
        avatarUrl ? { avatar_url: avatarUrl } : { clear_avatar: true },
        token ?? null,
      )
      setUser(updated)

      const appStore = useAppStore.getState()
      appStore.setMembers(
        appStore.members.map((member) =>
          member.user_id === updated.id
            ? {
              ...member,
              username: updated.username,
              avatar_url: updated.avatar_url ?? null,
              status: updated.status,
            }
            : member,
        ),
      )

      Object.entries(appStore.membersByServerId).forEach(([serverId, serverMembers]) => {
        if (!serverMembers.some((member) => member.user_id === updated.id)) return
        appStore.setMembersForServer(
          serverId,
          serverMembers.map((member) =>
            member.user_id === updated.id
              ? {
                ...member,
                username: updated.username,
                avatar_url: updated.avatar_url ?? null,
                status: updated.status,
              }
              : member,
          ),
        )
      })

      if (appStore.friends.some((friend) => friend.id === updated.id)) {
        appStore.setFriends(
          appStore.friends.map((friend) =>
            friend.id === updated.id
              ? {
                ...friend,
                username: updated.username,
                avatar_url: updated.avatar_url ?? null,
                status: updated.status,
              }
              : friend,
          ),
        )
      }

      if (appStore.dmChannels.some((channel) => channel.peer_id === updated.id)) {
        appStore.setDmChannels(
          appStore.dmChannels.map((channel) =>
            channel.peer_id === updated.id
              ? {
                ...channel,
                peer_username: updated.username,
                peer_avatar_url: updated.avatar_url ?? null,
                peer_status: updated.status,
              }
              : channel,
          ),
        )
      }
    } catch (err) {
      console.error('Failed to update profile avatar:', err)
    }
  }

  const onPickProfileAvatar = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    if (!file.type.startsWith('image/')) {
      pushToast({
        level: 'error',
        title: 'Invalid file type',
        message: 'Only image files are supported for profile photo uploads.',
      })
      return
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      const maxMb = Math.round(MAX_PROFILE_IMAGE_BYTES / (1024 * 1024))
      pushToast({
        level: 'error',
        title: 'Image too large',
        message: `Profile photo must be ${maxMb} MB or smaller.`,
      })
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    await updateProfileAvatar(dataUrl)
  }

  return (
    <div className="user-bar-wrap" ref={statusToggleRef}>
      <div className="user-panel">
        <button
          type="button"
          className="user-avatar user-avatar-btn"
          onClick={() => {
            setShowStatusMenu((v) => !v)
            setStatusError(null)
          }}
          title="Set status"
          aria-label="Set status"
        >
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.username} className="user-avatar-image" />
          ) : (
            user ? getInitial(user.username) : '?'
          )}
          <StatusIcon status={(user?.status ?? 'online') as StatusValue} variant="badge" />
        </button>
        <button
          type="button"
          className="user-info user-info-btn"
          onClick={() => {
            setShowStatusMenu((v) => !v)
            setStatusError(null)
          }}
          title="Set status"
          aria-label="Set status"
        >
          <div className="user-name">{user?.username || 'User'}</div>
          <div className="user-status">{statusLabel(user?.status)}</div>
        </button>
      </div>
      <button
        type="button"
        className="user-panel-icon-btn"
        onClick={() => setShowSettingsPanel(true)}
        title="User settings"
        aria-label="Settings"
      >
        <Settings size={18} />
      </button>
      {showStatusMenu && (
        <div ref={statusMenuRef} className="user-status-popover" role="dialog" aria-label="SET YOUR STATUS">
          <div className="user-status-popover-header">
            <span className="user-status-popover-title">SET YOUR STATUS</span>
          </div>
          {statusError && (
            <div className="user-status-popover-error">{statusError}</div>
          )}
          <div className="user-status-list">
            {(['online', 'idle', 'dnd', 'offline'] as const).map((status) => {
              const Icon = status === 'online' ? Circle : status === 'idle' ? Star : status === 'dnd' ? BellOff : Ghost
              return (
                <button
                  key={status}
                  type="button"
                  className={`user-status-option user-status-option-${status} ${user?.status === status ? 'active' : ''}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => updateMyStatus(status)}
                  disabled={statusSaving}
                  aria-pressed={user?.status === status}
                >
                  <span className="user-status-option-icon" aria-hidden>
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <span className="user-status-option-label">{statusLabel(status)}</span>
                  {user?.status === status && (
                    <span className="user-status-option-check" aria-hidden>✓</span>
                  )}
                </button>
              )
            })}
          </div>
          {statusSaving && (
            <div className="user-status-popover-saving">Updating…</div>
          )}
          <div className="user-status-popover-profile">
            <div className="user-status-popover-avatar" aria-hidden>
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="" />
              ) : (
                <span>{user ? getInitial(user.username) : '?'}</span>
              )}
            </div>
            <span className="user-status-popover-profile-links">
              <label className="user-status-popover-profile-link">
                Upload
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => void onPickProfileAvatar(e.target.files)}
                />
              </label>
              {user?.avatar_url && (
                <>
                  <span className="user-status-popover-profile-sep" aria-hidden>·</span>
                  <button
                    type="button"
                    className="user-status-popover-profile-link"
                    onClick={() => void updateProfileAvatar(null)}
                  >
                    Remove
                  </button>
                </>
              )}
            </span>
          </div>
          <div className="user-status-popover-footer">
            <button
              type="button"
              className="user-status-popover-logout"
              onClick={() => {
                disconnect()
                logout()
                navigate('/login', { replace: true })
              }}
            >
              Log out
            </button>
          </div>
        </div>
      )}
      {showSettingsPanel && (
        <div className="modal-overlay" onClick={() => setShowSettingsPanel(false)}>
          <div className="modal user-settings-modal" onClick={(e) => e.stopPropagation()}>
            <header className="user-settings-header">
              <h2>Settings</h2>
              <p className="user-settings-subtitle">Voice, notifications, and account.</p>
            </header>
            <div className="user-settings-scroll">
              <section className="user-settings-section">
                <h3 className="user-settings-section-title">Notifications</h3>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Notification sounds</div>
                    <div className="user-setting-desc">Play sound for mentions and new messages.</div>
                  </div>
                  <button
                    type="button"
                    className={`user-toggle ${soundEnabled ? 'active' : ''}`}
                    onClick={() => {
                      const next = !soundEnabled
                      setSoundEnabled(next)
                      localStorage.setItem(SOUND_KEY, next ? '1' : '0')
                    }}
                  >
                    {soundEnabled ? 'On' : 'Off'}
                  </button>
                </div>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Who can send you DMs</div>
                    <div className="user-setting-desc">Who can start a DM with you.</div>
                  </div>
                  <select
                    className="user-select"
                    value={dmPrivacy}
                    onChange={async (e) => {
                      const next = e.target.value as 'everyone' | 'friends'
                      setDmPrivacy(next)
                      try {
                        const updated = await authApi.updateProfile({ dm_privacy: next }, token ?? null)
                        setUser(updated)
                      } catch {
                        pushToast({
                          level: 'error',
                          title: 'DM privacy update failed',
                          message: 'Could not update DM privacy preference.',
                        })
                      }
                    }}
                  >
                    <option value="everyone">Everyone</option>
                    <option value="friends">Friends only</option>
                  </select>
                </div>
              </section>
              <section className="user-settings-section">
                <h3 className="user-settings-section-title">Voice</h3>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Voice mode</div>
                    <div className="user-setting-desc">How your mic is activated.</div>
                  </div>
                  <select
                    className="user-select"
                    value={voiceMode}
                    onChange={(e) => {
                      const next = e.target.value === 'push_to_talk' ? 'push_to_talk' : 'voice_activity'
                      setVoiceMode(next)
                      localStorage.setItem(VOICE_MODE_KEY, next)
                      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                    }}
                  >
                    <option value="voice_activity">Voice Activity</option>
                    <option value="push_to_talk">Push to Talk</option>
                  </select>
                </div>
                {voiceMode === 'push_to_talk' && (
                  <div className="user-setting-row">
                    <div>
                      <div className="user-setting-title">Push-to-talk key</div>
                      <div className="user-setting-desc">Current: {pttKey}</div>
                    </div>
                    <button
                      type="button"
                      className={`user-toggle ${capturingPtt ? 'active' : ''}`}
                      onClick={() => setCapturingPtt((v) => !v)}
                    >
                      {capturingPtt ? 'Press key...' : 'Rebind'}
                    </button>
                  </div>
                )}
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Noise suppression</div>
                    <div className="user-setting-desc">
                      Removes background noise (keyboard, fan, etc.) from your mic signal in real time.
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`user-toggle ${noiseSuppressionEnabled ? 'active' : ''}`}
                    onClick={() => {
                      const next = !noiseSuppressionEnabled
                      setNoiseSuppressionEnabled(next)
                      localStorage.setItem(NOISE_SUPPRESSION_KEY, next ? '1' : '0')
                      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                    }}
                  >
                    {noiseSuppressionEnabled ? 'On' : 'Off'}
                  </button>
                </div>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Input sensitivity</div>
                    <div className="user-setting-desc">
                      Your mic is only active when audio volume exceeds this threshold.
                    </div>
                  </div>
                  <select
                    className="user-select"
                    value={speakingPreset}
                    onChange={(e) => {
                      const next = e.target.value as 'quiet' | 'normal' | 'noisy' | 'custom'
                      setSpeakingPreset(next)
                      localStorage.setItem(SPEAKING_PRESET_KEY, next)
                      if (next !== 'custom') {
                        const threshold = thresholdByPreset(next)
                        setSpeakingThreshold(threshold)
                        localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(threshold))
                      }
                    }}
                  >
                    <option value="quiet">Quiet room</option>
                    <option value="normal">Normal</option>
                    <option value="noisy">Noisy room</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div className="user-setting-row user-setting-row-full">
                  <SensitivityBar
                    threshold={speakingThreshold}
                    onThresholdChange={(v) => {
                      setSpeakingThreshold(v)
                      localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(v))
                    }}
                    onPresetChange={(preset) => {
                      setSpeakingPreset(preset)
                      localStorage.setItem(SPEAKING_PRESET_KEY, preset)
                    }}
                  />
                </div>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Input volume</div>
                    <div className="user-setting-desc">Microphone send level ({inputVolume}%).</div>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={inputVolume}
                    className="user-slider"
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      setInputVolume(next)
                      localStorage.setItem(INPUT_VOL_KEY, String(next))
                      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                    }}
                  />
                </div>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Output volume</div>
                    <div className="user-setting-desc">Speaker/headphone level ({outputVolume}%).</div>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={outputVolume}
                    className="user-slider"
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      setOutputVolume(next)
                      localStorage.setItem(OUTPUT_VOL_KEY, String(next))
                      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                    }}
                  />
                </div>
              </section>
              <section className="user-settings-section">
                <h3 className="user-settings-section-title">Account</h3>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Username</div>
                    <div className="user-setting-desc">Your display name. Letters, numbers, and underscores.</div>
                  </div>
                  <button
                    type="button"
                    className="user-toggle"
                    onClick={() => {
                      setUsernameEdit(user?.username ?? '')
                      setUsernameError(null)
                      setUsernameAvailable(null)
                      setUsernameChecking(false)
                      setUsernameCheckFailed(false)
                      setShowUsernameModal(true)
                    }}
                  >
                    Change
                  </button>
                </div>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Password</div>
                    <div className="user-setting-desc">Update your account password.</div>
                  </div>
                  <button
                    type="button"
                    className="user-toggle"
                    onClick={() => { setShowPwModal(true); setPwOld(''); setPwNew(''); setPwConfirm(''); setPwError(null); setPwSuccess(false) }}
                  >
                    Change
                  </button>
                </div>
              </section>
            </div>
            <footer className="user-settings-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowSettingsPanel(false)}
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      )}
      {showUsernameModal && (() => {
        const changedAt = user?.username_changed_at ? new Date(user.username_changed_at).getTime() : null
        const nextAllowedMs = changedAt ? changedAt + 30 * 24 * 60 * 60 * 1000 : null
        const cannotChangeYet = nextAllowedMs != null && Date.now() < nextAllowedMs
        const nextAllowedDate = nextAllowedMs != null ? new Date(nextAllowedMs) : null
        return (
        <div className="modal-overlay" onClick={() => setShowUsernameModal(false)}>
          <div className="modal pw-modal" onClick={(e) => e.stopPropagation()}>
            <header className="pw-modal-header">
              <h2>Change username</h2>
              <p className="pw-modal-subtitle">3–32 characters, letters, numbers, and underscores.</p>
              <p className="pw-modal-subtitle" style={{ marginTop: 4, fontSize: 13 }}>
                You can only change your username once every 30 days.
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
                      if (v.trim().toLowerCase() === user?.username?.toLowerCase()) {
                        setUsernameAvailable(true)
                        return
                      }
                      if (v.trim().length < 3 || !/^[a-zA-Z0-9_]+$/.test(v.trim())) {
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
                      if (v.length >= 3 && /^[a-zA-Z0-9_]+$/.test(v) && v.toLowerCase() !== user?.username?.toLowerCase()) {
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
                {usernameEdit.length >= 3 && !/^[a-zA-Z0-9_]+$/.test(usernameEdit) && (
                  <div className="pw-hint pw-hint-warn">Only letters, numbers, and underscores</div>
                )}
                {usernameEdit.length >= 3 && /^[a-zA-Z0-9_]+$/.test(usernameEdit) && usernameChecking && (
                  <div className="pw-hint">Checking availability…</div>
                )}
                {usernameEdit.length >= 3 && /^[a-zA-Z0-9_]+$/.test(usernameEdit) && !usernameChecking && usernameAvailable === false && (
                  <div className="pw-hint pw-hint-warn">Username already taken</div>
                )}
                {usernameEdit.length >= 3 && /^[a-zA-Z0-9_]+$/.test(usernameEdit) && !usernameChecking && usernameAvailable === true && !usernameCheckFailed && (
                  <div className="pw-hint pw-hint-ok">Available</div>
                )}
                {usernameEdit.length >= 3 && /^[a-zA-Z0-9_]+$/.test(usernameEdit) && usernameCheckFailed && (
                  <div className="pw-hint pw-hint-warn">Could not verify. You can try Save.</div>
                )}
                {usernameError && <div className="pw-error">{usernameError}</div>}
              </div>
            </div>
            <footer className="pw-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (usernameCheckTimeoutRef.current) {
                    clearTimeout(usernameCheckTimeoutRef.current)
                    usernameCheckTimeoutRef.current = null
                  }
                  setShowUsernameModal(false)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={cannotChangeYet || usernameSaving || usernameEdit.trim().length < 3 || !/^[a-zA-Z0-9_]+$/.test(usernameEdit.trim()) || usernameEdit.trim().toLowerCase() === user?.username?.toLowerCase() || usernameAvailable !== true}
                onClick={async () => {
                  const v = usernameEdit.trim()
                  if (v.toLowerCase() === user?.username?.toLowerCase() || v.length < 3) return
                  setUsernameSaving(true)
                  setUsernameError(null)
                  try {
                    const updated = await authApi.updateProfile({ username: v }, token ?? null)
                    if (usernameCheckTimeoutRef.current) {
                      clearTimeout(usernameCheckTimeoutRef.current)
                      usernameCheckTimeoutRef.current = null
                    }
                    if (token) {
                      setAuth(token, updated)
                    } else {
                      setUser(updated)
                    }
                    setShowUsernameModal(false)
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
        ); })()}
      {showPwModal && (
        <div className="modal-overlay" onClick={() => setShowPwModal(false)}>
          <div className="modal pw-modal" onClick={(e) => e.stopPropagation()}>
            <header className="pw-modal-header">
              <Lock size={20} className="pw-modal-icon" />
              <h2>Change password</h2>
              <p className="pw-modal-subtitle">You will be logged out after changing your password.</p>
            </header>
            <div className="pw-change-form">
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
              {pwError && <div className="pw-error">{pwError}</div>}
              {pwSuccess && <div className="pw-success">Password changed! Redirecting to login…</div>}
            </div>
            <footer className="pw-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowPwModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pwSaving || pwNew.length < 8 || pwNew !== pwConfirm || !pwOld}
                onClick={async () => {
                  setPwSaving(true)
                  setPwError(null)
                  try {
                    await authApi.changePassword(pwOld, pwNew, token ?? null)
                    setPwSuccess(true)
                    setPwOld(''); setPwNew(''); setPwConfirm('')
                    setTimeout(() => {
                      disconnect()
                      logout()
                      navigate('/login', { replace: true })
                    }, 1500)
                  } catch (err: any) {
                    const msg = err?.response?.data?.message || err?.message || 'Password change failed'
                    setPwError(msg)
                  } finally {
                    setPwSaving(false)
                  }
                }}
              >
                {pwSaving ? 'Changing…' : 'Confirm'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
