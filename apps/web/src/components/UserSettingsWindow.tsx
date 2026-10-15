import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  ChevronsUpDown,
  Download,
  ExternalLink,
  Info,
  LogOut,
  MessageSquare,
  Mic,
  Monitor,
  Palette,
  Shield,
  Trash2,
  User,
} from 'lucide-react'
import type { StatusValue } from './StatusIcon'
import { isTauri } from '../secureStorage'
import { authApi, resolveAvatarUrl, type UserPublic } from '../api'
import { openExternalUrl } from '../openExternalUrl'
import { SPEAKING_PRESET_KEY, thresholdByPreset, type SpeakingPreset } from '../webrtc/sensitivityThreshold'
import SensitivityBar from './SensitivityBar'
import ThemeSettings from './ThemeSettings'
import ProfileAvatarEditor from './ProfileAvatarEditor'
import { VOICE_MODE_KEY } from '../webrtc/voiceInputProfile'
import type { UpdateResult } from '../updater'
import { openDesktopMediaPermissionSettings } from '../desktopMediaPermissions'
import {
  requestPushNotificationPermission,
  setPushNotificationsEnabled as persistPushNotificationsEnabled,
} from '../pushNotifications'
import {
  SERVER_NOTIFICATION_PREFERENCE_OPTIONS,
  setServerNotificationPreference as persistServerNotificationPreference,
  type ServerNotificationPreference,
} from '../notificationPreferences'
import type { VoiceDeviceOption } from '../voiceDevices'
import { formatGlobalMuteShortcut } from '../globalMuteShortcut'
import type { ToastItem } from '../stores/toast'
import CustomServerPanel from './CustomServerPanel'
import {
  footerStatusLabel,
  getInitial,
  INPUT_VOL_KEY,
  NOISE_SUPPRESSION_KEY,
  OUTPUT_VOL_KEY,
  SETTINGS_CHANGED_EVENT,
  SOUND_KEY,
  SPEAKING_THRESHOLD_KEY,
  statusLabel,
  VOXPERY_RELEASES_URL,
  type PhotoLeavePrompt,
  type SettingsSection,
  type VoiceDeviceMenu,
} from './userSettingsShared'

/** Everything the settings window reads or changes; the state itself stays in UserBar. */
export type UserSettingsWindowProps = {
  requestCloseSettings: () => void
  activeSettingsSection: SettingsSection
  settingsModalRef: RefObject<HTMLDivElement | null>
  openDeviceMenu: VoiceDeviceMenu | null
  desktopRuntime: boolean
  isMobileViewport: boolean
  changeSettingsSection: (section: SettingsSection) => void
  openAboutPage: () => Promise<void>
  settingsScrollRef: RefObject<HTMLDivElement | null>
  soundEnabled: boolean
  setSoundEnabled: Dispatch<SetStateAction<boolean>>
  pushNotificationPermission: NotificationPermission | "unsupported"
  pushNotificationsEnabled: boolean
  setPushNotificationPermission: Dispatch<SetStateAction<NotificationPermission | "unsupported">>
  setPushNotificationsEnabledState: Dispatch<SetStateAction<boolean>>
  serverNotificationPreference: ServerNotificationPreference
  setServerNotificationPreferenceState: Dispatch<SetStateAction<ServerNotificationPreference>>
  dmPrivacy: "everyone" | "friends"
  setDmPrivacy: Dispatch<SetStateAction<"everyone" | "friends">>
  token: string | null
  setUser: (user: UserPublic) => void
  pushToast: (toast: Omit<ToastItem, "id">, ttlMs?: number | undefined) => void
  microphoneAccessAllowed: boolean
  microphoneRecoveryMessage: string
  showDesktopMicrophoneRecovery: boolean
  voiceDevicesUnlocking: boolean
  refreshVoiceDevices: (unlockLabels?: boolean) => Promise<void>
  microphoneAccessButtonLabel: "Retry mic access" | "Allow mic access"
  inputDeviceTriggerRef: RefObject<HTMLButtonElement | null>
  currentInputDevice: VoiceDeviceOption
  voiceDevicesLoading: boolean
  voiceDevicesNeedAccess: boolean
  toggleDeviceMenu: (menu: VoiceDeviceMenu) => void
  outputDeviceTriggerRef: RefObject<HTMLButtonElement | null>
  currentOutputDevice: VoiceDeviceOption
  canSelectOutputDevice: boolean
  inputVolume: number
  setInputVolume: Dispatch<SetStateAction<number>>
  outputVolume: number
  setOutputVolume: Dispatch<SetStateAction<number>>
  speakingThreshold: number
  speakingPreset: SpeakingPreset
  user: UserPublic | null
  setSpeakingThreshold: Dispatch<SetStateAction<number>>
  markVoiceProfileCustom: () => void
  setSpeakingPreset: Dispatch<SetStateAction<SpeakingPreset>>
  noiseSuppressionEnabled: boolean
  setNoiseSuppressionEnabled: Dispatch<SetStateAction<boolean>>
  voiceMode: "voice_activity" | "push_to_talk"
  setVoiceMode: Dispatch<SetStateAction<"voice_activity" | "push_to_talk">>
  pttKey: string
  pttShortcutError: string | null
  capturingPtt: boolean
  setPttShortcutError: Dispatch<SetStateAction<string | null>>
  setCapturingPtt: Dispatch<SetStateAction<boolean>>
  capturingGlobalMuteShortcut: boolean
  globalMuteShortcut: string | null
  globalMuteShortcutError: string | null
  setGlobalMuteShortcutError: Dispatch<SetStateAction<string | null>>
  setCapturingGlobalMuteShortcut: Dispatch<SetStateAction<boolean>>
  globalMuteShortcutSaving: boolean
  saveGlobalMuteShortcut: (shortcut: string | null) => Promise<void>
  desktopAppVersion: string | null
  updateChecked: boolean
  updateInfo: UpdateResult | null
  updatesManagedExternally: boolean
  refreshUpdateStatus: (manual?: boolean) => Promise<void>
  updateChecking: boolean
  updateInstalling: boolean
  installDesktopUpdate: () => Promise<void>
  desktopAutostartSupported: boolean
  desktopStartupTargetLabel: "your computer starts" | "macOS starts" | "Linux starts" | "Windows starts"
  desktopAutostartEnabled: boolean
  toggleDesktopAutostart: () => Promise<void>
  desktopAutostartLoading: boolean
  minimizeToTrayOnCloseEnabled: boolean
  toggleMinimizeToTrayOnClose: () => Promise<void>
  minimizeToTrayLoading: boolean
  avatarDraft: { file: File; key: number; } | null
  avatarSelectionError: string | null
  avatarInputRef: RefObject<HTMLInputElement | null>
  onPickProfileAvatar: (files: FileList | null) => void
  avatarSaveRef: RefObject<(() => Promise<boolean>) | null>
  setAvatarDraft: Dispatch<SetStateAction<{ file: File; key: number; } | null>>
  setAvatarSelectionError: Dispatch<SetStateAction<string | null>>
  updateProfileAvatar: (avatarUrl: string | null) => Promise<boolean>
  updateMyStatus: (status: "online" | "dnd" | "invisible") => Promise<void>
  statusSaving: boolean
  aboutMe: string
  setAboutMe: Dispatch<SetStateAction<string>>
  saveProfileDetails: () => Promise<void>
  profileDetailsSaving: boolean
  setUsernameEdit: Dispatch<SetStateAction<string>>
  setUsernameError: Dispatch<SetStateAction<string | null>>
  setUsernameAvailable: Dispatch<SetStateAction<boolean | null>>
  setUsernameChecking: Dispatch<SetStateAction<boolean>>
  setUsernameCheckFailed: Dispatch<SetStateAction<boolean>>
  setShowUsernameModal: Dispatch<SetStateAction<boolean>>
  emailVerificationEnabled: boolean
  resendEmailVerification: () => Promise<void>
  emailVerificationSending: boolean
  setEmailEdit: Dispatch<SetStateAction<string>>
  setEmailError: Dispatch<SetStateAction<string | null>>
  setShowEmailModal: Dispatch<SetStateAction<boolean>>
  isGoogleOnlyAccount: boolean
  openPasswordModal: () => Promise<void>
  handleLogout: () => void
  setExportPassword: Dispatch<SetStateAction<string>>
  setExportError: Dispatch<SetStateAction<string | null>>
  setShowExportModal: Dispatch<SetStateAction<boolean>>
  exportingData: boolean
  setDeletePassword: Dispatch<SetStateAction<string>>
  setDeleteConfirm: Dispatch<SetStateAction<string>>
  setDeleteError: Dispatch<SetStateAction<string | null>>
  setShowDeleteModal: Dispatch<SetStateAction<boolean>>
  photoLeavePrompt: PhotoLeavePrompt | null
  setPhotoLeavePrompt: Dispatch<SetStateAction<PhotoLeavePrompt | null>>
  completePhotoLeave: (prompt: PhotoLeavePrompt) => void
  saveAndCompletePhotoLeave: (prompt: PhotoLeavePrompt) => Promise<void>
}

/** The user settings window; its state lives in UserBar, which renders it in a portal. */
export default function UserSettingsWindow(props: UserSettingsWindowProps) {
  const {
    requestCloseSettings,
    activeSettingsSection,
    settingsModalRef,
    openDeviceMenu,
    desktopRuntime,
    isMobileViewport,
    changeSettingsSection,
    openAboutPage,
    settingsScrollRef,
    soundEnabled,
    setSoundEnabled,
    pushNotificationPermission,
    pushNotificationsEnabled,
    setPushNotificationPermission,
    setPushNotificationsEnabledState,
    serverNotificationPreference,
    setServerNotificationPreferenceState,
    dmPrivacy,
    setDmPrivacy,
    token,
    setUser,
    pushToast,
    microphoneAccessAllowed,
    microphoneRecoveryMessage,
    showDesktopMicrophoneRecovery,
    voiceDevicesUnlocking,
    refreshVoiceDevices,
    microphoneAccessButtonLabel,
    inputDeviceTriggerRef,
    currentInputDevice,
    voiceDevicesLoading,
    voiceDevicesNeedAccess,
    toggleDeviceMenu,
    outputDeviceTriggerRef,
    currentOutputDevice,
    canSelectOutputDevice,
    inputVolume,
    setInputVolume,
    outputVolume,
    setOutputVolume,
    speakingThreshold,
    speakingPreset,
    user,
    setSpeakingThreshold,
    markVoiceProfileCustom,
    setSpeakingPreset,
    noiseSuppressionEnabled,
    setNoiseSuppressionEnabled,
    voiceMode,
    setVoiceMode,
    pttKey,
    pttShortcutError,
    capturingPtt,
    setPttShortcutError,
    setCapturingPtt,
    capturingGlobalMuteShortcut,
    globalMuteShortcut,
    globalMuteShortcutError,
    setGlobalMuteShortcutError,
    setCapturingGlobalMuteShortcut,
    globalMuteShortcutSaving,
    saveGlobalMuteShortcut,
    desktopAppVersion,
    updateChecked,
    updateInfo,
    updatesManagedExternally,
    refreshUpdateStatus,
    updateChecking,
    updateInstalling,
    installDesktopUpdate,
    desktopAutostartSupported,
    desktopStartupTargetLabel,
    desktopAutostartEnabled,
    toggleDesktopAutostart,
    desktopAutostartLoading,
    minimizeToTrayOnCloseEnabled,
    toggleMinimizeToTrayOnClose,
    minimizeToTrayLoading,
    avatarDraft,
    avatarSelectionError,
    avatarInputRef,
    onPickProfileAvatar,
    avatarSaveRef,
    setAvatarDraft,
    setAvatarSelectionError,
    updateProfileAvatar,
    updateMyStatus,
    statusSaving,
    aboutMe,
    setAboutMe,
    saveProfileDetails,
    profileDetailsSaving,
    setUsernameEdit,
    setUsernameError,
    setUsernameAvailable,
    setUsernameChecking,
    setUsernameCheckFailed,
    setShowUsernameModal,
    emailVerificationEnabled,
    resendEmailVerification,
    emailVerificationSending,
    setEmailEdit,
    setEmailError,
    setShowEmailModal,
    isGoogleOnlyAccount,
    openPasswordModal,
    handleLogout,
    setExportPassword,
    setExportError,
    setShowExportModal,
    exportingData,
    setDeletePassword,
    setDeleteConfirm,
    setDeleteError,
    setShowDeleteModal,
    photoLeavePrompt,
    setPhotoLeavePrompt,
    completePhotoLeave,
    saveAndCompletePhotoLeave,
  } = props
  return (
    <div className="modal-overlay" onMouseDown={requestCloseSettings}>
      <div
        className={`modal user-settings-modal ${activeSettingsSection === 'voice' ? 'user-settings-modal--voice' : ''}`}
        ref={settingsModalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-settings-title"
        aria-owns={openDeviceMenu ? 'settings-voice-device-menu' : undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="user-settings-header">
          <div className="user-settings-header-copy">
            <h2 id="user-settings-title">Settings</h2>
            <p className="user-settings-subtitle">
              {desktopRuntime
                ? 'Manage your account, appearance, communication, voice, desktop, and privacy preferences.'
                : 'Manage your account, appearance, communication, voice, and privacy preferences.'}
            </p>
          </div>
        </header>
        <div className="user-settings-body">
          <nav className="user-settings-nav" aria-label="Settings sections">
            {isMobileViewport ? (
              <>
                <select
                  className="user-select user-settings-section-select"
                  aria-label="Settings section"
                  value={activeSettingsSection}
                  onChange={(event) => changeSettingsSection(event.target.value as SettingsSection)}
                >
                  <option value="profile">Profile</option>
                  <option value="appearance">Appearance</option>
                  <option value="communication">Communication</option>
                  <option value="voice">Voice &amp; Audio</option>
                  <option value="privacy">Privacy &amp; Data</option>
                  {desktopRuntime && <option value="desktop">Desktop</option>}
                </select>
                <button
                  type="button"
                  className="user-settings-about-btn"
                  aria-label="About Voxpery"
                  title="Open the Voxpery website"
                  onClick={() => void openAboutPage()}
                >
                  <Info size={18} aria-hidden="true" />
                </button>
              </>
            ) : (
            <>
            <button
              type="button"
              className={`user-settings-nav__item ${activeSettingsSection === 'profile' ? 'user-settings-nav__item--active' : ''}`}
              onClick={() => changeSettingsSection('profile')}
            >
              <User size={16} />
              <span>Profile</span>
            </button>
            <button
              type="button"
              className={`user-settings-nav__item ${activeSettingsSection === 'appearance' ? 'user-settings-nav__item--active' : ''}`}
              onClick={() => changeSettingsSection('appearance')}
            >
              <Palette size={16} />
              <span>Appearance</span>
            </button>
            <button
              type="button"
              className={`user-settings-nav__item ${activeSettingsSection === 'communication' ? 'user-settings-nav__item--active' : ''}`}
              onClick={() => changeSettingsSection('communication')}
            >
              <MessageSquare size={16} />
              <span>Communication</span>
            </button>
            <button
              type="button"
              className={`user-settings-nav__item ${activeSettingsSection === 'voice' ? 'user-settings-nav__item--active' : ''}`}
              onClick={() => changeSettingsSection('voice')}
            >
              <Mic size={16} />
              <span>Voice & Audio</span>
            </button>
            <button
              type="button"
              className={`user-settings-nav__item ${activeSettingsSection === 'privacy' ? 'user-settings-nav__item--active' : ''}`}
              onClick={() => changeSettingsSection('privacy')}
            >
              <Shield size={16} />
              <span>Privacy & Data</span>
            </button>
            {isTauri() && (
              <button
                type="button"
                className={`user-settings-nav__item ${activeSettingsSection === 'desktop' ? 'user-settings-nav__item--active' : ''}`}
                onClick={() => changeSettingsSection('desktop')}
              >
                <Monitor size={16} />
                <span>Desktop</span>
              </button>
            )}
            <div className="user-settings-nav__footer">
              <button
                type="button"
                className="user-settings-nav__item user-settings-nav__item--external"
                onClick={() => void openAboutPage()}
                title="Open the Voxpery website"
              >
                <Info size={16} aria-hidden="true" />
                <span>About Voxpery</span>
                <ExternalLink size={14} aria-hidden="true" />
              </button>
            </div>
            </>
            )}
          </nav>
          <div className="user-settings-scroll" ref={settingsScrollRef}>
          {activeSettingsSection === 'appearance' && <ThemeSettings />}
          {activeSettingsSection === 'communication' && (
          <section className="user-settings-section">
            <h3 className="user-settings-section-title">Communication</h3>
            <div className="user-setting-row user-setting-row--span-two">
              <div>
                <div className="user-setting-title">Notification sounds</div>
                <div className="user-setting-desc">Play alert sounds for direct messages, mentions, and friend requests.</div>
              </div>
              <button
                type="button"
                className={`user-toggle ${soundEnabled ? 'active' : ''}`}
                aria-label="Notification sounds"
                aria-pressed={soundEnabled}
                onClick={() => {
                  const next = !soundEnabled
                  setSoundEnabled(next)
                  localStorage.setItem(SOUND_KEY, next ? '1' : '0')
                }}
              >
                {soundEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="user-setting-row user-setting-row--span-two">
              <div>
                <div className="user-setting-title">
                  {desktopRuntime ? 'Desktop notifications' : 'Browser notifications'}
                </div>
                <div className="user-setting-desc">
                  {pushNotificationPermission === 'unsupported'
                    ? 'This environment does not support system notifications.'
                    : pushNotificationPermission === 'denied'
                      ? 'Notifications are blocked in your browser or desktop shell.'
                      : `Show ${desktopRuntime ? 'desktop' : 'browser'} notifications for direct messages, friend requests, and selected server messages.`}
                </div>
              </div>
              <button
                type="button"
                className={`user-toggle ${pushNotificationsEnabled && pushNotificationPermission !== 'unsupported' && pushNotificationPermission !== 'denied' ? 'active' : ''}`}
                aria-label={desktopRuntime ? 'Desktop notifications' : 'Browser notifications'}
                aria-pressed={pushNotificationsEnabled && pushNotificationPermission !== 'unsupported' && pushNotificationPermission !== 'denied'}
                disabled={pushNotificationPermission === 'unsupported'}
                onClick={async () => {
                  if (!pushNotificationsEnabled || pushNotificationPermission !== 'granted') {
                    const permission = await requestPushNotificationPermission()
                    setPushNotificationPermission(permission)
                    if (permission === 'granted') {
                      setPushNotificationsEnabledState(true)
                      persistPushNotificationsEnabled(true, true)
                    }
                    return
                  }
                  setPushNotificationsEnabledState(false)
                  persistPushNotificationsEnabled(false, true)
                }}
              >
                {pushNotificationPermission === 'unsupported'
                  ? 'N/A'
                  : pushNotificationPermission === 'denied'
                    ? 'Blocked'
                    : pushNotificationsEnabled
                      ? 'On'
                      : 'Off'}
              </button>
            </div>
            <div className="user-setting-row user-setting-row--span-two">
              <div>
                <div className="user-setting-title">Server message notifications</div>
                <div className="user-setting-desc">
                  Choose which server messages can play sounds or show browser notifications. Muted channels only alert for direct mentions.
                </div>
              </div>
              <select
                className="user-select"
                value={serverNotificationPreference}
                aria-label="Server message notifications"
                onChange={(e) => {
                  const next = e.target.value as ServerNotificationPreference
                  setServerNotificationPreferenceState(next)
                  persistServerNotificationPreference(next)
                }}
              >
                {SERVER_NOTIFICATION_PREFERENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="user-setting-row user-setting-row--span-two">
              <div>
                <div className="user-setting-title">Who can send you DMs</div>
                <div className="user-setting-desc">Who can start a DM with you.</div>
              </div>
              <select
                className="user-select"
                value={dmPrivacy}
                aria-label="Who can send you DMs"
                onChange={async (e) => {
                  const previous = dmPrivacy
                  const next = e.target.value as 'everyone' | 'friends'
                  setDmPrivacy(next)
                  try {
                    const updated = await authApi.updateProfile({ dm_privacy: next }, token ?? null)
                    setUser(updated)
                  } catch {
                    setDmPrivacy(previous)
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
          )}
          {activeSettingsSection === 'voice' && (
          <section className="user-settings-section user-settings-section--voice">
            <h3 className="user-settings-section-title">Voice & Audio</h3>
            <div className="voice-settings-block">
              <div className="voice-settings-block__title">Audio devices</div>
              {!microphoneAccessAllowed && (
                <div className="voice-settings-banner">
                  <span>{microphoneRecoveryMessage}</span>
                  {showDesktopMicrophoneRecovery && (
                    <button
                      type="button"
                      className="user-toggle account-action-btn"
                      onClick={async () => {
                        const opened = await openDesktopMediaPermissionSettings('microphone')
                        if (!opened) {
                          pushToast({
                            level: 'info',
                            title: 'Open privacy settings',
                            message: microphoneRecoveryMessage,
                          })
                        }
                      }}
                    >
                      Open settings
                    </button>
                  )}
                  <button
                    type="button"
                    className="user-toggle account-action-btn"
                    disabled={voiceDevicesUnlocking}
                    onClick={() => void refreshVoiceDevices(true)}
                  >
                    {voiceDevicesUnlocking ? 'Allowing…' : microphoneAccessButtonLabel}
                  </button>
                </div>
              )}
              <div className="voice-settings-grid voice-settings-grid--two voice-settings-grid--audio">
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Microphone</div>
                  </div>
                  <div className="user-setting-actions user-setting-actions--device">
                    <button
                      ref={inputDeviceTriggerRef}
                      type="button"
                      className={`device-select-trigger ${openDeviceMenu === 'input' ? 'is-open' : ''}`}
                      title={currentInputDevice.fullLabel}
                      disabled={voiceDevicesLoading || voiceDevicesUnlocking || voiceDevicesNeedAccess}
                      onClick={() => toggleDeviceMenu('input')}
                    >
                      <span className="device-select-trigger__label">{currentInputDevice.label}</span>
                      <ChevronsUpDown size={15} strokeWidth={1.9} />
                    </button>
                  </div>
                </div>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Speaker</div>
                  </div>
                  <div className="user-setting-actions user-setting-actions--device">
                    <button
                      ref={outputDeviceTriggerRef}
                      type="button"
                      className={`device-select-trigger ${openDeviceMenu === 'output' ? 'is-open' : ''}`}
                      title={currentOutputDevice.fullLabel}
                      disabled={voiceDevicesLoading || voiceDevicesUnlocking || voiceDevicesNeedAccess || !canSelectOutputDevice}
                      onClick={() => toggleDeviceMenu('output')}
                    >
                      <span className="device-select-trigger__label">{currentOutputDevice.label}</span>
                      <ChevronsUpDown size={15} strokeWidth={1.9} />
                    </button>
                  </div>
                </div>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">
                      Input volume
                      <span className="voice-settings-inline-value">{inputVolume}%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={inputVolume}
                    aria-label="Input volume"
                    aria-valuetext={`${inputVolume}%`}
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
                    <div className="user-setting-title">
                      Output volume
                      <span className="voice-settings-inline-value">{outputVolume}%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={outputVolume}
                    aria-label="Output volume"
                    aria-valuetext={`${outputVolume}%`}
                    className="user-slider"
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      setOutputVolume(next)
                      localStorage.setItem(OUTPUT_VOL_KEY, String(next))
                      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="voice-settings-block">
              <div className="voice-settings-block__title">Input tuning</div>
              <div className="voice-settings-block__desc">Tune sensitivity and suppression for clearer voice pickup.</div>
              <div className="voice-settings-grid">
                <div className="user-setting-row user-setting-row-full user-setting-row--span-two">
                  <SensitivityBar
                    threshold={speakingThreshold}
                    preset={speakingPreset}
                    previewAvatarUrl={user?.avatar_url ?? null}
                    previewFallback={user ? getInitial(user.username) : '?'}
                    onThresholdChange={(v) => {
                      setSpeakingThreshold(v)
                      localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(v))
                      markVoiceProfileCustom()
                      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                    }}
                    onPresetChange={(preset) => {
                      setSpeakingPreset(preset)
                      localStorage.setItem(SPEAKING_PRESET_KEY, preset)
                      markVoiceProfileCustom()
                      if (preset !== 'custom') {
                        const threshold = thresholdByPreset(preset)
                        setSpeakingThreshold(threshold)
                        localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(threshold))
                      }
                      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                    }}
                  />
                </div>
                <div className="user-setting-row user-setting-row--span-two">
                  <div>
                    <div className="user-setting-title">Noise suppression</div>
                    <div className="user-setting-desc">
                      Removes background noise (keyboard, fan, etc.) from your mic signal in real time.
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`user-toggle ${noiseSuppressionEnabled ? 'active' : ''}`}
                    aria-label="Noise suppression"
                    aria-pressed={noiseSuppressionEnabled}
                    onClick={() => {
                      const next = !noiseSuppressionEnabled
                      setNoiseSuppressionEnabled(next)
                      localStorage.setItem(NOISE_SUPPRESSION_KEY, next ? '1' : '0')
                      markVoiceProfileCustom()
                      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                    }}
                  >
                    {noiseSuppressionEnabled ? 'On' : 'Off'}
                  </button>
                </div>
                <div className="user-setting-row user-setting-row--span-two">
                  <div>
                    <div className="user-setting-title">Activation mode</div>
                    <div className="user-setting-desc">Choose between automatic voice pickup and manual push-to-talk.</div>
                  </div>
                  <select
                    className="user-select"
                    value={voiceMode}
                    aria-label="Activation mode"
                    onChange={(e) => {
                      const next = e.target.value === 'push_to_talk' ? 'push_to_talk' : 'voice_activity'
                      setVoiceMode(next)
                      localStorage.setItem(VOICE_MODE_KEY, next)
                      markVoiceProfileCustom()
                      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                    }}
                  >
                    <option value="voice_activity">Voice Activity</option>
                    <option value="push_to_talk">Push to Talk</option>
                  </select>
                </div>
                {voiceMode === 'push_to_talk' && (
                  <div className="user-setting-row user-setting-row--span-two">
                    <div>
                      <div className="user-setting-title">Push-to-talk key</div>
                      <div className="user-setting-desc">
                        Current key: {pttKey}. {isTauri()
                          ? 'Works system-wide while Voxpery is running.'
                          : 'Works while this Voxpery tab is focused.'}
                      </div>
                      {pttShortcutError && (
                        <div className="pw-hint pw-hint-warn">{pttShortcutError}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className={`user-toggle ${capturingPtt ? 'active' : ''}`}
                      onClick={() => {
                        setPttShortcutError(null)
                        setCapturingPtt((v) => !v)
                      }}
                    >
                      {capturingPtt ? 'Press key...' : 'Rebind'}
                    </button>
                  </div>
                )}
                <div className="user-setting-row user-setting-row--span-two">
                  <div>
                    <div className="user-setting-title">Toggle microphone mute</div>
                    <div className="user-setting-desc">
                      {capturingGlobalMuteShortcut
                        ? 'Press a key. Press Escape to cancel.'
                        : `${formatGlobalMuteShortcut(globalMuteShortcut)}. ${
                          isTauri()
                            ? 'Keyboard shortcuts work system-wide while Voxpery is running.'
                            : 'Works while this Voxpery tab is focused.'
                        }`}
                    </div>
                    {globalMuteShortcutError && (
                      <div className="pw-hint pw-hint-warn">{globalMuteShortcutError}</div>
                    )}
                  </div>
                  <div className="user-setting-actions">
                    <button
                      type="button"
                      className={`user-toggle account-action-btn ${capturingGlobalMuteShortcut ? 'active' : ''}`}
                      onClick={() => {
                        setGlobalMuteShortcutError(null)
                        setCapturingGlobalMuteShortcut((current) => !current)
                      }}
                      disabled={globalMuteShortcutSaving}
                    >
                      {capturingGlobalMuteShortcut ? 'Press keys…' : globalMuteShortcut ? 'Rebind' : 'Set shortcut'}
                    </button>
                    {globalMuteShortcut && (
                      <button
                        type="button"
                        className="user-toggle account-action-btn"
                        onClick={() => void saveGlobalMuteShortcut(null)}
                        disabled={globalMuteShortcutSaving}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
          )}
          {activeSettingsSection === 'desktop' && isTauri() && (
          <section className="user-settings-section">
            <h3 className="user-settings-section-title">Desktop</h3>
            {isTauri() && (
              <>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">App updates</div>
                    <div className="user-setting-desc">
                      {desktopAppVersion ? `Installed version: ${desktopAppVersion}. ` : ''}
                      {updateChecked
                        ? updateInfo?.available
                          ? `Voxpery ${updateInfo.version} is available to install.`
                          : updatesManagedExternally
                            ? 'This Flatpak updates when you install the newer .flatpak file from the Voxpery releases page; your account and settings are kept.'
                          : updateInfo?.error
                            ? 'Could not check for new desktop releases right now.'
                          : 'Your desktop app is on the latest version.'
                        : 'Check for new desktop releases and install them without reinstalling.'}
                    </div>
                  </div>
                  <div className="user-setting-actions">
                    {updatesManagedExternally && (
                      <button
                        type="button"
                        className="user-toggle account-action-btn"
                        onClick={() => void openExternalUrl(VOXPERY_RELEASES_URL)}
                      >
                        Releases
                      </button>
                    )}
                    {!updatesManagedExternally && (
                      <button
                        type="button"
                        className="user-toggle account-action-btn"
                        onClick={() => void refreshUpdateStatus(true)}
                        disabled={updateChecking || updateInstalling}
                      >
                        {updateChecking ? 'Checking…' : 'Check now'}
                      </button>
                    )}
                    {updateInfo?.available && (
                      <button
                        type="button"
                        className="user-toggle account-action-btn"
                        onClick={() => void installDesktopUpdate()}
                        disabled={updateChecking || updateInstalling}
                      >
                        {updateInstalling ? 'Installing…' : `Install ${updateInfo.version}`}
                      </button>
                    )}
                  </div>
                </div>
                <div className="user-setting-row user-setting-row--stacked">
                  <div>
                    <div className="user-setting-title">Server</div>
                    <div className="user-setting-desc">
                      Voxpery connects to voxpery.com. You can connect to a self-hosted Voxpery server instead;
                      your account and sign-in there are separate.
                    </div>
                    <CustomServerPanel variant="settings" />
                  </div>
                </div>
                {desktopAutostartSupported && (
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Launch on startup</div>
                    <div className="user-setting-desc">{`Open Voxpery automatically when ${desktopStartupTargetLabel}.`}</div>
                  </div>
                  <button
                    type="button"
                    className={`user-toggle account-action-btn ${desktopAutostartEnabled ? 'active' : ''}`}
                    onClick={() => void toggleDesktopAutostart()}
                    disabled={desktopAutostartLoading}
                  >
                    {desktopAutostartLoading ? 'Saving…' : desktopAutostartEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
                )}
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Keep running in tray on close</div>
                    <div className="user-setting-desc">When disabled, closing the window fully exits the app and avoids installer file locks.</div>
                  </div>
                  <button
                    type="button"
                    className={`user-toggle account-action-btn ${minimizeToTrayOnCloseEnabled ? 'active' : ''}`}
                    onClick={() => void toggleMinimizeToTrayOnClose()}
                    disabled={minimizeToTrayLoading}
                  >
                    {minimizeToTrayLoading ? 'Saving…' : minimizeToTrayOnCloseEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </>
            )}
          </section>
          )}
          {activeSettingsSection === 'profile' && (
          <section className="user-settings-section user-settings-section--profile">
            <h3 className="user-settings-section-title">{avatarDraft ? 'Edit profile photo' : 'Profile'}</h3>
            {avatarDraft && <div className="profile-avatar-selection-feedback" aria-live="polite">
              {avatarSelectionError && <p role="alert">{avatarSelectionError}</p>}
            </div>}
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden
              onChange={(event) => {
                onPickProfileAvatar(event.currentTarget.files)
                event.currentTarget.value = ''
              }} />
            {avatarDraft && <ProfileAvatarEditor key={avatarDraft.key} file={avatarDraft.file}
              onChooseAnother={() => avatarInputRef.current?.click()}
              saveRef={avatarSaveRef}
              onCancel={() => { setAvatarDraft(null); setAvatarSelectionError(null) }}
              onSave={async (dataUrl) => {
                const saved = await updateProfileAvatar(dataUrl)
                if (saved) { setAvatarDraft(null); setAvatarSelectionError(null) }
                return saved
              }} />}
            {!avatarDraft && <>
            <div className="user-profile-preview-card">
              <div className="user-profile-preview-header">
                <div className={`user-profile-preview-avatar avatar-status-${(user?.status ?? 'online') as StatusValue}`} aria-hidden>
                  {user?.avatar_url ? (
                    <img src={resolveAvatarUrl(user.avatar_url) ?? ''} alt="" className="user-avatar-image" />
                  ) : (
                    user ? getInitial(user.username) : '?'
                  )}
                </div>
                <div className="user-profile-preview-meta">
                  <div className="user-profile-preview-eyebrow">Current profile</div>
                  <div className="user-profile-preview-name">{user?.username ?? 'Unknown user'}</div>
                  <div className="profile-status-actions" role="group" aria-label="Set status">
                    {(['online', 'dnd', 'invisible'] as const).map((status) => {
                      const isActive = (user?.status === 'offline' && status === 'invisible') || user?.status === status
                      return (
                        <button
                          key={status}
                          type="button"
                          className={`profile-status-btn profile-status-btn-${status} ${isActive ? 'is-active' : ''}`}
                          onClick={() => updateMyStatus(status)}
                          disabled={statusSaving}
                          aria-label={`Set status to ${statusLabel(status)}`}
                          aria-pressed={isActive}
                        >
                          <span className={`profile-status-btn-dot ${status}`} aria-hidden />
                          {footerStatusLabel(status)}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="user-profile-preview-actions">
                  <button type="button" className="user-toggle account-action-btn"
                    onClick={() => avatarInputRef.current?.click()}>
                    Upload
                  </button>
                  {user?.avatar_url && (
                    <button
                      type="button"
                      className="user-toggle account-action-btn"
                      onClick={() => void updateProfileAvatar(null)}
                    >
                      Remove
                    </button>
                  )}
                  {/* Sits under the photo actions on desktop so errors never move the profile. */}
                  <div className="profile-avatar-selection-feedback profile-avatar-selection-feedback--inline" aria-live="polite">
                    {avatarSelectionError && <p role="alert">{avatarSelectionError}</p>}
                  </div>
                </div>
              </div>
              <div className="user-profile-fields">
                <div className="user-profile-field">
                  <label className="user-profile-field-label" htmlFor="profile-about-me">About me</label>
                  <textarea
                    id="profile-about-me"
                    className="user-profile-textarea"
                    value={aboutMe}
                    onChange={(event) => setAboutMe(event.target.value.slice(0, 190))}
                    maxLength={190}
                    rows={3}
                    placeholder="Tell people a little about yourself"
                  />
                  <div className="user-profile-field-footer">
                    <span className="user-profile-field-count">{aboutMe.length}/190</span>
                    <button
                      type="button"
                      className="user-toggle user-profile-save-button"
                      onClick={() => void saveProfileDetails()}
                      disabled={profileDetailsSaving || aboutMe === (user?.about_me ?? '')}
                      aria-busy={profileDetailsSaving}
                    >
                      {profileDetailsSaving ? 'Saving...' : 'Save about me'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="user-setting-row">
              <div>
                <div className="user-setting-title">Username</div>
                <div className="user-setting-desc">Your display name. Letters, numbers, underscores, and periods.</div>
              </div>
              <button
                type="button"
                className="user-toggle account-action-btn"
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
                <div className="user-setting-title">Email address</div>
                <div className="user-setting-desc">
                  <strong>{user?.email ?? 'Unknown email'}</strong>
                  {' · '}
                  {user?.email_verified ? 'Verified' : 'Not verified'}
                </div>
                {!user?.email_verified && !emailVerificationEnabled && (
                  <div className="user-setting-desc">
                    Email verification is not available because this server has not configured email delivery.
                  </div>
                )}
              </div>
              <div className="user-setting-actions">
                {!user?.email_verified && emailVerificationEnabled && (
                  <button
                    type="button"
                    className="user-toggle account-action-btn"
                    onClick={resendEmailVerification}
                    disabled={emailVerificationSending}
                    aria-busy={emailVerificationSending}
                  >
                    {emailVerificationSending ? 'Sending...' : 'Verify'}
                  </button>
                )}
                {emailVerificationEnabled && (
                  <button
                    type="button"
                    className="user-toggle account-action-btn"
                    onClick={() => {
                      setEmailEdit(user?.email ?? '')
                      setEmailError(null)
                      setShowEmailModal(true)
                    }}
                  >
                    Change
                  </button>
                )}
              </div>
            </div>
            <div className="user-setting-row">
              <div>
                <div className="user-setting-title">Password</div>
                <div className="user-setting-desc">
                  {isGoogleOnlyAccount
                    ? 'Add a local password to sign in with email and password.'
                    : 'Update your account password.'}
                </div>
              </div>
              <button
                type="button"
                className="user-toggle account-action-btn"
                onClick={() => void openPasswordModal()}
              >
                {isGoogleOnlyAccount ? 'Set password' : 'Change'}
              </button>
            </div>
            <div className="user-setting-row user-setting-row--account-action">
              <div>
                <div className="user-setting-title">Log out</div>
                <div className="user-setting-desc">End this session and return to the login screen.</div>
              </div>
              <button
                type="button"
                className="user-toggle account-action-btn account-action-btn--danger"
                onClick={handleLogout}
              >
                <LogOut size={14} style={{ marginRight: 6 }} />
                Log out
              </button>
            </div>
            </>}
          </section>
          )}
          {activeSettingsSection === 'privacy' && (
          <section className="user-settings-section">
            <h3 className="user-settings-section-title">Privacy & Data</h3>
            <div className="user-setting-row">
              <div>
                <div className="user-setting-title">Data export</div>
                <div className="user-setting-desc">
                  Download a re-authenticated ZIP with your account, authored messages, avatar, and uploaded files. This bounded convenience archive is not a complete legal access response.
                </div>
              </div>
              <button
                type="button"
                className="user-toggle account-action-btn"
                onClick={() => {
                  setExportPassword('')
                  setExportError(null)
                  setShowExportModal(true)
                }}
                disabled={exportingData}
              >
                <Download size={14} style={{ marginRight: 6 }} />
                {exportingData ? 'Exporting…' : 'Export'}
              </button>
            </div>
            <div className="user-setting-row">
              <div>
                <div className="user-setting-title">Delete account</div>
                <div className="user-setting-desc">Permanently delete your account and related data.</div>
              </div>
              <button
                type="button"
                className="user-toggle account-action-btn"
                onClick={() => {
                  setDeletePassword('')
                  setDeleteConfirm('')
                  setDeleteError(null)
                  setShowDeleteModal(true)
                }}
              >
                <Trash2 size={14} style={{ marginRight: 6 }} />
                Manage
              </button>
            </div>
          </section>
          )}
          </div>
        </div>
        <footer className="user-settings-footer">
          <button
            type="button"
            className="btn btn-primary"
            onClick={requestCloseSettings}
          >
            Done
          </button>
        </footer>
        {/* Rendered inside the settings dialog so its focus trap and stacking include the prompt. */}
        {photoLeavePrompt && (
          <div className="settings-photo-leave-overlay" onMouseDown={() => setPhotoLeavePrompt(null)}>
            <div
              className="modal confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="photo-leave-title"
              aria-describedby="photo-leave-description"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h2 id="photo-leave-title">Save your new profile photo?</h2>
              <p id="photo-leave-description">You haven't saved the photo you're editing. Save it before leaving, or discard it.</p>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setPhotoLeavePrompt(null)}>Keep editing</button>
                <button type="button" className="btn btn-secondary" onClick={() => completePhotoLeave(photoLeavePrompt)}>Discard</button>
                <button type="button" className="btn btn-primary" autoFocus onClick={() => void saveAndCompletePhotoLeave(photoLeavePrompt)}>Save photo</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
