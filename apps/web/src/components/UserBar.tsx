import { Settings, ChevronsUpDown } from 'lucide-react'
import type { StatusValue } from './StatusIcon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { COMPACT_LAYOUT_MEDIA_QUERY } from '../layout'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { createPortal, flushSync } from 'react-dom'
import { useNavigate } from 'react-router'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { useFeatureStore } from '../stores/features'
import { useToastStore } from '../stores/toast'
import { isTauri } from '../secureStorage'
import { authApi, getAuthErrorMessage, getDesktopGoogleAuthUrl, getGoogleAuthUrl, resolveAvatarUrl } from '../api'
import { openExternalUrl } from '../openExternalUrl'
import { useSocketStore } from '../stores/socket'
import {
  DEFAULT_SPEAKING_PRESET,
  SPEAKING_PRESET_KEY,
  thresholdByPreset,
  type SpeakingPreset,
} from '../webrtc/sensitivityThreshold'
import UserSettingsWindow from './UserSettingsWindow'
import MemberProfileDialog from './MemberProfileDialog'
import { ROUTES } from '../routes'
import {
  DEFAULT_VOICE_INPUT_PROFILE,
  getStoredVoiceInputProfile,
  getStoredVoiceMode,
  getVoiceInputProfileConfig,
  isVoiceInputProfile,
  type VoiceInputProfile,
  VOICE_INPUT_PROFILE_KEY,
  VOICE_MODE_KEY,
} from '../webrtc/voiceInputProfile'
import {
  checkForUpdates,
  getDesktopAppVersion,
  downloadAndInstallUpdate,
  type UpdateResult,
} from '../updater'
import {
  bootstrapDesktopAutostartDefault,
  isDesktopAutostartSupported,
  getDesktopStartupTargetLabel,
  getDesktopAutostartEnabled,
  getStoredMinimizeToTrayOnCloseEnabled,
  setDesktopAutostartEnabled,
  setStoredDesktopAutostartPreference,
  setDesktopMinimizeToTrayOnClose,
} from '../desktopSettings'
import {
  canOpenDesktopMediaPermissionSettings,
  desktopMediaPermissionRecoveryMessage,
} from '../desktopMediaPermissions'
import {
  getPushNotificationPermission,
  getPushNotificationsEnabled,
} from '../pushNotifications'
import {
  getServerNotificationPreference,
  type ServerNotificationPreference,
} from '../notificationPreferences'
import {
  DEFAULT_INPUT_DEVICE_LABEL,
  DEFAULT_OUTPUT_DEVICE_LABEL,
  enumerateVoiceDevices,
  getMicrophonePermissionState,
  getStoredVoiceInputDeviceId,
  getStoredVoiceOutputDeviceId,
  requestVoiceDeviceAccess,
  supportsAudioOutputSelection,
  VOICE_INPUT_DEVICE_KEY,
  VOICE_OUTPUT_DEVICE_KEY,
  VOICE_DEVICE_PREFERENCES_CHANGED_EVENT,
  type MicrophonePermissionState,
  type VoiceDeviceOption,
} from '../voiceDevices'
import {
  applyGlobalMuteShortcut,
  formatGlobalMuteShortcut,
  getStoredGlobalMuteShortcut,
  registerDesktopGlobalMuteShortcut,
  setGlobalMuteShortcutCaptureActive,
  shortcutFromKeyboardEvent,
} from '../globalMuteShortcut'
import {
  pushToTalkShortcutFromKey,
  registerDesktopGlobalPushToTalk,
  setGlobalPushToTalkCaptureActive,
} from '../globalPushToTalk'
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
  type PhotoLeavePrompt,
  type SettingsSection,
  type VoiceDeviceMenu,
} from './userSettingsShared'
import AccountCredentialDialogs from './AccountCredentialDialogs'
import AccountDataDialogs from './AccountDataDialogs'
import { isValidEmailAddress } from './accountValidation'

const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024
const DEFAULT_INPUT_VOLUME = 80
const DEFAULT_OUTPUT_VOLUME = 80
const PTT_KEY_KEY = 'voxpery-settings-ptt-key'
const DEFAULT_INPUT_DEVICE_OPTION: VoiceDeviceOption = {
  id: '',
  label: DEFAULT_INPUT_DEVICE_LABEL,
  fullLabel: 'Windows default microphone',
}
const DEFAULT_OUTPUT_DEVICE_OPTION: VoiceDeviceOption = {
  id: '',
  label: DEFAULT_OUTPUT_DEVICE_LABEL,
  fullLabel: 'Windows default speaker',
}

const DEFAULT_SETTINGS_SECTION: SettingsSection = 'profile'

function mobilePopoverStatusLabel(status: 'online' | 'dnd' | 'invisible') {
  if (status === 'dnd') return 'Do Not Disturb'
  if (status === 'invisible') return 'Invisible'
  return 'Online'
}

function statusDescription(status: 'online' | 'dnd' | 'invisible') {
  if (status === 'dnd') return 'You will not receive notifications.'
  if (status === 'invisible') return 'You appear offline to others.'
  return null
}

function getEmailVerificationErrorMessage(err: unknown) {
  const message = getAuthErrorMessage(err).message
  if (!message || message === 'Internal server error') {
    return 'Email delivery is temporarily unavailable. Please try again later.'
  }
  return message
}

export default function UserBar({ compactSettingsTarget }: { compactSettingsTarget?: HTMLElement | null }) {
  const { user, token, setUserStatus, setUser, setAuth, logout } = useAuthStore()
  const features = useFeatureStore((s) => s.features)
  const emailVerificationEnabled = features?.email_verification_enabled === true
  const mobileSidebarPanel = useAppStore((s) => s.mobileSidebarPanel)
  const closeMobileSidebar = useAppStore((s) => s.closeMobileSidebar)
  const { disconnect } = useSocketStore()
  const navigate = useNavigate()
  const pushToast = useToastStore((s) => s.pushToast)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [pendingStatusMenuOpen, setPendingStatusMenuOpen] = useState(false)
  const [showOwnProfile, setShowOwnProfile] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(COMPACT_LAYOUT_MEDIA_QUERY).matches : false
  )
  const [openDeviceMenu, setOpenDeviceMenu] = useState<VoiceDeviceMenu | null>(null)
  const [deviceMenuAnchor, setDeviceMenuAnchor] = useState<{
    left: number
    width: number
    maxHeight: number
    top?: number
    bottom?: number
  } | null>(null)
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>(DEFAULT_SETTINGS_SECTION)
  const [statusSaving, setStatusSaving] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [pushNotificationsEnabled, setPushNotificationsEnabledState] = useState(true)
  const [pushNotificationPermission, setPushNotificationPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [serverNotificationPreference, setServerNotificationPreferenceState] = useState<ServerNotificationPreference>(() => getServerNotificationPreference())
  const [inputVolume, setInputVolume] = useState(DEFAULT_INPUT_VOLUME)
  const [outputVolume, setOutputVolume] = useState(DEFAULT_OUTPUT_VOLUME)
  const [inputDevices, setInputDevices] = useState<VoiceDeviceOption[]>([DEFAULT_INPUT_DEVICE_OPTION])
  const [outputDevices, setOutputDevices] = useState<VoiceDeviceOption[]>([DEFAULT_OUTPUT_DEVICE_OPTION])
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState(() => getStoredVoiceInputDeviceId())
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState(() => getStoredVoiceOutputDeviceId())
  const [voiceDevicesLoading, setVoiceDevicesLoading] = useState(false)
  const [voiceDevicesUnlocking, setVoiceDevicesUnlocking] = useState(false)
  const [voiceDevicesNeedAccess, setVoiceDevicesNeedAccess] = useState(false)
  const [microphonePermissionState, setMicrophonePermissionState] = useState<MicrophonePermissionState>('unsupported')
  const [canSelectOutputDevice, setCanSelectOutputDevice] = useState(() => supportsAudioOutputSelection())
  const [voiceMode, setVoiceMode] = useState<'voice_activity' | 'push_to_talk'>(() => getStoredVoiceMode())
  const [pttKey, setPttKey] = useState(() =>
    pushToTalkShortcutFromKey(typeof localStorage === 'undefined' ? null : localStorage.getItem(PTT_KEY_KEY)) ?? 'V'
  )
  const [capturingPtt, setCapturingPtt] = useState(false)
  const [pttShortcutError, setPttShortcutError] = useState<string | null>(null)
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(true)
  const [voiceInputProfile, setVoiceInputProfile] = useState<VoiceInputProfile>(() => getStoredVoiceInputProfile())
  const [dmPrivacy, setDmPrivacy] = useState<'everyone' | 'friends'>(
    user?.dm_privacy === 'everyone' || user?.dm_privacy === 'friends' ? user.dm_privacy : 'everyone'
  )
  const [aboutMe, setAboutMe] = useState(user?.about_me ?? '')
  const [profileDetailsSaving, setProfileDetailsSaving] = useState(false)
  const [avatarDraft, setAvatarDraft] = useState<{ file: File; key: number } | null>(null)
  const [photoLeavePrompt, setPhotoLeavePrompt] = useState<PhotoLeavePrompt | null>(null)
  const avatarSaveRef = useRef<(() => Promise<boolean>) | null>(null)
  const [avatarSelectionError, setAvatarSelectionError] = useState<string | null>(null)
  const avatarDraftKeyRef = useRef(0)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [speakingThreshold, setSpeakingThreshold] = useState(() => thresholdByPreset(DEFAULT_SPEAKING_PRESET))
  const [speakingPreset, setSpeakingPreset] = useState<SpeakingPreset>(DEFAULT_SPEAKING_PRESET)
  const [pwOld, setPwOld] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwShowOld, setPwShowOld] = useState(false)
  const [pwShowNew, setPwShowNew] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [exportingData, setExportingData] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportPassword, setExportPassword] = useState('')
  const [exportError, setExportError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteNeedsGoogleSignIn, setDeleteNeedsGoogleSignIn] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateResult | null>(null)
  const updatesManagedExternally = updateInfo?.available === false && updateInfo.managedExternally === true
  const [updateChecked, setUpdateChecked] = useState(false)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateInstalling, setUpdateInstalling] = useState(false)
  const [desktopAppVersion, setDesktopAppVersion] = useState<string | null>(null)
  const [desktopAutostartEnabled, setDesktopAutostartState] = useState(false)
  const [desktopAutostartSupported, setDesktopAutostartSupported] = useState(true)
  const [desktopAutostartLoading, setDesktopAutostartLoading] = useState(false)
  const [minimizeToTrayOnCloseEnabled, setMinimizeToTrayOnCloseEnabled] = useState(true)
  const [minimizeToTrayLoading, setMinimizeToTrayLoading] = useState(false)
  const [globalMuteShortcut, setGlobalMuteShortcut] = useState<string | null>(() => getStoredGlobalMuteShortcut())
  const [capturingGlobalMuteShortcut, setCapturingGlobalMuteShortcut] = useState(false)
  const [globalMuteShortcutSaving, setGlobalMuteShortcutSaving] = useState(false)
  const globalMuteShortcutSavingRef = useRef(false)
  const [globalMuteShortcutError, setGlobalMuteShortcutError] = useState<string | null>(null)
  const [showUsernameModal, setShowUsernameModal] = useState(false)
  const [usernameEdit, setUsernameEdit] = useState('')
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernameChecking, setUsernameChecking] = useState(false)
  const [usernameCheckFailed, setUsernameCheckFailed] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailEdit, setEmailEdit] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailNeedsGoogleSignIn, setEmailNeedsGoogleSignIn] = useState(false)
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailVerificationSending, setEmailVerificationSending] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const statusMenuRef = useRef<HTMLDivElement>(null)
  const deviceMenuRef = useRef<HTMLDivElement>(null)
  const usernameCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusToggleRef = useRef<HTMLDivElement>(null)
  const userBarWrapRef = useRef<HTMLDivElement>(null)
  const userPanelRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const profileButtonRef = useRef<HTMLButtonElement>(null)
  const settingsReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const settingsModalRef = useRef<HTMLDivElement>(null)
  const exportModalRef = useRef<HTMLDivElement>(null)
  const deleteModalRef = useRef<HTMLDivElement>(null)
  const emailModalRef = useRef<HTMLDivElement>(null)
  const usernameModalRef = useRef<HTMLDivElement>(null)
  const passwordModalRef = useRef<HTMLDivElement>(null)
  useDialogFocus(settingsModalRef, showSettingsPanel, deviceMenuRef, settingsReturnFocusRef)
  useDialogFocus(exportModalRef, showExportModal)
  useDialogFocus(deleteModalRef, showDeleteModal)
  useDialogFocus(emailModalRef, showEmailModal)
  useDialogFocus(usernameModalRef, showUsernameModal)
  useDialogFocus(passwordModalRef, showPwModal)
  const settingsScrollRef = useRef<HTMLDivElement>(null)
  const inputDeviceTriggerRef = useRef<HTMLButtonElement>(null)
  const outputDeviceTriggerRef = useRef<HTMLButtonElement>(null)
  const desktopStartupTargetLabel = getDesktopStartupTargetLabel()

  const markVoiceProfileCustom = useCallback(() => {
    if (voiceInputProfile === 'custom') return
    setVoiceInputProfile('custom')
    localStorage.setItem(VOICE_INPUT_PROFILE_KEY, 'custom')
  }, [voiceInputProfile])

  const closeStatusMenu = useCallback(() => {
    setShowStatusMenu(false)
    setStatusError(null)
  }, [])

  const closeDeviceMenu = useCallback(() => {
    setOpenDeviceMenu(null)
    setDeviceMenuAnchor(null)
  }, [])

  const closeExportModal = useCallback(() => {
    setShowExportModal(false)
    setExportPassword('')
    setExportError(null)
  }, [])

  const updateDeviceMenuAnchor = useCallback((menu: VoiceDeviceMenu) => {
    if (typeof window === 'undefined') return
    const trigger = menu === 'input' ? inputDeviceTriggerRef.current : outputDeviceTriggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const modalRect = settingsModalRef.current?.getBoundingClientRect()
    const viewportPadding = 8
    const leftBoundary = modalRect ? Math.max(viewportPadding, modalRect.left + 12) : viewportPadding
    const rightBoundary = modalRect ? Math.min(window.innerWidth - viewportPadding, modalRect.right - 12) : window.innerWidth - viewportPadding
    const width = Math.min(
      Math.max(rect.width, 280),
      Math.min(380, Math.max(rect.width, rightBoundary - leftBoundary)),
    )
    const left = Math.max(
      leftBoundary,
      Math.min(rect.left, rightBoundary - width),
    )
    const lowerBoundary = modalRect ? Math.min(window.innerHeight - viewportPadding, modalRect.bottom - 12) : window.innerHeight - viewportPadding
    const upperBoundary = modalRect ? Math.max(viewportPadding, modalRect.top + 12) : viewportPadding
    const availableBelow = lowerBoundary - rect.bottom - 6
    const availableAbove = rect.top - upperBoundary - 6
    const openAbove = availableBelow < 180 && availableAbove > availableBelow
    const maxHeight = Math.max(120, Math.min(280, (openAbove ? availableAbove : availableBelow)))

    setDeviceMenuAnchor(
      openAbove
        ? {
          left,
          width,
          maxHeight,
          bottom: Math.max(viewportPadding, window.innerHeight - rect.top + 6),
        }
        : {
          left,
          width,
          maxHeight,
          top: Math.min(rect.bottom + 6, lowerBoundary - maxHeight),
        },
    )
  }, [])

  const toggleDeviceMenu = useCallback((menu: VoiceDeviceMenu) => {
    if (openDeviceMenu === menu) {
      closeDeviceMenu()
      return
    }
    updateDeviceMenuAnchor(menu)
    setOpenDeviceMenu(menu)
  }, [closeDeviceMenu, openDeviceMenu, updateDeviceMenuAnchor])

  const updateMobileVoiceFooterBounds = useCallback(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (!isMobileViewport) {
      root.style.removeProperty('--mobile-callbar-left')
      root.style.removeProperty('--mobile-callbar-right')
      return
    }
    const userPanel = userPanelRef.current
    if (!userPanel) return
    const userPanelRect = userPanel.getBoundingClientRect()
    const left = Math.round(userPanelRect.right + 8)
    const right = 10
    if (window.innerWidth - right <= left) return
    root.style.setProperty('--mobile-callbar-left', `${left}px`)
    root.style.setProperty('--mobile-callbar-right', `${right}px`)
  }, [isMobileViewport])

  const toggleStatusMenu = () => {
    setStatusError(null)
    if (showStatusMenu) {
      closeStatusMenu()
      return
    }
    if (mobileSidebarPanel !== 'none') {
      setPendingStatusMenuOpen(true)
      closeMobileSidebar()
      return
    }
    setShowStatusMenu(true)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia(COMPACT_LAYOUT_MEDIA_QUERY)
    const sync = () => setIsMobileViewport(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  const refreshVoiceDevices = useCallback(async (unlockLabels = false) => {
    setVoiceDevicesLoading(true)
    try {
      let permissionState = await getMicrophonePermissionState()
      if (unlockLabels || permissionState === 'granted') {
        setVoiceDevicesUnlocking(true)
        await requestVoiceDeviceAccess()
        permissionState = await getMicrophonePermissionState()
      }
      const { inputs, outputs, canSelectOutput, labelsUnlocked } = await enumerateVoiceDevices()
      const devicesUnlocked = labelsUnlocked
      const effectivePermissionState: MicrophonePermissionState = devicesUnlocked
        ? 'granted'
        : permissionState === 'unsupported'
          ? 'prompt'
          : permissionState
      const resolvedInputs = devicesUnlocked ? inputs : [DEFAULT_INPUT_DEVICE_OPTION]
      const resolvedOutputs = devicesUnlocked ? outputs : [DEFAULT_OUTPUT_DEVICE_OPTION]
      const resolvedCanSelectOutput = devicesUnlocked && canSelectOutput

      setInputDevices(resolvedInputs)
      setOutputDevices(resolvedOutputs)
      setCanSelectOutputDevice(resolvedCanSelectOutput)
      setMicrophonePermissionState(effectivePermissionState)
      setVoiceDevicesNeedAccess(effectivePermissionState !== 'granted')

      const storedInput = getStoredVoiceInputDeviceId()
      const nextInput = storedInput && resolvedInputs.some((device) => device.id === storedInput) ? storedInput : ''
      if (storedInput !== nextInput) {
        if (nextInput) localStorage.setItem(VOICE_INPUT_DEVICE_KEY, nextInput)
        else localStorage.removeItem(VOICE_INPUT_DEVICE_KEY)
        window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
      }
      setSelectedInputDeviceId(nextInput)

      const storedOutput = getStoredVoiceOutputDeviceId()
      const nextOutput = resolvedCanSelectOutput && storedOutput && resolvedOutputs.some((device) => device.id === storedOutput)
        ? storedOutput
        : ''
      if (storedOutput !== nextOutput) {
        if (nextOutput) localStorage.setItem(VOICE_OUTPUT_DEVICE_KEY, nextOutput)
        else localStorage.removeItem(VOICE_OUTPUT_DEVICE_KEY)
        window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
      }
      setSelectedOutputDeviceId(nextOutput)
    } catch {
      setInputDevices([DEFAULT_INPUT_DEVICE_OPTION])
      setOutputDevices([DEFAULT_OUTPUT_DEVICE_OPTION])
      setCanSelectOutputDevice(supportsAudioOutputSelection())
      setMicrophonePermissionState('prompt')
      setVoiceDevicesNeedAccess(true)
    } finally {
      setVoiceDevicesUnlocking(false)
      setVoiceDevicesLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshVoiceDevices()
    const mediaDevices = navigator.mediaDevices
    const handleDeviceChange = () => {
      void refreshVoiceDevices()
    }
    mediaDevices?.addEventListener?.('devicechange', handleDeviceChange)
    return () => mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange)
  }, [refreshVoiceDevices])

  useEffect(() => {
    const handlePreferenceFallback = () => {
      setSelectedInputDeviceId(getStoredVoiceInputDeviceId())
      setSelectedOutputDeviceId(getStoredVoiceOutputDeviceId())
    }
    window.addEventListener(VOICE_DEVICE_PREFERENCES_CHANGED_EVENT, handlePreferenceFallback)
    return () => window.removeEventListener(VOICE_DEVICE_PREFERENCES_CHANGED_EVENT, handlePreferenceFallback)
  }, [])

  useEffect(() => {
    if (!showSettingsPanel || activeSettingsSection !== 'voice') return
    void refreshVoiceDevices()
  }, [activeSettingsSection, refreshVoiceDevices, showSettingsPanel])

  useEffect(() => {
    if (!showSettingsPanel || activeSettingsSection !== 'voice') return
    const handleRefresh = () => {
      void refreshVoiceDevices()
    }
    window.addEventListener('focus', handleRefresh)
    document.addEventListener('visibilitychange', handleRefresh)
    return () => {
      window.removeEventListener('focus', handleRefresh)
      document.removeEventListener('visibilitychange', handleRefresh)
    }
  }, [activeSettingsSection, refreshVoiceDevices, showSettingsPanel])

  useEffect(() => {
    if (!pendingStatusMenuOpen) return
    if (mobileSidebarPanel !== 'none') return
    const timer = window.setTimeout(() => {
      setShowStatusMenu(true)
      setPendingStatusMenuOpen(false)
    }, 260)
    return () => window.clearTimeout(timer)
  }, [mobileSidebarPanel, pendingStatusMenuOpen])

  const closeSettingsPanel = useCallback(() => {
    setAvatarDraft(null)
    setAvatarSelectionError(null)
    setPhotoLeavePrompt(null)
    setShowSettingsPanel(false)
  }, [])

  // Leaving the profile photo editor (closing settings or switching sections) asks first,
  // so an edited photo is never dropped silently.
  const requestCloseSettings = useCallback(() => {
    if (avatarDraft) {
      setPhotoLeavePrompt({ action: 'close' })
      return
    }
    closeSettingsPanel()
  }, [avatarDraft, closeSettingsPanel])

  const changeSettingsSection = useCallback((section: SettingsSection) => {
    if (avatarDraft && section !== activeSettingsSection) {
      setPhotoLeavePrompt({ action: 'section', section })
      return
    }
    setActiveSettingsSection(section)
  }, [activeSettingsSection, avatarDraft])

  const completePhotoLeave = useCallback((prompt: PhotoLeavePrompt) => {
    setPhotoLeavePrompt(null)
    if (prompt.action === 'close') {
      closeSettingsPanel()
      return
    }
    setAvatarDraft(null)
    setAvatarSelectionError(null)
    setActiveSettingsSection(prompt.section)
  }, [closeSettingsPanel])

  const saveAndCompletePhotoLeave = useCallback(async (prompt: PhotoLeavePrompt) => {
    const saved = await avatarSaveRef.current?.()
    if (saved) completePhotoLeave(prompt)
    else setPhotoLeavePrompt(null)
  }, [completePhotoLeave])

  useEffect(() => {
    if (activeSettingsSection !== 'profile') {
      setAvatarDraft(null)
      setAvatarSelectionError(null)
    }
  }, [activeSettingsSection])

  const handleLogout = useCallback(() => {
    closeSettingsPanel()
    closeStatusMenu()
    disconnect()
    logout()
    navigate(ROUTES.login, { replace: true })
  }, [closeSettingsPanel, closeStatusMenu, disconnect, logout, navigate])

  const openSettingsPanel = useCallback(() => {
    settingsReturnFocusRef.current = settingsButtonRef.current ?? profileButtonRef.current
    closeStatusMenu()
    setActiveSettingsSection(DEFAULT_SETTINGS_SECTION)
    setShowSettingsPanel(true)
  }, [closeStatusMenu])

  const openAboutPage = useCallback(async () => {
    const url = isTauri() ? 'https://voxpery.com/about' : new URL(ROUTES.about, window.location.origin).href
    try {
      await openExternalUrl(url)
    } catch {
      pushToast({ level: 'error', title: 'Could not open About Voxpery', message: 'Please try again.' })
    }
  }, [pushToast])

  const closeDeleteModal = useCallback(() => {
    setShowDeleteModal(false)
    setDeletePassword('')
    setDeleteConfirm('')
    setDeleteError(null)
  }, [])

  const closeUsernameModal = useCallback(() => {
    if (usernameCheckTimeoutRef.current) {
      clearTimeout(usernameCheckTimeoutRef.current)
      usernameCheckTimeoutRef.current = null
    }
    setShowUsernameModal(false)
    setUsernameEdit('')
    setUsernameError(null)
    setUsernameAvailable(null)
  }, [])

  const closeEmailModal = useCallback(() => {
    setEmailSaving(false)
    setEmailError(null)
    setShowEmailModal(false)
    setEmailEdit('')
    setEmailPassword('')
    setEmailNeedsGoogleSignIn(false)
  }, [])

  const closePasswordModal = useCallback(() => {
    setShowPwModal(false)
    setPwOld('')
    setPwNew('')
    setPwConfirm('')
    setPwError(null)
    setPwSuccess(false)
    setPwShowOld(false)
    setPwShowNew(false)
  }, [])

  useEffect(() => {
    const sound = localStorage.getItem(SOUND_KEY)
    const input = localStorage.getItem(INPUT_VOL_KEY)
    const output = localStorage.getItem(OUTPUT_VOL_KEY)
    const storedMode = localStorage.getItem(VOICE_MODE_KEY)
    const mode = getStoredVoiceMode()
    const ptt = localStorage.getItem(PTT_KEY_KEY)
    const ns = localStorage.getItem(NOISE_SUPPRESSION_KEY)
    const speaking = localStorage.getItem(SPEAKING_THRESHOLD_KEY)
    const preset = localStorage.getItem(SPEAKING_PRESET_KEY)
    const profileRaw = localStorage.getItem(VOICE_INPUT_PROFILE_KEY)
    if (sound != null) setSoundEnabled(sound === '1')
    setServerNotificationPreferenceState(getServerNotificationPreference())
    const enabled = getPushNotificationsEnabled()
    setPushNotificationsEnabledState(enabled)
    setPushNotificationPermission(getPushNotificationPermission())
    if (input != null) setInputVolume(Math.min(100, Math.max(1, Number(input) || DEFAULT_INPUT_VOLUME)))
    if (output != null) setOutputVolume(Math.min(100, Math.max(1, Number(output) || DEFAULT_OUTPUT_VOLUME)))
    setVoiceMode(mode)
    const storedPttShortcut = pushToTalkShortcutFromKey(ptt)
    if (storedPttShortcut) setPttKey(storedPttShortcut)
    if (ns != null) {
      setNoiseSuppressionEnabled(ns === '1')
    } else {
      setNoiseSuppressionEnabled(true)
      try {
        localStorage.setItem(NOISE_SUPPRESSION_KEY, '1')
      } catch {
        // ignore storage errors
      }
    }
    try {
      localStorage.removeItem('voxpery-settings-voice-join-confirm')
    } catch {
      // ignore storage errors
    }
    if (speaking != null) {
      setSpeakingThreshold(Math.min(100, Math.max(0, Number(speaking) || thresholdByPreset(DEFAULT_SPEAKING_PRESET))))
    } else {
      setSpeakingThreshold(thresholdByPreset(DEFAULT_SPEAKING_PRESET))
    }
    const resolvedPreset: SpeakingPreset | null =
      preset === 'quiet'
        ? 'normal'
        : (preset === 'normal' || preset === 'noisy' || preset === 'custom' ? preset : null)

    if (resolvedPreset) {
      setSpeakingPreset(resolvedPreset)
      if (speaking == null && resolvedPreset !== 'custom') {
        setSpeakingThreshold(thresholdByPreset(resolvedPreset))
      }
      if (preset === 'quiet') {
        try {
          localStorage.setItem(SPEAKING_PRESET_KEY, 'normal')
          if (speaking == null) {
            localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(thresholdByPreset('normal')))
          }
          window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
        } catch {
          // ignore storage errors
        }
      }
    } else {
      setSpeakingPreset(DEFAULT_SPEAKING_PRESET)
      setSpeakingThreshold(thresholdByPreset(DEFAULT_SPEAKING_PRESET))
      try {
        localStorage.setItem(SPEAKING_PRESET_KEY, DEFAULT_SPEAKING_PRESET)
        localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(thresholdByPreset(DEFAULT_SPEAKING_PRESET)))
        window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
      } catch {
        // ignore storage errors
      }
    }
    if (isVoiceInputProfile(profileRaw)) {
      setVoiceInputProfile(profileRaw)
      if (profileRaw !== 'custom') {
        const defaults = getVoiceInputProfileConfig(profileRaw)
        setVoiceMode(defaults.voiceMode)
        setNoiseSuppressionEnabled(defaults.noiseSuppressionEnabled)
        setSpeakingPreset(defaults.speakingPreset)
        setSpeakingThreshold(defaults.speakingThreshold)
        try {
          localStorage.setItem(VOICE_MODE_KEY, defaults.voiceMode)
          localStorage.setItem(NOISE_SUPPRESSION_KEY, defaults.noiseSuppressionEnabled ? '1' : '0')
          localStorage.setItem(SPEAKING_PRESET_KEY, defaults.speakingPreset)
          localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(defaults.speakingThreshold))
          window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
        } catch {
          // ignore storage errors
        }
      }
    } else {
      const hasExplicitLegacyVoiceSettings =
        storedMode != null || ns != null || preset != null || speaking != null
      const inferredProfile = hasExplicitLegacyVoiceSettings ? 'custom' : DEFAULT_VOICE_INPUT_PROFILE
      setVoiceInputProfile(inferredProfile)
      try {
        localStorage.setItem(VOICE_INPUT_PROFILE_KEY, inferredProfile)
        if (!hasExplicitLegacyVoiceSettings && inferredProfile !== 'custom') {
          const defaults = getVoiceInputProfileConfig(inferredProfile)
          setVoiceMode(defaults.voiceMode)
          setNoiseSuppressionEnabled(defaults.noiseSuppressionEnabled)
          setSpeakingPreset(defaults.speakingPreset)
          setSpeakingThreshold(defaults.speakingThreshold)
          localStorage.setItem(VOICE_MODE_KEY, defaults.voiceMode)
          localStorage.setItem(NOISE_SUPPRESSION_KEY, defaults.noiseSuppressionEnabled ? '1' : '0')
          localStorage.setItem(SPEAKING_PRESET_KEY, defaults.speakingPreset)
          localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(defaults.speakingThreshold))
          window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
        }
      } catch {
        // ignore storage errors
      }
    }
  }, [])

  useEffect(() => {
    if (!showStatusMenu) return
    updateMobileVoiceFooterBounds()
    const close = (evt: PointerEvent) => {
      const target = evt.target as Node | null
      if (target && statusMenuRef.current?.contains(target)) return
      if (target && statusToggleRef.current?.contains(target)) return
      setShowStatusMenu(false)
      setStatusError(null)
    }
    const refreshAnchor = () => updateMobileVoiceFooterBounds()
    if (!isMobileViewport) {
      window.addEventListener('pointerdown', close)
    }
    window.addEventListener('resize', refreshAnchor)
    window.addEventListener('scroll', refreshAnchor, true)
    return () => {
      if (!isMobileViewport) {
        window.removeEventListener('pointerdown', close)
      }
      window.removeEventListener('resize', refreshAnchor)
      window.removeEventListener('scroll', refreshAnchor, true)
    }
  }, [isMobileViewport, showStatusMenu, updateMobileVoiceFooterBounds])

  useEffect(() => {
    updateMobileVoiceFooterBounds()
    return () => {
      if (typeof document === 'undefined') return
      document.documentElement.style.removeProperty('--mobile-callbar-left')
      document.documentElement.style.removeProperty('--mobile-callbar-right')
    }
  }, [isMobileViewport, updateMobileVoiceFooterBounds, user?.status, user?.username, showSettingsPanel])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const refresh = () => updateMobileVoiceFooterBounds()
    window.addEventListener('resize', refresh)
    window.addEventListener('orientationchange', refresh)
    return () => {
      window.removeEventListener('resize', refresh)
      window.removeEventListener('orientationchange', refresh)
    }
  }, [updateMobileVoiceFooterBounds])

  useEffect(() => {
    if (!capturingPtt) return
    setGlobalPushToTalkCaptureActive(true)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setPttShortcutError(null)
        setCapturingPtt(false)
        return
      }
      e.preventDefault()
      const key = e.key?.length === 1 ? e.key.toUpperCase() : e.key
      if (!key) return
      const shortcut = pushToTalkShortcutFromKey(key)
      if (!shortcut) {
        setPttShortcutError('Choose a letter, number, function key, Space, or navigation key.')
        return
      }
      if (shortcut === globalMuteShortcut) {
        setPttShortcutError('This key already toggles microphone mute. Choose another key.')
        return
      }
      setPttKey(shortcut)
      setPttShortcutError(null)
      localStorage.setItem(PTT_KEY_KEY, shortcut)
      markVoiceProfileCustom()
      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
      setCapturingPtt(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      setGlobalPushToTalkCaptureActive(false)
    }
  }, [capturingPtt, globalMuteShortcut, markVoiceProfileCustom])

  useEffect(() => {
    setDmPrivacy(user?.dm_privacy === 'everyone' || user?.dm_privacy === 'friends' ? user.dm_privacy : 'everyone')
  }, [user?.dm_privacy])

  useEffect(() => {
    setAboutMe(user?.about_me ?? '')
  }, [user?.about_me])

  useEffect(() => {
    if (!showSettingsPanel && !showStatusMenu && !showExportModal && !showDeleteModal && !showUsernameModal && !showEmailModal && !showPwModal && !openDeviceMenu) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (photoLeavePrompt) {
        setPhotoLeavePrompt(null)
        return
      }
      if (openDeviceMenu) {
        closeDeviceMenu()
        return
      }
      if (showExportModal) {
        closeExportModal()
        return
      }
      if (showDeleteModal) {
        closeDeleteModal()
        return
      }
      if (showUsernameModal) {
        closeUsernameModal()
        return
      }
      if (showEmailModal) {
        closeEmailModal()
        return
      }
      if (showPwModal) {
        closePasswordModal()
        return
      }
      if (showSettingsPanel) {
        requestCloseSettings()
        return
      }
      if (showStatusMenu) {
        closeStatusMenu()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    photoLeavePrompt,
    requestCloseSettings,
    closeDeleteModal,
    closeDeviceMenu,
    closeEmailModal,
    closeExportModal,
    closePasswordModal,
    closeSettingsPanel,
    closeStatusMenu,
    closeUsernameModal,
    openDeviceMenu,
    showDeleteModal,
    showExportModal,
    showEmailModal,
    showPwModal,
    showSettingsPanel,
    showStatusMenu,
    showUsernameModal,
  ])

  useEffect(() => {
    if (!showSettingsPanel) return
    if (!isTauri() && activeSettingsSection === 'desktop') {
      setActiveSettingsSection('profile')
    }
  }, [activeSettingsSection, showSettingsPanel])

  useEffect(() => {
    if (showSettingsPanel) return
    if (capturingPtt) setCapturingPtt(false)
    if (capturingGlobalMuteShortcut) setCapturingGlobalMuteShortcut(false)
  }, [capturingGlobalMuteShortcut, capturingPtt, showSettingsPanel])

  useEffect(() => {
    if (!showSettingsPanel || activeSettingsSection !== 'voice') {
      closeDeviceMenu()
    }
  }, [activeSettingsSection, closeDeviceMenu, showSettingsPanel])

  useEffect(() => {
    if (!openDeviceMenu) return
    const trigger = openDeviceMenu === 'input' ? inputDeviceTriggerRef.current : outputDeviceTriggerRef.current
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (deviceMenuRef.current?.contains(target) || trigger?.contains(target)) return
      closeDeviceMenu()
    }
    const onWindowChange = () => closeDeviceMenu()
    const scrollHost = settingsScrollRef.current
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('resize', onWindowChange)
    scrollHost?.addEventListener('scroll', onWindowChange, { passive: true })
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('resize', onWindowChange)
      scrollHost?.removeEventListener('scroll', onWindowChange)
    }
  }, [closeDeviceMenu, openDeviceMenu])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const run = async () => {
      const [result, currentVersion] = await Promise.all([
        checkForUpdates(),
        getDesktopAppVersion(),
      ])
      if (cancelled) return
      setUpdateInfo(result)
      setDesktopAppVersion(currentVersion)
      setUpdateChecked(true)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const run = async () => {
      setDesktopAutostartLoading(true)
      setMinimizeToTrayLoading(true)
      try {
        const trayEnabled = getStoredMinimizeToTrayOnCloseEnabled()
        const autostartSupported = await isDesktopAutostartSupported()
        const defaultEnabled = autostartSupported ? await bootstrapDesktopAutostartDefault() : null
        const autostartEnabled = autostartSupported && (defaultEnabled ?? await getDesktopAutostartEnabled())
        await setDesktopMinimizeToTrayOnClose(trayEnabled)
        if (cancelled) return
        setDesktopAutostartSupported(autostartSupported)
        setDesktopAutostartState(autostartEnabled)
        setMinimizeToTrayOnCloseEnabled(trayEnabled)
      } finally {
        if (!cancelled) {
          setDesktopAutostartLoading(false)
          setMinimizeToTrayLoading(false)
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isTauri() || !globalMuteShortcut) return
    if (voiceMode === 'push_to_talk' && globalMuteShortcut === pttKey) {
      void registerDesktopGlobalMuteShortcut(null)
      setGlobalMuteShortcutError('This key is also assigned to push-to-talk. Choose another shortcut.')
      return
    }
    void registerDesktopGlobalMuteShortcut(globalMuteShortcut).catch(() => {
      setGlobalMuteShortcutError('This shortcut could not be registered. It may be used by another application.')
    })
  }, [globalMuteShortcut, pttKey, voiceMode])

  useEffect(() => {
    if (!isTauri()) return
    const key = voiceMode === 'push_to_talk' ? pttKey : null
    void registerDesktopGlobalPushToTalk(key).catch(() => {
      setPttShortcutError('This key could not be registered system-wide. It may be used by another application.')
    })
  }, [pttKey, voiceMode])

  useEffect(() => () => {
    void registerDesktopGlobalPushToTalk(null)
  }, [])

  const saveGlobalMuteShortcut = useCallback(async (shortcut: string | null) => {
    if (globalMuteShortcutSavingRef.current) return
    if (voiceMode === 'push_to_talk' && shortcut === pttKey) {
      setGlobalMuteShortcutError('This key is also assigned to push-to-talk. Choose another shortcut.')
      return
    }
    globalMuteShortcutSavingRef.current = true
    setGlobalMuteShortcutSaving(true)
    setGlobalMuteShortcutError(null)
    try {
      await applyGlobalMuteShortcut(shortcut)
      setGlobalMuteShortcut(shortcut)
      setCapturingGlobalMuteShortcut(false)
      pushToast({
        level: 'info',
        title: shortcut ? 'Mute shortcut updated' : 'Mute shortcut cleared',
        message: shortcut
          ? `${formatGlobalMuteShortcut(shortcut)} is ready to toggle your microphone.`
          : isTauri()
            ? 'The global microphone shortcut is no longer assigned.'
            : 'The microphone shortcut for this tab is no longer assigned.',
      })
    } catch {
      setGlobalMuteShortcutError('This shortcut is unavailable. Choose another combination.')
    } finally {
      globalMuteShortcutSavingRef.current = false
      setGlobalMuteShortcutSaving(false)
    }
  }, [pttKey, pushToast, voiceMode])

  useEffect(() => {
    if (!capturingGlobalMuteShortcut) return
    setGlobalMuteShortcutCaptureActive(true)
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat || globalMuteShortcutSavingRef.current) return
      if (event.key === 'Escape') {
        setCapturingGlobalMuteShortcut(false)
        setGlobalMuteShortcutError(null)
        return
      }
      const shortcut = shortcutFromKeyboardEvent(event)
      if (!shortcut) {
        setGlobalMuteShortcutError('Choose a letter, number, function key, or a shortcut with modifiers.')
        return
      }
      void saveGlobalMuteShortcut(shortcut)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      setGlobalMuteShortcutCaptureActive(false)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [capturingGlobalMuteShortcut, saveGlobalMuteShortcut])

  const updateMyStatus = async (status: 'online' | 'dnd' | 'invisible') => {
    if (isTauri() && !token) return
    flushSync(() => {
      setShowStatusMenu(false)
      setStatusError(null)
    })
    setStatusSaving(true)
    try {
      const updated = await authApi.updateStatus(status, token ?? null)
      setUserStatus(updated.status)
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : 'Failed to update status')
      setShowStatusMenu(true)
    } finally {
      setStatusSaving(false)
    }
  }

  const updateProfileAvatar = async (avatarUrl: string | null): Promise<boolean> => {
    if (isTauri() && !token) return false
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
      return true
    } catch (err) {
      console.error('Failed to update profile avatar:', err)
      pushToast({
        level: 'error',
        title: avatarUrl ? 'Profile photo update failed' : 'Profile photo removal failed',
        message: err instanceof Error ? err.message : 'Could not update your profile photo.',
      })
      return false
    }
  }

  const saveProfileDetails = async () => {
    if (isTauri() && !token) return
    setProfileDetailsSaving(true)
    try {
      const updated = await authApi.updateProfile(
        {
          about_me: aboutMe,
        },
        token ?? null,
      )
      setUser(updated)

      const appStore = useAppStore.getState()
      appStore.setMembers(
        appStore.members.map((member) =>
          member.user_id === updated.id
            ? {
              ...member,
              about_me: updated.about_me ?? '',
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
                about_me: updated.about_me ?? '',
              }
              : member,
          ),
        )
      })

      pushToast({
        level: 'info',
        title: 'Profile updated',
        message: 'Your profile details are visible to members of your shared servers.',
      })
    } catch (err) {
      pushToast({
        level: 'error',
        title: 'Profile update failed',
        message: err instanceof Error ? err.message : 'Could not update your profile details.',
      })
    } finally {
      setProfileDetailsSaving(false)
    }
  }

  const onPickProfileAvatar = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
      setAvatarSelectionError('Choose a JPEG, PNG, WebP, GIF, or AVIF image.')
      return
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      const maxMb = Math.round(MAX_PROFILE_IMAGE_BYTES / (1024 * 1024))
      setAvatarSelectionError(`Profile photo must be ${maxMb} MB or smaller.`)
      return
    }
    setAvatarSelectionError(null)
    avatarDraftKeyRef.current += 1
    setAvatarDraft({ file, key: avatarDraftKeyRef.current })
  }

  const exportMyData = async () => {
    if (isTauri() && !token) return
    setExportingData(true)
    setExportError(null)
    try {
      const { blob, filename } = await authApi.exportData(
        token ?? null,
        exportPassword.trim() || undefined,
      )
      const url = URL.createObjectURL(blob)
      const date = new Date().toISOString().slice(0, 10)
      const link = document.createElement('a')
      link.href = url
      link.download = filename ?? `voxpery-data-export-${date}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      setShowExportModal(false)
      setExportPassword('')
      pushToast({
        level: 'info',
        title: 'Data export ready',
        message: 'Your protected account archive has been downloaded as a ZIP file.',
      })
    } catch (err: unknown) {
      const { message, code } = getAuthErrorMessage(err)
      setExportError(
        code === 'REAUTH_REQUIRED' && isGoogleOnlyAccount
          ? 'Sign in with Google again, then return here to create the archive.'
          : message || 'Could not export account data.',
      )
    } finally {
      setExportingData(false)
    }
  }

  const reauthenticateGoogleForExport = async () => {
    const redirectPath = window.location.pathname
    if (isTauri()) {
      const url = await getDesktopGoogleAuthUrl(redirectPath)
      await openExternalUrl(url)
      return
    }
    window.location.assign(getGoogleAuthUrl(redirectPath))
  }

  const refreshUpdateStatus = async (manual = false) => {
    setUpdateChecking(true)
    try {
      const result = await checkForUpdates()
      setUpdateInfo(result)
      setUpdateChecked(true)
      if (manual) {
        pushToast({
          level: result.available ? 'info' : result.error ? 'error' : 'info',
          title: result.available ? 'Update found' : result.error ? 'Update check failed' : 'You are up to date',
          message: result.available
            ? `Voxpery ${result.version} is available for installation.`
            : result.error
              ? 'Could not check for a new desktop release right now. Try again later.'
              : 'No newer desktop release is available right now.',
        })
      }
    } finally {
      setUpdateChecking(false)
    }
  }

  const installDesktopUpdate = async () => {
    setUpdateInstalling(true)
    try {
      const ok = await downloadAndInstallUpdate()
      if (!ok) {
        pushToast({
          level: 'error',
          title: 'Update failed',
          message: 'Could not download or install the desktop update. Try again later.',
        })
        return
      }
      pushToast({
        level: 'info',
        title: 'Installing update',
        message: 'Voxpery will restart after the update is applied.',
      })
    } finally {
      setUpdateInstalling(false)
    }
  }

  const toggleDesktopAutostart = async () => {
    if (desktopAutostartLoading) return
    const next = !desktopAutostartEnabled
    setDesktopAutostartLoading(true)
    try {
      await setDesktopAutostartEnabled(next)
      await setStoredDesktopAutostartPreference(next)
      setDesktopAutostartState(next)
      pushToast({
        level: 'info',
        title: next ? 'Launch on startup enabled' : 'Launch on startup disabled',
        message: next
          ? `Voxpery will open automatically when ${desktopStartupTargetLabel}.`
          : `Voxpery will no longer open automatically when ${desktopStartupTargetLabel}.`,
      })
    } catch {
      pushToast({
        level: 'error',
        title: 'Startup setting failed',
        message: 'Could not update the desktop startup preference.',
      })
    } finally {
      setDesktopAutostartLoading(false)
    }
  }

  const toggleMinimizeToTrayOnClose = async () => {
    if (minimizeToTrayLoading) return
    const next = !minimizeToTrayOnCloseEnabled
    setMinimizeToTrayLoading(true)
    try {
      await setDesktopMinimizeToTrayOnClose(next)
      setMinimizeToTrayOnCloseEnabled(next)
      pushToast({
        level: 'info',
        title: next ? 'Tray mode enabled' : 'Tray mode disabled',
        message: next
          ? 'Closing the window will keep Voxpery running in the system tray.'
          : 'Closing the window will fully exit Voxpery, which is safer for installs and updates.',
      })
    } catch {
      pushToast({
        level: 'error',
        title: 'Close behavior failed',
        message: 'Could not update the desktop close behavior.',
      })
    } finally {
      setMinimizeToTrayLoading(false)
    }
  }

  const submitDeleteAccount = async () => {
    if (isTauri() && !token) return
    setDeleteSubmitting(true)
    setDeleteError(null)
    setDeleteNeedsGoogleSignIn(false)
    try {
      await authApi.deleteAccount(
        {
          confirm: deleteConfirm,
          password: deletePassword.trim() ? deletePassword : undefined,
        },
        token ?? null,
      )
      setShowDeleteModal(false)
      disconnect()
      logout()
      navigate(ROUTES.login, { replace: true })
    } catch (err: unknown) {
      const { message, code } = getAuthErrorMessage(err)
      if (code === 'REAUTH_REQUIRED' && isGoogleOnlyAccount) {
        setDeleteNeedsGoogleSignIn(true)
        setDeleteError('Sign in with Google again, then return here to delete your account.')
      } else {
        setDeleteError(message || 'Could not process account deletion request.')
      }
    } finally {
      setDeleteSubmitting(false)
    }
  }

  const openPasswordModal = async () => {
    setPwOld('')
    setPwNew('')
    setPwConfirm('')
    setPwError(null)
    setPwSuccess(false)
    setShowPwModal(true)
    try {
      const freshUser = await authApi.getMe(token ?? null)
      setUser(freshUser)
    } catch {
      // Modal can still open with current in-memory user state.
    }
  }

  const requestEmailVerification = async (nextEmail?: string, currentPassword?: string) => {
    if (isTauri() && !token) return
    if (!emailVerificationEnabled) {
      throw new Error('FEATURE_DISABLED:Email verification is disabled on this server.')
    }
    const updated = await authApi.requestEmailVerification(token ?? null, nextEmail, currentPassword)
    setUser(updated)
    return updated
  }

  const submitEmailChange = async () => {
    const trimmed = emailEdit.trim().toLowerCase()
    if (!isValidEmailAddress(trimmed)) {
      setEmailError('Enter a valid email address.')
      return
    }
    const changing = trimmed !== (user?.email ?? '').toLowerCase()
    if (changing && !isGoogleOnlyAccount && !emailPassword) {
      setEmailError('Enter your current password to change your email address.')
      return
    }
    setEmailSaving(true)
    setEmailError(null)
    setEmailNeedsGoogleSignIn(false)
    try {
      const updated = await requestEmailVerification(trimmed, changing ? emailPassword : undefined)
      closeEmailModal()
      pushToast({
        level: 'info',
        title: !changing && updated?.email_verified ? 'Email already verified' : 'Verification email sent',
        message: changing
          ? `We sent a confirmation link to ${trimmed}. Your email changes after you open it.`
          : updated?.email_verified
            ? 'Your email address is already verified.'
            : `We sent a verification link to ${trimmed}.`,
      })
    } catch (err: unknown) {
      const { code } = getAuthErrorMessage(err)
      if (code === 'REAUTH_REQUIRED' && isGoogleOnlyAccount) {
        setEmailNeedsGoogleSignIn(true)
        setEmailError('Sign in with Google again, then return here to change your email.')
      } else {
        setEmailError(getEmailVerificationErrorMessage(err))
      }
      setEmailSaving(false)
    }
  }

  const resendEmailVerification = async () => {
    if (emailVerificationSending) return
    setEmailVerificationSending(true)
    try {
      const updated = await requestEmailVerification()
      pushToast({
        level: 'info',
        title: updated?.email_verified ? 'Email already verified' : 'Verification email sent',
        message: updated?.email_verified
          ? 'Your email address is already verified.'
          : `We sent a verification link to ${updated?.email ?? user?.email}.`,
      })
    } catch (err: unknown) {
      pushToast({
        level: 'error',
        title: 'Verification email failed',
        message: getEmailVerificationErrorMessage(err),
      })
    } finally {
      setEmailVerificationSending(false)
    }
  }

  const isGoogleOnlyAccount = user?.google_connected === true && user?.has_password !== true
  const currentInputDevice = inputDevices.find((device) => device.id === selectedInputDeviceId) ?? DEFAULT_INPUT_DEVICE_OPTION
  const currentOutputDevice = outputDevices.find((device) => device.id === selectedOutputDeviceId) ?? DEFAULT_OUTPUT_DEVICE_OPTION
  const microphoneAccessAllowed = microphonePermissionState === 'granted'
  const microphoneAccessButtonLabel = microphonePermissionState === 'denied' ? 'Retry mic access' : 'Allow mic access'
  const microphoneRecoveryMessage = microphonePermissionState === 'denied'
    ? desktopMediaPermissionRecoveryMessage('microphone')
    : 'Allow microphone access to unlock full voice controls.'
  const showDesktopMicrophoneRecovery = canOpenDesktopMediaPermissionSettings() && microphonePermissionState === 'denied'
  const desktopRuntime = isTauri()

  const voiceDeviceMenu = openDeviceMenu && deviceMenuAnchor && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={deviceMenuRef}
        id="settings-voice-device-menu"
        className="device-select-menu"
        style={{
          left: `${deviceMenuAnchor.left}px`,
          width: `${deviceMenuAnchor.width}px`,
          maxHeight: `${deviceMenuAnchor.maxHeight}px`,
          top: deviceMenuAnchor.top != null ? `${deviceMenuAnchor.top}px` : undefined,
          bottom: deviceMenuAnchor.bottom != null ? `${deviceMenuAnchor.bottom}px` : undefined,
        }}
        role="listbox"
        aria-label={openDeviceMenu === 'input' ? 'Input device' : 'Output device'}
      >
        {(openDeviceMenu === 'input' ? inputDevices : outputDevices).map((device) => {
          const isActive = openDeviceMenu === 'input'
            ? device.id === selectedInputDeviceId
            : device.id === selectedOutputDeviceId
          return (
            <button
              key={`${openDeviceMenu}-${device.id || 'default'}`}
              type="button"
              className={`device-select-menu__item ${isActive ? 'is-active' : ''}`}
              title={device.fullLabel}
              onClick={() => {
                if (openDeviceMenu === 'input') {
                  setSelectedInputDeviceId(device.id)
                  if (device.id) localStorage.setItem(VOICE_INPUT_DEVICE_KEY, device.id)
                  else localStorage.removeItem(VOICE_INPUT_DEVICE_KEY)
                } else {
                  setSelectedOutputDeviceId(device.id)
                  if (device.id) localStorage.setItem(VOICE_OUTPUT_DEVICE_KEY, device.id)
                  else localStorage.removeItem(VOICE_OUTPUT_DEVICE_KEY)
                }
                window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                closeDeviceMenu()
              }}
            >
              <span className="device-select-menu__label">{device.label}</span>
              {isActive && <span className="device-select-menu__check" aria-hidden>✓</span>}
            </button>
          )
        })}
      </div>,
      document.body,
    )
    : null

  const statusPopover = (
    <div
      ref={statusMenuRef}
      className={`user-status-popover ${isMobileViewport ? 'user-status-popover--fixed' : ''}`}
      role="dialog"
      aria-label="SET YOUR STATUS"
    >
      <div className="user-status-popover-header">
        <span className="user-status-popover-title">SET YOUR STATUS</span>
      </div>
      {statusError && (
        <div className="user-status-popover-error">{statusError}</div>
      )}
      <div className="user-status-list">
        {(['online', 'dnd', 'invisible'] as const).map((status) => (
          <button
            key={status}
            type="button"
            className={`user-status-option user-status-option-${status} ${((user?.status === 'offline' && status === 'invisible') || user?.status === status) ? 'active' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => updateMyStatus(status)}
            disabled={statusSaving}
            aria-pressed={(user?.status === 'offline' && status === 'invisible') || user?.status === status}
          >
            <span className="user-status-option-icon" aria-hidden>
              <span className={`user-status-option-dot ${status}`} />
            </span>
              <span className="user-status-option-meta">
              <span className="user-status-option-label">
                {isMobileViewport ? mobilePopoverStatusLabel(status) : statusLabel(status)}
              </span>
              {statusDescription(status) && (
                <span className="user-status-option-description">{statusDescription(status)}</span>
              )}
            </span>
            {((user?.status === 'offline' && status === 'invisible') || user?.status === status) && (
              <span className="user-status-option-check" aria-hidden>✓</span>
            )}
          </button>
        ))}
      </div>
      {statusSaving && (
        <div className="user-status-popover-saving">Updating…</div>
      )}
    </div>
  )

  const settingsButton = (
    <button
      type="button"
      className="user-panel-icon-btn"
      ref={settingsButtonRef}
      onClick={openSettingsPanel}
      title="User settings"
      aria-label="Settings"
    >
      <Settings size={18} />
    </button>
  )

  return (
    <div className="user-bar-wrap" ref={userBarWrapRef}>
      <div className="user-panel" ref={userPanelRef}>
        <div ref={statusToggleRef} className="user-panel-status-anchor">
        <button
          type="button"
          className={`user-avatar user-avatar-btn avatar-status-${(user?.status ?? 'online') as StatusValue}`}
          onClick={() => setShowOwnProfile(true)}
          title="View my profile"
          aria-label="View my profile"
          ref={profileButtonRef}
        >
          {user?.avatar_url ? (
            <img src={resolveAvatarUrl(user.avatar_url) ?? ''} alt={user.username} className="user-avatar-image" />
          ) : (
            user ? getInitial(user.username) : '?'
          )}
        </button>
        <button type="button" className="user-info user-info-btn user-status-button" onClick={toggleStatusMenu} title="Set status" aria-label="Set status" aria-haspopup="dialog" aria-expanded={showStatusMenu}>
          <span className="user-name" title={user?.username || 'User'}>
            {user?.username || 'User'}
          </span>
          <span className="user-status-row">
            <span className="user-status" title={statusLabel(user?.status)}>
              {footerStatusLabel(user?.status)}
            </span>
            <span className="user-status-cue" aria-hidden>
              <span className="user-status-cue-label">Status</span>
              <ChevronsUpDown size={11} strokeWidth={2} />
            </span>
          </span>
        </button>
        </div>
      </div>
      {isMobileViewport
        ? compactSettingsTarget && createPortal(settingsButton, compactSettingsTarget)
        : settingsButton}
      {showStatusMenu && !isMobileViewport && statusPopover}
      {showStatusMenu && isMobileViewport && typeof document !== 'undefined' && createPortal(
        <>
          <button
            type="button"
            className="user-status-mobile-backdrop"
            aria-label="Close status menu"
            onClick={closeStatusMenu}
          />
          {statusPopover}
        </>,
        document.body,
      )}
      {voiceDeviceMenu}
      {showOwnProfile && user && createPortal(
        <MemberProfileDialog
          member={{ user_id: user.id, username: user.username, avatar_url: user.avatar_url, about_me: user.about_me, status: user.status, account_created_at: user.created_at, role: '' }}
          isServerOwner={false}
          onClose={() => setShowOwnProfile(false)}
          onEditProfile={() => { setShowOwnProfile(false); openSettingsPanel() }}
        />,
        document.body,
      )}
      {showSettingsPanel && typeof document !== 'undefined' && createPortal((
        <UserSettingsWindow
          {...{
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
          }}
        />
      ), document.body)}
      <AccountDataDialogs
        closeDeleteModal={closeDeleteModal}
        closeEmailModal={closeEmailModal}
        closeExportModal={closeExportModal}
        deleteConfirm={deleteConfirm}
        deleteError={deleteError}
        deleteModalRef={deleteModalRef}
        deleteNeedsGoogleSignIn={deleteNeedsGoogleSignIn}
        deletePassword={deletePassword}
        deleteSubmitting={deleteSubmitting}
        emailEdit={emailEdit}
        emailError={emailError}
        emailModalRef={emailModalRef}
        emailNeedsGoogleSignIn={emailNeedsGoogleSignIn}
        emailPassword={emailPassword}
        emailSaving={emailSaving}
        exportError={exportError}
        exportModalRef={exportModalRef}
        exportMyData={exportMyData}
        exportPassword={exportPassword}
        exportingData={exportingData}
        isGoogleOnlyAccount={isGoogleOnlyAccount}
        reauthenticateGoogleForExport={reauthenticateGoogleForExport}
        setDeleteConfirm={setDeleteConfirm}
        setDeletePassword={setDeletePassword}
        setEmailEdit={setEmailEdit}
        setEmailError={setEmailError}
        setEmailPassword={setEmailPassword}
        setExportPassword={setExportPassword}
        showDeleteModal={showDeleteModal}
        showEmailModal={showEmailModal}
        showExportModal={showExportModal}
        submitDeleteAccount={submitDeleteAccount}
        submitEmailChange={submitEmailChange}
        user={user}
      />
      <AccountCredentialDialogs
        closePasswordModal={closePasswordModal}
        closeUsernameModal={closeUsernameModal}
        handleLogout={handleLogout}
        isGoogleOnlyAccount={isGoogleOnlyAccount}
        passwordModalRef={passwordModalRef}
        pwConfirm={pwConfirm}
        pwError={pwError}
        pwNew={pwNew}
        pwOld={pwOld}
        pwSaving={pwSaving}
        pwShowNew={pwShowNew}
        pwShowOld={pwShowOld}
        pwSuccess={pwSuccess}
        setAuth={setAuth}
        setPwConfirm={setPwConfirm}
        setPwError={setPwError}
        setPwNew={setPwNew}
        setPwOld={setPwOld}
        setPwSaving={setPwSaving}
        setPwShowNew={setPwShowNew}
        setPwShowOld={setPwShowOld}
        setPwSuccess={setPwSuccess}
        setUser={setUser}
        setUsernameAvailable={setUsernameAvailable}
        setUsernameCheckFailed={setUsernameCheckFailed}
        setUsernameChecking={setUsernameChecking}
        setUsernameEdit={setUsernameEdit}
        setUsernameError={setUsernameError}
        setUsernameSaving={setUsernameSaving}
        showPwModal={showPwModal}
        showUsernameModal={showUsernameModal}
        token={token}
        user={user}
        usernameAvailable={usernameAvailable}
        usernameCheckFailed={usernameCheckFailed}
        usernameCheckTimeoutRef={usernameCheckTimeoutRef}
        usernameChecking={usernameChecking}
        usernameEdit={usernameEdit}
        usernameError={usernameError}
        usernameModalRef={usernameModalRef}
        usernameSaving={usernameSaving}
      />
    </div>
  )
}
