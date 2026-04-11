import { Settings, Eye, EyeOff, Lock, Download, Trash2, MessageSquare, Mic, Monitor, Shield, User, ChevronsUpDown } from 'lucide-react'
import type { StatusValue } from './StatusIcon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { useToastStore } from '../stores/toast'
import { isTauri } from '../secureStorage'
import { authApi, getAuthErrorMessage } from '../api'
import { useSocketStore } from '../stores/socket'
import { SENSITIVITY_THRESHOLD_KEY } from '../webrtc/sensitivityThreshold'
import SensitivityBar from './SensitivityBar'
import { ROUTES } from '../routes'
import {
  checkForUpdates,
  getDesktopAppVersion,
  downloadAndInstallUpdate,
  type UpdateResult,
} from '../updater'
import {
  getDesktopStartupTargetLabel,
  getDesktopAutostartEnabled,
  getStoredMinimizeToTrayOnCloseEnabled,
  markDesktopAutostartInitialized,
  shouldEnableDesktopAutostartByDefault,
  setDesktopAutostartEnabled,
  setDesktopMinimizeToTrayOnClose,
} from '../desktopSettings'
import {
  getPushNotificationPermission,
  getPushNotificationsEnabled,
  requestPushNotificationPermission,
  setPushNotificationsEnabled as persistPushNotificationsEnabled,
} from '../pushNotifications'
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
  VOICE_SETTINGS_CHANGED_EVENT,
  type MicrophonePermissionState,
  type VoiceDeviceOption,
} from '../voiceDevices'

const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024
const SETTINGS_CHANGED_EVENT = VOICE_SETTINGS_CHANGED_EVENT
const SOUND_KEY = 'voxpery-settings-sound-enabled'
const INPUT_VOL_KEY = 'voxpery-settings-input-volume'
const OUTPUT_VOL_KEY = 'voxpery-settings-output-volume'
const VOICE_MODE_KEY = 'voxpery-settings-voice-mode'
const PTT_KEY_KEY = 'voxpery-settings-ptt-key'
const NOISE_SUPPRESSION_KEY = 'voxpery-settings-noise-suppression'
const VOICE_JOIN_CONFIRM_KEY = 'voxpery-settings-voice-join-confirm'
const SPEAKING_THRESHOLD_KEY = SENSITIVITY_THRESHOLD_KEY
const SPEAKING_PRESET_KEY = 'voxpery-settings-speaking-preset'
const DEFAULT_SPEAKING_PRESET = 'quiet' as const
const DEFAULT_INPUT_DEVICE_OPTION: VoiceDeviceOption = {
  id: '',
  label: DEFAULT_INPUT_DEVICE_LABEL,
  fullLabel: 'System default microphone',
}
const DEFAULT_OUTPUT_DEVICE_OPTION: VoiceDeviceOption = {
  id: '',
  label: DEFAULT_OUTPUT_DEVICE_LABEL,
  fullLabel: 'System default speaker',
}

type SettingsSection = 'profile' | 'communication' | 'voice' | 'desktop' | 'privacy'
type VoiceDeviceMenu = 'input' | 'output'
const DEFAULT_SETTINGS_SECTION: SettingsSection = 'profile'

function getInitial(name: string) {
  return name.charAt(0).toUpperCase()
}

function statusLabel(status?: string) {
  if (status === 'dnd') return 'Do Not Disturb'
  if (status === 'invisible' || status === 'offline') return 'Invisible'
  return 'Online'
}

function footerStatusLabel(status?: string) {
  if (status === 'dnd') return 'DND'
  if (status === 'invisible' || status === 'offline') return 'Invisible'
  return 'Online'
}

function mobilePopoverStatusLabel(status: 'online' | 'dnd' | 'invisible') {
  if (status === 'dnd') return 'DND'
  if (status === 'invisible') return 'Invisible'
  return 'Online'
}

function statusDescription(status: 'online' | 'dnd' | 'invisible') {
  if (status === 'dnd') return 'You will not receive notifications.'
  if (status === 'invisible') return 'You appear offline to others.'
  return null
}

function hasOnlyUsernameChars(value: string) {
  if (value.length === 0) return false
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    const code = value.charCodeAt(i)
    const isLowerLetter = code >= 97 && code <= 122
    const isDigit = code >= 48 && code <= 57
    if (!isLowerLetter && !isDigit && ch !== '_' && ch !== '.') return false
  }
  return true
}

function hasUsernameBoundarySeparator(value: string) {
  return value.startsWith('_') || value.startsWith('.') || value.endsWith('_') || value.endsWith('.')
}

function hasUsernameConsecutiveSeparator(value: string) {
  for (let i = 1; i < value.length; i += 1) {
    const prev = value[i - 1]
    const curr = value[i]
    if ((prev === '_' || prev === '.') && (curr === '_' || curr === '.')) return true
  }
  return false
}

function isValidUsername(value: string) {
  if (value.length < 3 || !hasOnlyUsernameChars(value)) return false
  if (hasUsernameBoundarySeparator(value)) return false
  return !hasUsernameConsecutiveSeparator(value)
}

/** Sensitivity threshold (0–100) per preset. Lower = more sensitive (quieter sounds pass / sent). */
function thresholdByPreset(preset: 'quiet' | 'normal' | 'noisy') {
  if (preset === 'quiet') return 14    // ~−38dB: higher sensitivity for quiet rooms
  if (preset === 'noisy') return 42    // ~−20dB: stricter gate for noisy spaces
  return 23    // ~−30dB: balanced default for typical speaking volume
}

export default function UserBar() {
  const { user, token, setUserStatus, setUser, setAuth, logout } = useAuthStore()
  const mobileSidebarPanel = useAppStore((s) => s.mobileSidebarPanel)
  const closeMobileSidebar = useAppStore((s) => s.closeMobileSidebar)
  const { disconnect } = useSocketStore()
  const navigate = useNavigate()
  const pushToast = useToastStore((s) => s.pushToast)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [pendingStatusMenuOpen, setPendingStatusMenuOpen] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false
  )
  const [statusPopoverAnchor, setStatusPopoverAnchor] = useState<{ left: number; bottom: number; width: number } | null>(null)
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
  const [inputVolume, setInputVolume] = useState(80)
  const [outputVolume, setOutputVolume] = useState(100)
  const [inputDevices, setInputDevices] = useState<VoiceDeviceOption[]>([DEFAULT_INPUT_DEVICE_OPTION])
  const [outputDevices, setOutputDevices] = useState<VoiceDeviceOption[]>([DEFAULT_OUTPUT_DEVICE_OPTION])
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState(() => getStoredVoiceInputDeviceId())
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState(() => getStoredVoiceOutputDeviceId())
  const [voiceDevicesLoading, setVoiceDevicesLoading] = useState(false)
  const [voiceDevicesUnlocking, setVoiceDevicesUnlocking] = useState(false)
  const [voiceDevicesNeedAccess, setVoiceDevicesNeedAccess] = useState(false)
  const [microphonePermissionState, setMicrophonePermissionState] = useState<MicrophonePermissionState>('unsupported')
  const [canSelectOutputDevice, setCanSelectOutputDevice] = useState(() => supportsAudioOutputSelection())
  const [voiceMode, setVoiceMode] = useState<'voice_activity' | 'push_to_talk'>('voice_activity')
  const [pttKey, setPttKey] = useState('V')
  const [capturingPtt, setCapturingPtt] = useState(false)
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(true)
  const [voiceJoinConfirmEnabled, setVoiceJoinConfirmEnabled] = useState(true)
  const [dmPrivacy, setDmPrivacy] = useState<'everyone' | 'friends'>(
    (user?.dm_privacy === 'everyone' || user?.dm_privacy === 'friends' ? user.dm_privacy : 'friends') ?? 'friends'
  )
  const [speakingThreshold, setSpeakingThreshold] = useState(() => thresholdByPreset(DEFAULT_SPEAKING_PRESET))
  const [speakingPreset, setSpeakingPreset] = useState<'quiet' | 'normal' | 'noisy' | 'custom'>(DEFAULT_SPEAKING_PRESET)
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
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateResult | null>(null)
  const [updateChecked, setUpdateChecked] = useState(false)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateInstalling, setUpdateInstalling] = useState(false)
  const [desktopAppVersion, setDesktopAppVersion] = useState<string | null>(null)
  const [desktopAutostartEnabled, setDesktopAutostartState] = useState(false)
  const [desktopAutostartLoading, setDesktopAutostartLoading] = useState(false)
  const [minimizeToTrayOnCloseEnabled, setMinimizeToTrayOnCloseEnabled] = useState(true)
  const [minimizeToTrayLoading, setMinimizeToTrayLoading] = useState(false)
  const [showUsernameModal, setShowUsernameModal] = useState(false)
  const [usernameEdit, setUsernameEdit] = useState('')
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernameChecking, setUsernameChecking] = useState(false)
  const [usernameCheckFailed, setUsernameCheckFailed] = useState(false)
  const statusMenuRef = useRef<HTMLDivElement>(null)
  const deviceMenuRef = useRef<HTMLDivElement>(null)
  const usernameCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusToggleRef = useRef<HTMLDivElement>(null)
  const userBarWrapRef = useRef<HTMLDivElement>(null)
  const userPanelRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsModalRef = useRef<HTMLDivElement>(null)
  const settingsScrollRef = useRef<HTMLDivElement>(null)
  const inputDeviceTriggerRef = useRef<HTMLButtonElement>(null)
  const outputDeviceTriggerRef = useRef<HTMLButtonElement>(null)
  const desktopStartupTargetLabel = getDesktopStartupTargetLabel()

  const closeStatusMenu = () => {
    setShowStatusMenu(false)
    setStatusError(null)
  }

  const closeDeviceMenu = useCallback(() => {
    setOpenDeviceMenu(null)
    setDeviceMenuAnchor(null)
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

  const updateStatusPopoverAnchor = useCallback(() => {
    if (!isMobileViewport) {
      setStatusPopoverAnchor(null)
      return
    }
    const footer = userBarWrapRef.current
    const anchor = statusToggleRef.current
    if (!footer) return
    const footerRect = footer.getBoundingClientRect()
    const anchorRect = anchor?.getBoundingClientRect() ?? footerRect
    const viewportPadding = 8
    const width = Math.min(136, Math.max(124, anchorRect.width + 12))
    const left = Math.max(
      viewportPadding,
      Math.min(footerRect.left, window.innerWidth - width - viewportPadding),
    )
    setStatusPopoverAnchor({
      left,
      bottom: window.innerHeight - footerRect.top + 1,
      width,
    })
  }, [isMobileViewport])

  const updateMobileVoiceFooterBounds = useCallback(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (!isMobileViewport) {
      root.style.removeProperty('--mobile-callbar-left')
      root.style.removeProperty('--mobile-callbar-right')
      return
    }
    const userPanel = userPanelRef.current
    const settingsButton = settingsButtonRef.current
    if (!userPanel || !settingsButton) return
    const userPanelRect = userPanel.getBoundingClientRect()
    const settingsRect = settingsButton.getBoundingClientRect()
    const left = Math.round(userPanelRect.right + 8)
    const rightBoundary = Math.round(settingsRect.left - 8)
    if (rightBoundary <= left) return
    root.style.setProperty('--mobile-callbar-left', `${left}px`)
    root.style.setProperty('--mobile-callbar-right', `${Math.max(8, window.innerWidth - rightBoundary)}px`)
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
    const media = window.matchMedia('(max-width: 900px)')
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
    if (!mediaDevices?.addEventListener) return
    const handleDeviceChange = () => {
      void refreshVoiceDevices()
    }
    mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange)
  }, [refreshVoiceDevices])

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

  const closeSettingsPanel = () => {
    setShowSettingsPanel(false)
  }

  const openSettingsPanel = () => {
    closeStatusMenu()
    setActiveSettingsSection(DEFAULT_SETTINGS_SECTION)
    setShowSettingsPanel(true)
  }

  const closeDeleteModal = () => {
    setShowDeleteModal(false)
  }

  const closeUsernameModal = () => {
    if (usernameCheckTimeoutRef.current) {
      clearTimeout(usernameCheckTimeoutRef.current)
      usernameCheckTimeoutRef.current = null
    }
    setShowUsernameModal(false)
  }

  const closePasswordModal = () => {
    setShowPwModal(false)
  }

  useEffect(() => {
    const sound = localStorage.getItem(SOUND_KEY)
    const input = localStorage.getItem(INPUT_VOL_KEY)
    const output = localStorage.getItem(OUTPUT_VOL_KEY)
    const mode = localStorage.getItem(VOICE_MODE_KEY)
    const ptt = localStorage.getItem(PTT_KEY_KEY)
    const ns = localStorage.getItem(NOISE_SUPPRESSION_KEY)
    const voiceJoinConfirm = localStorage.getItem(VOICE_JOIN_CONFIRM_KEY)
    const speaking = localStorage.getItem(SPEAKING_THRESHOLD_KEY)
    const preset = localStorage.getItem(SPEAKING_PRESET_KEY)
    if (sound != null) setSoundEnabled(sound === '1')
    const enabled = getPushNotificationsEnabled()
    setPushNotificationsEnabledState(enabled)
    setPushNotificationPermission(getPushNotificationPermission())
    if (input != null) setInputVolume(Math.min(100, Math.max(1, Number(input) || 80)))
    if (output != null) setOutputVolume(Math.min(100, Math.max(1, Number(output) || 100)))
    if (mode === 'push_to_talk' || mode === 'voice_activity') setVoiceMode(mode)
    if (ptt) setPttKey(ptt)
    if (ns != null) setNoiseSuppressionEnabled(ns === '1')
    if (voiceJoinConfirm != null) setVoiceJoinConfirmEnabled(voiceJoinConfirm !== '0')
    if (speaking != null) {
      setSpeakingThreshold(Math.min(100, Math.max(0, Number(speaking) || thresholdByPreset(DEFAULT_SPEAKING_PRESET))))
    } else {
      setSpeakingThreshold(thresholdByPreset(DEFAULT_SPEAKING_PRESET))
    }
    if (preset === 'quiet' || preset === 'normal' || preset === 'noisy' || preset === 'custom') {
      setSpeakingPreset(preset)
      if (speaking == null && preset !== 'custom') {
        setSpeakingThreshold(thresholdByPreset(preset))
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
  }, [])

  useEffect(() => {
    if (!showStatusMenu) return
    updateStatusPopoverAnchor()
    updateMobileVoiceFooterBounds()
    const close = (evt: PointerEvent) => {
      const target = evt.target as Node | null
      if (target && statusMenuRef.current?.contains(target)) return
      if (target && statusToggleRef.current?.contains(target)) return
      setShowStatusMenu(false)
      setStatusError(null)
    }
    const refreshAnchor = () => {
      updateStatusPopoverAnchor()
      updateMobileVoiceFooterBounds()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', refreshAnchor)
    window.addEventListener('scroll', refreshAnchor, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', refreshAnchor)
      window.removeEventListener('scroll', refreshAnchor, true)
    }
  }, [showStatusMenu, updateMobileVoiceFooterBounds, updateStatusPopoverAnchor])

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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setCapturingPtt(false)
        return
      }
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

  useEffect(() => {
    if (!showSettingsPanel && !showStatusMenu && !showDeleteModal && !showUsernameModal && !showPwModal && !openDeviceMenu) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (openDeviceMenu) {
        closeDeviceMenu()
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
      if (showPwModal) {
        closePasswordModal()
        return
      }
      if (showSettingsPanel) {
        closeSettingsPanel()
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
  }, [closeDeviceMenu, openDeviceMenu, showDeleteModal, showPwModal, showSettingsPanel, showStatusMenu, showUsernameModal])

  useEffect(() => {
    if (!showSettingsPanel) return
    if (!isTauri() && activeSettingsSection === 'desktop') {
      setActiveSettingsSection('profile')
    }
  }, [activeSettingsSection, showSettingsPanel])

  useEffect(() => {
    if (showSettingsPanel) return
    if (capturingPtt) setCapturingPtt(false)
  }, [capturingPtt, showSettingsPanel])

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
        const [autostartInitiallyEnabled, trayEnabled] = await Promise.all([
          getDesktopAutostartEnabled(),
          Promise.resolve(getStoredMinimizeToTrayOnCloseEnabled()),
        ])
        let autostartEnabled = autostartInitiallyEnabled
        if (shouldEnableDesktopAutostartByDefault()) {
          if (!autostartEnabled) {
            await setDesktopAutostartEnabled(true)
            autostartEnabled = true
          }
          markDesktopAutostartInitialized()
        }
        await setDesktopMinimizeToTrayOnClose(trayEnabled)
        if (cancelled) return
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
      pushToast({
        level: 'error',
        title: avatarUrl ? 'Profile photo update failed' : 'Profile photo removal failed',
        message: err instanceof Error ? err.message : 'Could not update your profile photo.',
      })
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

  const exportMyData = async () => {
    if (isTauri() && !token) return
    setExportingData(true)
    try {
      const payload = await authApi.exportData(token ?? null)
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const date = new Date().toISOString().slice(0, 10)
      const link = document.createElement('a')
      link.href = url
      link.download = `voxpery-data-export-${date}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      pushToast({
        level: 'info',
        title: 'Data export ready',
        message: 'Your account data has been downloaded as JSON.',
      })
    } catch (err: unknown) {
      const message = getAuthErrorMessage(err).message || 'Could not export account data.'
      pushToast({
        level: 'error',
        title: 'Data export failed',
        message,
      })
    } finally {
      setExportingData(false)
    }
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
      markDesktopAutostartInitialized()
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
      setDeleteError(getAuthErrorMessage(err).message || 'Could not process account deletion request.')
    } finally {
      setDeleteSubmitting(false)
    }
  }

  const openPasswordModal = async () => {
    setShowSettingsPanel(false)
    setPwOld('')
    setPwNew('')
    setPwConfirm('')
    setPwError(null)
    setPwSuccess(false)
    try {
      const freshUser = await authApi.getMe(token ?? null)
      if (token) setAuth(token, freshUser)
      else setUser(freshUser)
    } catch {
      // Modal can still open with current in-memory user state.
    }
    setShowPwModal(true)
  }

  const isGoogleOnlyAccount = user?.google_connected === true && user?.has_password !== true
  const currentInputDevice = inputDevices.find((device) => device.id === selectedInputDeviceId) ?? DEFAULT_INPUT_DEVICE_OPTION
  const currentOutputDevice = outputDevices.find((device) => device.id === selectedOutputDeviceId) ?? DEFAULT_OUTPUT_DEVICE_OPTION
  const microphoneAccessAllowed = microphonePermissionState === 'granted'
  const microphoneAccessButtonLabel = microphonePermissionState === 'denied' ? 'Retry mic access' : 'Allow mic access'

  const voiceDeviceMenu = openDeviceMenu && deviceMenuAnchor && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={deviceMenuRef}
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
      style={isMobileViewport && statusPopoverAnchor
        ? {
          left: `${statusPopoverAnchor.left}px`,
          bottom: `${statusPopoverAnchor.bottom}px`,
          width: `${statusPopoverAnchor.width}px`,
        }
        : undefined}
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
      <div className="user-status-popover-footer">
        <button
          type="button"
          className="user-status-popover-logout"
          onClick={() => {
            disconnect()
            logout()
            navigate(ROUTES.login, { replace: true })
          }}
        >
          Log out
        </button>
      </div>
    </div>
  )

  return (
    <div className="user-bar-wrap" ref={userBarWrapRef}>
      <div className="user-panel" ref={userPanelRef}>
        <div ref={statusToggleRef} className="user-panel-status-anchor">
        <button
          type="button"
          className={`user-avatar user-avatar-btn avatar-status-${(user?.status ?? 'online') as StatusValue}`}
          onClick={() => {
            toggleStatusMenu()
          }}
          title="Set status"
          aria-label="Set status"
        >
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.username} className="user-avatar-image" />
          ) : (
            user ? getInitial(user.username) : '?'
          )}
        </button>
        <button
          type="button"
          className="user-info user-info-btn"
          onClick={() => {
            toggleStatusMenu()
          }}
          title="Set status"
          aria-label="Set status"
        >
          <div className="user-name">{user?.username || 'User'}</div>
          <div className="user-status-row">
            <div className="user-status" title={statusLabel(user?.status)}>
              {footerStatusLabel(user?.status)}
            </div>
            <span className="user-status-cue" aria-hidden>
              <span className="user-status-cue-label">Status</span>
              <ChevronsUpDown size={11} strokeWidth={2} />
            </span>
          </div>
        </button>
        </div>
      </div>
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
      {showStatusMenu && !isMobileViewport && statusPopover}
      {showStatusMenu && isMobileViewport && typeof document !== 'undefined' && createPortal(statusPopover, document.body)}
      {voiceDeviceMenu}
      {showSettingsPanel && typeof document !== 'undefined' && createPortal((
        <div className="modal-overlay" onClick={closeSettingsPanel}>
          <div
            className={`modal user-settings-modal ${activeSettingsSection === 'voice' ? 'user-settings-modal--voice' : ''}`}
            ref={settingsModalRef}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="user-settings-header">
              <div className="user-settings-header-copy">
                <h2>Settings</h2>
                <p className="user-settings-subtitle">Manage your account, voice, desktop, and privacy preferences.</p>
              </div>
            </header>
            <div className="user-settings-body">
              <nav className="user-settings-nav" aria-label="Settings sections">
                <button
                  type="button"
                  className={`user-settings-nav__item ${activeSettingsSection === 'profile' ? 'user-settings-nav__item--active' : ''}`}
                  onClick={() => setActiveSettingsSection('profile')}
                >
                  <User size={16} />
                  <span>Profile</span>
                </button>
                <button
                  type="button"
                  className={`user-settings-nav__item ${activeSettingsSection === 'communication' ? 'user-settings-nav__item--active' : ''}`}
                  onClick={() => setActiveSettingsSection('communication')}
                >
                  <MessageSquare size={16} />
                  <span>Communication</span>
                </button>
                <button
                  type="button"
                  className={`user-settings-nav__item ${activeSettingsSection === 'voice' ? 'user-settings-nav__item--active' : ''}`}
                  onClick={() => setActiveSettingsSection('voice')}
                >
                  <Mic size={16} />
                  <span>Voice & Audio</span>
                </button>
                <button
                  type="button"
                  className={`user-settings-nav__item ${activeSettingsSection === 'privacy' ? 'user-settings-nav__item--active' : ''}`}
                  onClick={() => setActiveSettingsSection('privacy')}
                >
                  <Shield size={16} />
                  <span>Privacy & Data</span>
                </button>
                {isTauri() && (
                  <button
                    type="button"
                    className={`user-settings-nav__item ${activeSettingsSection === 'desktop' ? 'user-settings-nav__item--active' : ''}`}
                    onClick={() => setActiveSettingsSection('desktop')}
                  >
                    <Monitor size={16} />
                    <span>Desktop</span>
                  </button>
                )}
              </nav>
              <div className="user-settings-scroll" ref={settingsScrollRef}>
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
                    <div className="user-setting-title">Browser notifications</div>
                    <div className="user-setting-desc">
                      {pushNotificationPermission === 'unsupported'
                        ? 'This environment does not support system notifications.'
                        : pushNotificationPermission === 'denied'
                          ? 'Notifications are blocked in your browser or desktop shell.'
                          : 'Show browser or desktop pop-up notifications for direct messages and friend requests.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`user-toggle ${pushNotificationsEnabled && pushNotificationPermission !== 'unsupported' && pushNotificationPermission !== 'denied' ? 'active' : ''}`}
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
                    <div className="user-setting-title">Who can send you DMs</div>
                    <div className="user-setting-desc">Who can start a DM with you.</div>
                  </div>
                  <select
                    className="user-select"
                    value={dmPrivacy}
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
                <div className="user-setting-row user-setting-row--span-two">
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
                  <div className="user-setting-row user-setting-row--span-two">
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
                <div className="user-setting-row user-setting-row--span-two">
                  <div>
                    <div className="user-setting-title">Microphone access</div>
                    <div className="user-setting-desc">
                      {microphonePermissionState === 'granted'
                        ? 'Voxpery can use your mic for voice, device selection, and mic testing.'
                        : microphonePermissionState === 'denied'
                          ? 'Microphone access is blocked. Allow it in your browser to choose devices and join voice.'
                          : 'Allow microphone access to choose devices, join voice channels, and run mic test.'}
                    </div>
                  </div>
                  <div className="user-setting-actions user-setting-actions--device">
                    {microphoneAccessAllowed ? (
                      <div className="user-setting-inline-note">Allowed</div>
                    ) : (
                      <button
                        type="button"
                        className="user-toggle account-action-btn"
                        disabled={voiceDevicesUnlocking}
                        onClick={() => void refreshVoiceDevices(true)}
                      >
                        {voiceDevicesUnlocking ? 'Allowing…' : microphoneAccessButtonLabel}
                      </button>
                    )}
                  </div>
                </div>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Input device</div>
                    <div className="user-setting-desc">
                      {voiceDevicesNeedAccess
                        ? 'Uses System Default until microphone access is allowed.'
                        : 'Choose which microphone Voxpery uses for voice.'}
                    </div>
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
                    <div className="user-setting-title">Output device</div>
                    <div className="user-setting-desc">
                      {voiceDevicesNeedAccess
                        ? 'Uses System Default until microphone access is allowed.'
                        : canSelectOutputDevice
                          ? 'Choose which speaker plays incoming voice audio.'
                          : 'This browser uses your system default output.'}
                    </div>
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
                <div className="user-setting-row user-setting-row-full user-setting-row--span-two">
                  <SensitivityBar
                    threshold={speakingThreshold}
                    preset={speakingPreset}
                    onThresholdChange={(v) => {
                      setSpeakingThreshold(v)
                      localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(v))
                    }}
                    onPresetChange={(preset) => {
                      setSpeakingPreset(preset)
                      localStorage.setItem(SPEAKING_PRESET_KEY, preset)
                      if (preset !== 'custom') {
                        const threshold = thresholdByPreset(preset)
                        setSpeakingThreshold(threshold)
                        localStorage.setItem(SPEAKING_THRESHOLD_KEY, String(threshold))
                      }
                    }}
                  />
                </div>
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
                    <div className="user-setting-title">Voice join confirmation</div>
                    <div className="user-setting-desc">Ask before joining a voice channel from the sidebar.</div>
                  </div>
                  <button
                    type="button"
                    className={`user-toggle ${voiceJoinConfirmEnabled ? 'active' : ''}`}
                    onClick={() => {
                      const next = !voiceJoinConfirmEnabled
                      setVoiceJoinConfirmEnabled(next)
                      localStorage.setItem(VOICE_JOIN_CONFIRM_KEY, next ? '1' : '0')
                      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
                    }}
                  >
                    {voiceJoinConfirmEnabled ? 'On' : 'Off'}
                  </button>
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
                              : updateInfo?.error
                                ? 'Could not check for new desktop releases right now.'
                              : 'Your desktop app is on the latest version.'
                            : 'Check for new desktop releases and install them without reinstalling.'}
                        </div>
                      </div>
                      <div className="user-setting-actions">
                        <button
                          type="button"
                          className="user-toggle account-action-btn"
                          onClick={() => void refreshUpdateStatus(true)}
                          disabled={updateChecking || updateInstalling}
                        >
                          {updateChecking ? 'Checking…' : 'Check now'}
                        </button>
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
              <section className="user-settings-section">
                <h3 className="user-settings-section-title">Profile</h3>
                <div className="user-profile-preview-card">
                  <div className={`user-profile-preview-avatar avatar-status-${(user?.status ?? 'online') as StatusValue}`} aria-hidden>
                    {user?.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="user-avatar-image" />
                    ) : (
                      user ? getInitial(user.username) : '?'
                    )}
                  </div>
                  <div className="user-profile-preview-meta">
                    <div className="user-profile-preview-eyebrow">Current profile</div>
                    <div className="user-profile-preview-name">{user?.username ?? 'Unknown user'}</div>
                    <div className="user-profile-preview-subtitle">
                      <span className={`user-profile-presence-pill user-profile-presence-pill-${user?.status === 'dnd' ? 'dnd' : user?.status === 'offline' || user?.status === 'invisible' ? 'offline' : 'online'}`}>
                        <span className="user-profile-presence-pill-dot" aria-hidden />
                        {statusLabel(user?.status)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="user-setting-row">
                  <div className="user-setting-profile-photo">
                    <div className="user-setting-profile-avatar" aria-hidden>
                      {user?.avatar_url ? (
                        <img src={user.avatar_url} alt="" className="user-avatar-image" />
                      ) : (
                        user ? getInitial(user.username) : '?'
                      )}
                    </div>
                    <div>
                      <div className="user-setting-title">Profile photo</div>
                      <div className="user-setting-desc">Upload a square image to personalize your account.</div>
                    </div>
                  </div>
                  <div className="user-setting-actions">
                    <label className="user-toggle account-action-btn">
                      Upload
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          void onPickProfileAvatar(e.target.files)
                          e.currentTarget.value = ''
                        }}
                      />
                    </label>
                    {user?.avatar_url && (
                      <button
                        type="button"
                        className="user-toggle account-action-btn"
                        onClick={() => void updateProfileAvatar(null)}
                      >
                        Remove
                      </button>
                    )}
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
                      setShowSettingsPanel(false)
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
              </section>
              )}
              {activeSettingsSection === 'privacy' && (
              <section className="user-settings-section">
                <h3 className="user-settings-section-title">Privacy & Data</h3>
                <div className="user-setting-row">
                  <div>
                    <div className="user-setting-title">Data export</div>
                    <div className="user-setting-desc">Download your account data in JSON format.</div>
                  </div>
                  <button
                    type="button"
                    className="user-toggle account-action-btn"
                    onClick={() => void exportMyData()}
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
                      setShowSettingsPanel(false)
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
                onClick={closeSettingsPanel}
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      ), document.body)}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={closeDeleteModal}>
          <div className="modal pw-modal delete-account-modal" onClick={(e) => e.stopPropagation()}>
            <header className="pw-modal-header">
              <Trash2 size={20} className="pw-modal-icon" />
              <h2>Delete account</h2>
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
      )}
      {showUsernameModal && (() => {
        const changedAt = user?.username_changed_at ? new Date(user.username_changed_at).getTime() : null
        const nextAllowedMs = changedAt ? changedAt + 30 * 24 * 60 * 60 * 1000 : null
        const cannotChangeYet = nextAllowedMs != null && Date.now() < nextAllowedMs
        const nextAllowedDate = nextAllowedMs != null ? new Date(nextAllowedMs) : null
        return (
        <div className="modal-overlay" onClick={closeUsernameModal}>
          <div className="modal pw-modal" onClick={(e) => e.stopPropagation()}>
            <header className="pw-modal-header">
              <h2>Change username</h2>
              <p className="pw-modal-subtitle">3–32 characters, letters, numbers, underscores, and periods.</p>
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
                      const v = e.target.value.toLowerCase()
                      setUsernameEdit(v)
                      setUsernameError(null)
                      if (v.trim() === user?.username?.toLowerCase()) {
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
                {usernameError && <div className="pw-error">{usernameError}</div>}
              </div>
            </div>
            <footer className="pw-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeUsernameModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={cannotChangeYet || usernameSaving || !isValidUsername(usernameEdit.trim()) || usernameEdit.trim() === user?.username?.toLowerCase() || usernameAvailable !== true}
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
        ); })()}
      {showPwModal && (
        <div className="modal-overlay" onClick={closePasswordModal}>
          <div className="modal pw-modal" onClick={(e) => e.stopPropagation()}>
            <header className="pw-modal-header">
              <Lock size={20} className="pw-modal-icon" />
              <h2>{isGoogleOnlyAccount ? 'Set password' : 'Change password'}</h2>
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
              {pwError && <div className="pw-error">{pwError}</div>}
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
                onClick={closePasswordModal}
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
                      if (token) setAuth(auth.token, auth.user)
                      else setUser(auth.user)
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
                        disconnect()
                        logout()
                        navigate(ROUTES.login, { replace: true })
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
      )}
    </div>
  )
}
