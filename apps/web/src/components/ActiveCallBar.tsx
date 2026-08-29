import { ChevronRight, Eye, EyeOff, PhoneOff, Mic, MicOff, Monitor, Volume2, VolumeX, Maximize2, Minimize2, LayoutGrid, PanelsTopLeft, SwitchCamera as SwitchCameraIcon, Users, Video, VideoOff, Wifi } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { useLiveKitVoice } from '../webrtc/useLiveKitVoice'
import { SCREEN_SHARE_CAPTURE_READY_EVENT } from '../webrtc/hooks/useLocalMedia'
import { shouldUseLightweightMobileVoicePipeline } from '../webrtc/hooks/useAudioEngine'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { applyPreferredAudioOutputDevice, getPreferredMicrophoneStream, VOICE_SETTINGS_CHANGED_EVENT } from '../voiceDevices'
import {
  desktopMediaPermissionRecoveryMessage,
  isMediaPermissionDeniedError,
  openDesktopMediaPermissionSettings,
} from '../desktopMediaPermissions'
import {
  classifyVoiceError,
  formatMetric,
  getVoicePingLevel,
} from '../webrtc/voiceDiagnostics'
import { ROUTES } from '../routes'
import { attachMediaStreamPreview } from '../mediaStreamPreview'
import { resolveAvatarUrl } from '../api'
import {
  createRemoteAudioKindPlaybackStream,
  remoteMediaVisibilityKey,
  shouldUseDirectRemoteAudioPlayback,
  shouldMuteRemoteAudioPlayback,
  type RemoteAudioKind,
  type RemoteMediaKind,
} from '../webrtc/remoteMediaControls'
import {
  attachRemoteVideoElement,
  type VoxperyMediaStreamTrack,
} from '../webrtc/livekitVideoAttachment'
import { isTauri } from '../secureStorage'
import {
  getStoredGlobalMuteShortcut,
  GLOBAL_MUTE_SHORTCUT_EVENT,
  isEditableShortcutTarget,
  keyboardEventMatchesShortcut,
} from '../globalMuteShortcut'
import {
  DEFAULT_REMOTE_PLAYBACK_VOLUME,
  getRemotePlaybackVolume,
  normalizeRemoteScreenPlaybackVolume,
  readRemotePlaybackVolumes,
  readPreviousScreenPlaybackVolume,
  remotePlaybackVolumeKey,
  REMOTE_PLAYBACK_VOLUME_CHANGED_EVENT,
  writePreviousScreenPlaybackVolume,
  writeRemotePlaybackVolumes,
} from '../webrtc/remotePlaybackVolume'

type VoxperyTrack = VoxperyMediaStreamTrack

interface VoxperyAudioElement extends HTMLAudioElement {
  __voxpery_trackIds?: string
}

interface RemoteAudioPlaybackGraph {
  trackIds: string
  source: MediaStreamAudioSourceNode
  gain: GainNode
  limiter: DynamicsCompressorNode | null
  destination: MediaStreamAudioDestinationNode
}

type RemoteAudioPlaybackStatus = 'pending' | 'playing' | 'retrying'

interface RemoteAudioPlaybackAttempt {
  element: HTMLAudioElement
  trackIds: string
  status: RemoteAudioPlaybackStatus
}

interface VoxperyHTMLDivElement extends HTMLDivElement {
  _idleTimeout?: ReturnType<typeof setTimeout>
}

type RemoteMediaPlaceholder = {
  key: string
  peerId: string
  kind: RemoteMediaKind
  label: string
}

type RemoteAudioPlaybackLayerProps = {
  remoteStreams: Map<string, MediaStream>
  watchedScreenPeerIds: Set<string>
  renderAudioElement: (
    peerId: string,
    stream: MediaStream,
    kind: RemoteAudioKind,
    include: boolean,
  ) => ReactNode
}

interface ActiveCallBarProps {
  selectedVoiceChannelId: string | null
  /** Only show the voice stage (participants grid) when user has this channel selected (e.g. clicked voice channel in sidebar). */
  activeChannelId: string | null
}

type ScreenShareQuality = 'auto' | 'presentation' | 'video' | 'gaming'

function readScreenShareQuality(): ScreenShareQuality {
  const raw = localStorage.getItem('voxpery-settings-screen-share-quality')
  if (raw === 'presentation' || raw === 'video' || raw === 'gaming') return raw
  return 'auto'
}

function screenShareQualitySummary(mode: ScreenShareQuality) {
  if (mode === 'presentation') return '1080p30 · 4 Mbps · detail'
  if (mode === 'video') return '1080p60 · 8 Mbps · motion'
  if (mode === 'gaming') return '1080p60 · 12 Mbps · high motion'
  return 'Auto uses an adaptive profile up to 1080p60 · 8 Mbps.'
}

function RemoteVideoTrack({ track }: { track: MediaStreamTrack }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    return attachRemoteVideoElement(element, track)
  }, [track])

  return <video ref={videoRef} autoPlay muted playsInline />
}

function ScreenShareViewerAvatars({
  viewerIds,
  members,
}: {
  viewerIds: string[]
  members: Array<{ user_id: string; username: string; avatar_url?: string | null }>
}) {
  const viewers = viewerIds
    .map((viewerId) => members.find((member) => member.user_id === viewerId))
    .filter((member): member is { user_id: string; username: string; avatar_url?: string | null } => !!member)
  if (viewers.length === 0) return null

  const visibleViewers = viewers.slice(0, 4)
  const remaining = viewers.length - visibleViewers.length
  const names = viewers.map((viewer) => viewer.username).join(', ')
  return (
    <div className="screen-share-viewers" role="status" aria-label={`Watching: ${names}`} title={`Watching: ${names}`}>
      <span className="screen-share-viewers-label">Watching</span>
      <div className="screen-share-viewers-avatars" aria-hidden="true">
        {visibleViewers.map((viewer) => (
          <span key={viewer.user_id} className="screen-share-viewer-avatar">
            {viewer.avatar_url ? <img src={resolveAvatarUrl(viewer.avatar_url) ?? ''} alt="" /> : viewer.username.charAt(0).toUpperCase()}
          </span>
        ))}
        {remaining > 0 && <span className="screen-share-viewer-avatar screen-share-viewer-avatar--count">+{remaining}</span>}
      </div>
    </div>
  )
}

const RemoteAudioPlaybackLayer = memo(function RemoteAudioPlaybackLayer({
  remoteStreams,
  watchedScreenPeerIds,
  renderAudioElement,
}: RemoteAudioPlaybackLayerProps) {
  return (
    <div style={{ display: 'none' }}>
      {Array.from(remoteStreams.entries()).flatMap(([peerId, stream]) => (
        (['mic', 'screen'] as RemoteAudioKind[]).map((kind) => (
          renderAudioElement(peerId, stream, kind, kind === 'mic' || watchedScreenPeerIds.has(peerId))
        ))
      ))}
    </div>
  )
})

export default function ActiveCallBar({ selectedVoiceChannelId, activeChannelId }: ActiveCallBarProps) {
  const navigate = useNavigate()
  const lightweightMobileVoice = useMemo(() => shouldUseLightweightMobileVoicePipeline(), [])
  const desktopRuntime = useMemo(() => isTauri(), [])
  const {
    state,
    joinVoice,
    leaveVoice,
    startScreenShare,
    stopScreenShare,
    startCamera,
    stopCamera,
    switchCamera,
    setVoiceControls,
    setRemoteMediaSubscribed,
    playVoiceCue,
  } = useLiveKitVoice()
  const { user } = useAuthStore()
  const { members, voiceStates, channels, channelsByServerId, servers, setActiveServer, setActiveChannel, voiceSpeakingUserIds, voiceLocalSpeaking, voiceControls, screenShareViewerIdsByPublisherId } = useAppStore(
    useShallow((s) => ({
      members: s.members,
      voiceStates: s.voiceStates,
      channels: s.channels,
      channelsByServerId: s.channelsByServerId,
      servers: s.servers,
      setActiveServer: s.setActiveServer,
      setActiveChannel: s.setActiveChannel,
      voiceSpeakingUserIds: s.voiceSpeakingUserIds,
      voiceLocalSpeaking: s.voiceLocalSpeaking,
      voiceControls: s.voiceControls,
      screenShareViewerIdsByPublisherId: s.screenShareViewerIdsByPublisherId,
    }))
  )
  const allKnownChannels = useMemo(() => {
    const byId = new Map<string, typeof channels[number]>()
    channels.forEach((channel) => byId.set(channel.id, channel))
    Object.values(channelsByServerId).forEach((serverChannels) => {
      serverChannels.forEach((channel) => {
        if (!byId.has(channel.id)) byId.set(channel.id, channel)
      })
    })
    return [...byId.values()]
  }, [channels, channelsByServerId])
  const voiceLocation = useMemo(() => {
    const shorten = (value: string, max: number) =>
      value.length <= max ? value : `${value.slice(0, Math.max(1, max - 1))}…`

    const id = state.joinedChannelId ?? selectedVoiceChannelId
    if (!id) return { full: 'Voice', display: 'Voice' }
    const ch = allKnownChannels.find((c) => c.id === id)
    if (!ch) return { full: 'Voice', display: 'Voice' }
    const serverName = servers.find((s) => s.id === ch.server_id)?.name ?? 'Server'
    const full = `${serverName} / ${ch.name}`

    return { full, display: shorten(ch.name, 24) }
  }, [state.joinedChannelId, selectedVoiceChannelId, allKnownChannels, servers])
  const goToVoiceChannel = () => {
    const id = state.joinedChannelId ?? selectedVoiceChannelId
    const serverId = id ? allKnownChannels.find((c) => c.id === id)?.server_id ?? null : null
    if (!id || !serverId) return
    setActiveServer(serverId)
    setActiveChannel(id)
    navigate(ROUTES.servers)
  }
  const pushToast = useToastStore((s) => s.pushToast)
  const mapMicPreflightError = useCallback((err: unknown): string | null => {
    const errName = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : ''
    const errMessage = err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message).toLowerCase()
      : ''

    if (isMediaPermissionDeniedError(err, 'microphone')) {
      return desktopMediaPermissionRecoveryMessage('microphone')
    }
    if (errName === 'NotFoundError' || errMessage.includes('device not found') || errMessage.includes('no microphone')) {
      return 'No microphone device detected. Connect a microphone and retry.'
    }
    if (errName === 'NotReadableError' || errMessage.includes('in use by another app')) {
      return 'Microphone is in use by another app. Close other voice apps and retry.'
    }
    if (errMessage.includes('microphone access is not supported')) {
      return 'Microphone capture is not available in this runtime. Update your desktop runtime or use the latest Voxpery desktop build.'
    }
    return null
  }, [])
  const mapCameraError = useCallback((err: unknown): string | null => {
    const errName = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : ''
    const errMessage = err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message).toLowerCase()
      : ''

    if (isMediaPermissionDeniedError(err, 'camera')) {
      return desktopMediaPermissionRecoveryMessage('camera')
    }
    if (errName === 'NotFoundError' || errMessage.includes('no camera') || errMessage.includes('no camera device detected')) {
      return 'No camera device detected. Connect a camera and retry.'
    }
    if (errName === 'NotReadableError' || errMessage.includes('in use by another app') || errMessage.includes('busy') || errMessage.includes('allocate camera video source') || errMessage.includes('allocate videosource')) {
      return 'Camera is busy or unavailable. Close other apps using the camera and retry.'
    }
    if (errMessage.includes('camera access is not supported')) {
      return 'Camera capture is not available in this runtime. Update your desktop runtime or use the latest Voxpery desktop build.'
    }
    return null
  }, [])
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const localControl = user?.id ? voiceControls[user.id] : null
  const serverMuted = !!localControl?.serverMuted
  const serverDeafened = !!localControl?.serverDeafened
  const [blockedAutoJoinChannelId, setBlockedAutoJoinChannelId] = useState<string | null>(null)
  const [showScreenShareConfirm, setShowScreenShareConfirm] = useState(false)
  const [screenShareQuality, setScreenShareQuality] = useState<ScreenShareQuality>(() => readScreenShareQuality())
  const [showCameraConfirm, setShowCameraConfirm] = useState(false)
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 700px)').matches : false
  )
  const lastShownErrorRef = useRef<string | null>(null)
  const OUTPUT_VOL_KEY = 'voxpery-settings-output-volume'
  const DEFAULT_OUTPUT_VOLUME = 80
  const SETTINGS_CHANGED_EVENT = VOICE_SETTINGS_CHANGED_EVENT
  const MIC_TEST_AUTO_DEAFEN_EVENT = 'voxpery-mic-test-auto-deafen'
  const [outputVolume, setOutputVolume] = useState(() =>
    Math.min(100, Math.max(1, Number(localStorage.getItem(OUTPUT_VOL_KEY)) || DEFAULT_OUTPUT_VOLUME))
  )
  const [peerVolumeByUserId, setPeerVolumeByUserId] = useState<Record<string, number>>(
    () => readRemotePlaybackVolumes(),
  )
  const [fullscreenTileKey, setFullscreenTileKey] = useState<string | null>(null)
  const [theaterStreamKey, setTheaterStreamKey] = useState<string | null>(null)
  const [hiddenRemoteMediaKeys, setHiddenRemoteMediaKeys] = useState<Set<string>>(() => new Set())
  const [remoteMediaPlaceholders, setRemoteMediaPlaceholders] = useState<Map<string, RemoteMediaPlaceholder>>(() => new Map())
  const lastVoiceQualityWarningRef = useRef<string | null>(null)
  useEffect(() => {
    const onFullscreenChange = () => {
      const key = document.fullscreenElement?.getAttribute('data-fullscreen-key')
      setFullscreenTileKey(typeof key === 'string' ? key : null)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])
  const outputVolumeRef = useRef(outputVolume)
  const deafenedRef = useRef(deafened)
  const prevMutedBeforeDeafenRef = useRef(false)
  const micTestAutoDeafenedRef = useRef(false)
  const micTestPrevMutedRef = useRef(false)
  const remoteAudioRefsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const remoteAudioRetryTimerRef = useRef<Map<string, number>>(new Map())
  const remoteAudioPlaybackAttemptsRef = useRef<Map<string, RemoteAudioPlaybackAttempt>>(new Map())
  const remoteAudioContextRef = useRef<AudioContext | null>(null)
  const remotePlaybackGraphsRef = useRef<Map<string, RemoteAudioPlaybackGraph>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraPreviewCleanupRef = useRef<(() => void) | null>(null)
  const cameraKeepaliveVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraKeepaliveCleanupRef = useRef<(() => void) | null>(null)
  const screenPreviewVideoRef = useRef<HTMLVideoElement | null>(null)
  const screenPreviewCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    localStreamRef.current = state.localStream
  }, [state.localStream])
  const attachCameraPreviewElement = useCallback((video: HTMLVideoElement | null) => {
    cameraPreviewCleanupRef.current?.()
    cameraPreviewCleanupRef.current = null
    cameraVideoRef.current = video
    if (!video || !state.cameraStream) return
    cameraPreviewCleanupRef.current = attachMediaStreamPreview(video, state.cameraStream)
  }, [state.cameraStream])
  const attachCameraKeepaliveElement = useCallback((video: HTMLVideoElement | null) => {
    cameraKeepaliveCleanupRef.current?.()
    cameraKeepaliveCleanupRef.current = null
    cameraKeepaliveVideoRef.current = video
    if (!video || !state.cameraStream) return
    cameraKeepaliveCleanupRef.current = attachMediaStreamPreview(video, state.cameraStream)
  }, [state.cameraStream])
  const attachScreenPreviewElement = useCallback((video: HTMLVideoElement | null) => {
    screenPreviewCleanupRef.current?.()
    screenPreviewCleanupRef.current = null
    screenPreviewVideoRef.current = video
    if (!video || !state.screenStream) return
    screenPreviewCleanupRef.current = attachMediaStreamPreview(video, state.screenStream)
  }, [state.screenStream])
  useEffect(() => {
    const video = cameraVideoRef.current
    const stream = state.cameraStream
    if (!video || !stream) return
    cameraPreviewCleanupRef.current?.()
    cameraPreviewCleanupRef.current = attachMediaStreamPreview(video, stream)
    return () => {
      cameraPreviewCleanupRef.current?.()
      cameraPreviewCleanupRef.current = null
    }
  }, [state.cameraStream])
  useEffect(() => {
    const video = cameraKeepaliveVideoRef.current
    const stream = state.cameraStream
    if (!video || !stream) return
    cameraKeepaliveCleanupRef.current?.()
    cameraKeepaliveCleanupRef.current = attachMediaStreamPreview(video, stream)
    return () => {
      cameraKeepaliveCleanupRef.current?.()
      cameraKeepaliveCleanupRef.current = null
    }
  }, [state.cameraStream])
  useEffect(() => {
    const video = screenPreviewVideoRef.current
    const stream = state.screenStream
    if (!video || !stream) return
    screenPreviewCleanupRef.current?.()
    screenPreviewCleanupRef.current = attachMediaStreamPreview(video, stream)
    return () => {
      screenPreviewCleanupRef.current?.()
      screenPreviewCleanupRef.current = null
    }
  }, [state.screenStream])
  const resolvePeerVolumeKey = useCallback((peerId: string) => {
    const member = members.find((candidate) => candidate.user_id === peerId)
      ?? members.find((candidate) => candidate.username === peerId)
    return member?.user_id ?? peerId
  }, [members])

  const remoteAudioPlaybackKey = useCallback((peerId: string, kind: RemoteAudioKind) => `${kind}:${peerId}`, [])
  const parseRemoteAudioPlaybackKey = useCallback((playbackKey: string): { peerId: string; kind: RemoteAudioKind } => {
    if (playbackKey.startsWith('screen:')) {
      return { kind: 'screen', peerId: playbackKey.slice('screen:'.length) }
    }
    if (playbackKey.startsWith('mic:')) {
      return { kind: 'mic', peerId: playbackKey.slice('mic:'.length) }
    }
    return { kind: 'mic', peerId: playbackKey }
  }, [])
  const getPlaybackVolumeFactor = useCallback((peerId: string, kind: RemoteAudioKind) => {
    const volumeKey = resolvePeerVolumeKey(peerId)
    return getRemotePlaybackVolume(peerVolumeByUserId, kind === 'screen' ? 'screen' : 'voice', volumeKey) / 100
  }, [peerVolumeByUserId, resolvePeerVolumeKey])

  const disposeRemotePlaybackGraph = useCallback((playbackKey: string) => {
    const graph = remotePlaybackGraphsRef.current.get(playbackKey)
    if (!graph) return
    graph.source.disconnect()
    graph.gain.disconnect()
    graph.limiter?.disconnect()
    graph.destination.disconnect()
    graph.destination.stream.getTracks().forEach((track) => track.stop())
    remotePlaybackGraphsRef.current.delete(playbackKey)
  }, [])

  const getRemoteAudioContext = useCallback((): AudioContext | null => {
    const current = remoteAudioContextRef.current
    if (current && current.state !== 'closed') return current
    const AudioCtor = window.AudioContext
      || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return null
    try {
      const context = new AudioCtor()
      remoteAudioContextRef.current = context
      return context
    } catch {
      return null
    }
  }, [])

  const attachRemoteAudioPlaybackStream = useCallback((
    playbackKey: string,
    kind: RemoteAudioKind,
    playbackStream: MediaStream,
    trackIds: string,
    element: VoxperyAudioElement,
  ) => {
    if (element.__voxpery_trackIds !== trackIds) {
      remoteAudioPlaybackAttemptsRef.current.delete(playbackKey)
      const retryTimer = remoteAudioRetryTimerRef.current.get(playbackKey)
      if (retryTimer != null) {
        window.clearTimeout(retryTimer)
        remoteAudioRetryTimerRef.current.delete(playbackKey)
      }
    }
    const { peerId } = parseRemoteAudioPlaybackKey(playbackKey)
    const playbackVolumeFactor = getPlaybackVolumeFactor(peerId, kind)
    if (shouldUseDirectRemoteAudioPlayback(
      kind,
      lightweightMobileVoice,
      desktopRuntime,
      playbackStream.getAudioTracks().length,
      playbackVolumeFactor,
    )) {
      disposeRemotePlaybackGraph(playbackKey)
      if (element.srcObject !== playbackStream) element.srcObject = playbackStream
      element.muted = shouldMuteRemoteAudioPlayback(kind, deafenedRef.current)
      element.__voxpery_trackIds = trackIds
      return
    }

    const current = remotePlaybackGraphsRef.current.get(playbackKey)
    if (current?.trackIds === trackIds) {
      if (element.srcObject !== current.destination.stream) element.srcObject = current.destination.stream
      element.muted = shouldMuteRemoteAudioPlayback(kind, deafenedRef.current)
      element.__voxpery_trackIds = trackIds
      return
    }

    disposeRemotePlaybackGraph(playbackKey)
    const context = getRemoteAudioContext()
    if (!context) {
      element.srcObject = playbackStream
      element.__voxpery_trackIds = trackIds
      return
    }

    try {
      // Keep every remote source independently playable. If Web Audio cannot be
      // created, the direct MediaStream fallback above remains audible instead
      // of muting every participant behind one shared mixer output.
      const source = context.createMediaStreamSource(playbackStream)
      const gain = context.createGain()
      const destination = context.createMediaStreamDestination()
      const limiter = kind === 'mic' ? context.createDynamicsCompressor() : null
      gain.gain.value = shouldMuteRemoteAudioPlayback(kind, deafenedRef.current)
        ? 0
        : playbackVolumeFactor
      source.connect(gain)
      if (limiter) {
        limiter.threshold.value = -1
        limiter.knee.value = 0
        limiter.ratio.value = 20
        limiter.attack.value = 0.003
        limiter.release.value = 0.1
        gain.connect(limiter)
        limiter.connect(destination)
      } else {
        gain.connect(destination)
      }
      const graph = { trackIds, source, gain, limiter, destination }
      remotePlaybackGraphsRef.current.set(playbackKey, graph)
      element.srcObject = destination.stream
      element.muted = shouldMuteRemoteAudioPlayback(kind, deafenedRef.current)
      element.__voxpery_trackIds = trackIds
      if (context.state === 'suspended') void context.resume().catch(() => {})
    } catch {
      element.srcObject = playbackStream
      element.muted = shouldMuteRemoteAudioPlayback(kind, deafenedRef.current)
      element.__voxpery_trackIds = trackIds
    }
  }, [desktopRuntime, disposeRemotePlaybackGraph, getPlaybackVolumeFactor, getRemoteAudioContext, lightweightMobileVoice, parseRemoteAudioPlaybackKey])

  const ensureRemoteAudioPlayback = useCallback((
    playbackKey: string,
    el: VoxperyAudioElement,
    force = false,
  ) => {
    const retryTimers = remoteAudioRetryTimerRef.current
    const playbackAttempts = remoteAudioPlaybackAttemptsRef.current
    const clearRetry = () => {
      const t = retryTimers.get(playbackKey)
      if (t != null) {
        window.clearTimeout(t)
        retryTimers.delete(playbackKey)
      }
    }
    const trackIds = el.__voxpery_trackIds ?? ''
    if (!trackIds) {
      clearRetry()
      playbackAttempts.delete(playbackKey)
      return
    }
    const current = playbackAttempts.get(playbackKey)
    const samePlayback = current?.element === el && current.trackIds === trackIds
    if (samePlayback && (current.status !== 'playing' || !force)) return

    clearRetry()
    const playbackAttempt: RemoteAudioPlaybackAttempt = {
      element: el,
      trackIds,
      status: 'pending',
    }
    playbackAttempts.set(playbackKey, playbackAttempt)

    const attempt = () => {
      if (playbackAttempts.get(playbackKey) !== playbackAttempt) return
      // Check if element is still available and not muted/deafened
      if (!el || !el.isConnected) {
        console.warn('[ensureRemoteAudioPlayback] Element not connected for playback', playbackKey)
        clearRetry()
        playbackAttempts.delete(playbackKey)
        return
      }
      const { kind } = parseRemoteAudioPlaybackKey(playbackKey)
      if (el.muted || shouldMuteRemoteAudioPlayback(kind, deafenedRef.current)) {
        clearRetry()
        playbackAttempts.delete(playbackKey)
        return
      }
      if (!el.srcObject) {
        console.warn('[ensureRemoteAudioPlayback] No srcObject for playback', playbackKey)
        clearRetry()
        playbackAttempts.delete(playbackKey)
        return
      }

      playbackAttempt.status = 'pending'
      void applyPreferredAudioOutputDevice(el)
      let p: Promise<void> | undefined
      try {
        p = el.play()
      } catch {
        p = Promise.reject(new Error('Remote audio playback failed'))
      }
      if (!p || typeof p.catch !== 'function') {
        console.warn('[ensureRemoteAudioPlayback] play() did not return a promise for playback', playbackKey)
        clearRetry()
        playbackAttempt.status = 'playing'
        return
      }
      p.then(() => {
        if (playbackAttempts.get(playbackKey) !== playbackAttempt) return
        clearRetry()
        playbackAttempt.status = 'playing'
      }).catch(() => {
        if (playbackAttempts.get(playbackKey) !== playbackAttempt) return
        // Suppress expected "The play() request was interrupted by a new load request" warnings
        // Expected interruptions are retried below without surfacing a noisy console warning.
        clearRetry()
        playbackAttempt.status = 'retrying'
        const retry = window.setTimeout(() => {
          attempt()
        }, 500)
        retryTimers.set(playbackKey, retry)
      })
    }
    attempt()
  }, [parseRemoteAudioPlaybackKey])

  const applyOutputDeviceToElements = useCallback(() => {
    for (const el of remoteAudioRefsRef.current.values()) {
      void applyPreferredAudioOutputDevice(el)
    }
  }, [])

  const applyOutputVolumeToElements = useCallback((vol: number) => {
    const global = Math.min(1, Math.max(0, vol))
    const isDeafened = deafenedRef.current
    for (const [playbackKey, playbackGraph] of remotePlaybackGraphsRef.current.entries()) {
      const { peerId, kind } = parseRemoteAudioPlaybackKey(playbackKey)
      const peerFactor = getPlaybackVolumeFactor(peerId, kind)
      const target = shouldMuteRemoteAudioPlayback(kind, isDeafened) ? 0 : peerFactor
      const now = playbackGraph.gain.context.currentTime
      playbackGraph.gain.gain.cancelScheduledValues(now)
      if (target === 0) playbackGraph.gain.gain.setValueAtTime(0, now)
      else playbackGraph.gain.gain.setTargetAtTime(target, now, 0.015)
    }
    for (const [playbackKey, el] of remoteAudioRefsRef.current.entries()) {
      try {
        const { peerId, kind } = parseRemoteAudioPlaybackKey(playbackKey)
        const peerFactor = getPlaybackVolumeFactor(peerId, kind)
        const playbackGraph = remotePlaybackGraphsRef.current.get(playbackKey)
        if (playbackGraph) {
          el.volume = global
          el.muted = shouldMuteRemoteAudioPlayback(kind, isDeafened)
        } else {
          el.volume = Math.min(1, Math.max(0, global * peerFactor))
          el.muted = shouldMuteRemoteAudioPlayback(kind, isDeafened)
        }
      } catch {
        // ignore
      }
    }
  }, [getPlaybackVolumeFactor, parseRemoteAudioPlaybackKey])

  const recoverRemoteAudioPlayback = useCallback(() => {
    applyOutputVolumeToElements(outputVolumeRef.current / 100)
    applyOutputDeviceToElements()

    const audioContext = remoteAudioContextRef.current
    if (audioContext?.state === 'suspended') void audioContext.resume().catch(() => {})
    for (const [playbackKey, element] of remoteAudioRefsRef.current.entries()) {
      const { kind } = parseRemoteAudioPlaybackKey(playbackKey)
      if (shouldMuteRemoteAudioPlayback(kind, deafenedRef.current)) continue
      const stream = element.srcObject
      if (!(stream instanceof MediaStream) || stream.getAudioTracks().length === 0) continue
      ensureRemoteAudioPlayback(playbackKey, element as VoxperyAudioElement, true)
    }
  }, [applyOutputDeviceToElements, applyOutputVolumeToElements, ensureRemoteAudioPlayback, parseRemoteAudioPlaybackKey])

  useEffect(() => {
    const recoverWhenVisible = () => {
      if (document.visibilityState === 'hidden') return
      recoverRemoteAudioPlayback()
    }

    window.addEventListener('focus', recoverRemoteAudioPlayback)
    window.addEventListener('pageshow', recoverRemoteAudioPlayback)
    window.addEventListener(SCREEN_SHARE_CAPTURE_READY_EVENT, recoverRemoteAudioPlayback)
    document.addEventListener('visibilitychange', recoverWhenVisible)
    return () => {
      window.removeEventListener('focus', recoverRemoteAudioPlayback)
      window.removeEventListener('pageshow', recoverRemoteAudioPlayback)
      window.removeEventListener(SCREEN_SHARE_CAPTURE_READY_EVENT, recoverRemoteAudioPlayback)
      document.removeEventListener('visibilitychange', recoverWhenVisible)
    }
  }, [recoverRemoteAudioPlayback])

  useEffect(() => {
    const onSettingsChanged = () => {
      const raw = Math.min(100, Math.max(1, Number(localStorage.getItem(OUTPUT_VOL_KEY)) || DEFAULT_OUTPUT_VOLUME))
      setOutputVolume(raw)
      outputVolumeRef.current = raw
      applyOutputVolumeToElements(raw / 100)
      applyOutputDeviceToElements()
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [SETTINGS_CHANGED_EVENT, applyOutputDeviceToElements, applyOutputVolumeToElements])

  useEffect(() => {
    const onPeerVolumeChanged = () => {
      setPeerVolumeByUserId(readRemotePlaybackVolumes())
    }
    window.addEventListener(REMOTE_PLAYBACK_VOLUME_CHANGED_EVENT, onPeerVolumeChanged)
    return () => window.removeEventListener(REMOTE_PLAYBACK_VOLUME_CHANGED_EVENT, onPeerVolumeChanged)
  }, [])
  const effectiveDeafened = deafened || serverDeafened
  // Playback callbacks can run between a control click and React's next effect.
  // Keep this ref current during render and update it synchronously in controls.
  deafenedRef.current = effectiveDeafened

  useEffect(() => {
    deafenedRef.current = effectiveDeafened
    outputVolumeRef.current = outputVolume
    applyOutputVolumeToElements(outputVolume / 100)
  }, [applyOutputVolumeToElements, effectiveDeafened, outputVolume, peerVolumeByUserId])

  const remoteEntries = useMemo(() => Array.from(state.remoteStreams.entries()), [state.remoteStreams])
  const stablePeerIds = useMemo(() => {
    const ids = Array.from(state.remoteStreams.keys()).sort()
    return ids.join(',')
  }, [state.remoteStreams])
  const currentVoiceChannelId = state.joinedChannelId
  useEffect(() => {
    setHiddenRemoteMediaKeys(new Set())
    setRemoteMediaPlaceholders(new Map())
    setTheaterStreamKey(null)
  }, [currentVoiceChannelId])

  const getRemoteMediaKey = useCallback((peerId: string, kind: RemoteMediaKind) => {
    if (!currentVoiceChannelId) return null
    return remoteMediaVisibilityKey(currentVoiceChannelId, peerId, kind)
  }, [currentVoiceChannelId])

  const isRemoteMediaHidden = useCallback((peerId: string, kind: RemoteMediaKind) => {
    const key = getRemoteMediaKey(peerId, kind)
    return !!key && hiddenRemoteMediaKeys.has(key)
  }, [getRemoteMediaKey, hiddenRemoteMediaKeys])

  const setRemoteMediaHidden = useCallback((peerId: string, kind: RemoteMediaKind, hidden: boolean, label?: string) => {
    const key = getRemoteMediaKey(peerId, kind)
    if (!key) return
    setHiddenRemoteMediaKeys((current) => {
      const next = new Set(current)
      if (hidden) next.add(key)
      else next.delete(key)
      return next
    })
    setRemoteMediaPlaceholders((current) => {
      const next = new Map(current)
      if (hidden) {
        next.set(key, {
          key,
          peerId,
          kind,
          label: label ?? (kind === 'screen' ? 'Screen share' : 'Camera'),
        })
      } else {
        next.delete(key)
      }
      return next
    })
  }, [getRemoteMediaKey])

  // Track total audio track count so we re-trigger playback when screen share audio arrives
  const remoteAudioTrackCount = useMemo(() => {
    let count = 0
    for (const stream of state.remoteStreams.values()) {
      count += stream.getAudioTracks().length
    }
    return count
  }, [state.remoteStreams])
  const remoteVideoTrackEntries = useMemo(() => {
    const entries: Array<{ peerId: string; track: MediaStreamTrack; label: string; kind: RemoteMediaKind }> = []
    for (const [peerId, stream] of remoteEntries) {
      const tracks = stream
        .getVideoTracks()
        .filter((track) => track.readyState === 'live' && !track.muted)
      for (const track of tracks) {
        // Prefer camera: if track was published as Camera, always show "Camera" (not "Screen share")
        if ('__voxpery_isCamera' in track && (track as VoxperyTrack).__voxpery_isCamera) {
          entries.push({ peerId, track, label: 'Camera', kind: 'camera' })
          continue
        }
        // Screen share: authoritative set from useLiveKitVoice or property set on subscribe
        let isScreen = state.remoteScreenTrackIds.has(track.id) || !!(track as VoxperyTrack).__voxpery_isScreenShare
        if (!isScreen) {
          const label = (track.label || '').toLowerCase()
          isScreen =
            label.includes('screen') ||
            label.includes('display') ||
            label.includes('window') ||
            label.includes('tab')
        }
        entries.push({ peerId, track, label: isScreen ? 'Screen share' : 'Camera', kind: isScreen ? 'screen' : 'camera' })
      }
    }
    return entries
  }, [remoteEntries, state.remoteScreenTrackIds])
  const activeTheaterStreamKeys = useMemo(() => {
    const keys: string[] = []
    if (state.isScreenSharing && state.screenStream) keys.push('local-screen')
    for (const { peerId, track, kind } of remoteVideoTrackEntries) {
      if (kind === 'screen' && state.watchedRemoteScreenPeerIds.has(peerId)) {
        keys.push(`screen-${peerId}-${track.id}`)
      }
    }
    return keys
  }, [remoteVideoTrackEntries, state.isScreenSharing, state.screenStream, state.watchedRemoteScreenPeerIds])
  const hasTheaterFocus = theaterStreamKey !== null && activeTheaterStreamKeys.includes(theaterStreamKey)

  useEffect(() => {
    if (theaterStreamKey && !activeTheaterStreamKeys.includes(theaterStreamKey)) {
      setTheaterStreamKey(null)
    }
  }, [activeTheaterStreamKeys, theaterStreamKey])
  const activeRemoteMediaKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const entry of remoteVideoTrackEntries) {
      const key = getRemoteMediaKey(entry.peerId, entry.kind)
      if (key) keys.add(key)
    }
    return keys
  }, [getRemoteMediaKey, remoteVideoTrackEntries])
  const remoteMediaPlaceholdersToRender = useMemo(
    () => Array.from(remoteMediaPlaceholders.values()),
    [remoteMediaPlaceholders],
  )
  const watchedRemoteScreenPeerIds = state.watchedRemoteScreenPeerIds

  useEffect(() => {
    for (const [peerId, stream] of state.remoteStreams.entries()) {
      const entries: Array<{ kind: RemoteAudioKind; include: boolean }> = [
        { kind: 'mic', include: true },
        { kind: 'screen', include: watchedRemoteScreenPeerIds.has(peerId) },
      ]
      for (const { kind, include } of entries) {
        const playbackKey = remoteAudioPlaybackKey(peerId, kind)
        const el = remoteAudioRefsRef.current.get(playbackKey) as VoxperyAudioElement | undefined
        if (!el) continue
        const playbackStream = include ? createRemoteAudioKindPlaybackStream(stream, kind) : new MediaStream()
        const currentTrackIds = playbackStream.getTracks().map(t => t.id).sort().join(',')
        const prevTrackIds = el.__voxpery_trackIds
        const directPlaybackExpected = shouldUseDirectRemoteAudioPlayback(
          kind,
          lightweightMobileVoice,
          desktopRuntime,
          playbackStream.getAudioTracks().length,
          getPlaybackVolumeFactor(peerId, kind),
        )
        const playbackModeChanged = remotePlaybackGraphsRef.current.has(playbackKey) === directPlaybackExpected
        if (currentTrackIds !== prevTrackIds || playbackModeChanged) {
          attachRemoteAudioPlaybackStream(playbackKey, kind, playbackStream, currentTrackIds, el)
        }
        const playbackGraph = remotePlaybackGraphsRef.current.get(playbackKey)
        const shouldMute = shouldMuteRemoteAudioPlayback(kind, deafenedRef.current)
        el.muted = shouldMute
        if (playbackGraph) {
          const { peerId: graphPeerId } = parseRemoteAudioPlaybackKey(playbackKey)
          playbackGraph.gain.gain.value = shouldMute ? 0 : getPlaybackVolumeFactor(graphPeerId, kind)
        }
        if (!shouldMute && currentTrackIds) {
          ensureRemoteAudioPlayback(playbackKey, el)
        }
      }
    }
    for (const playbackKey of remotePlaybackGraphsRef.current.keys()) {
      const { peerId } = parseRemoteAudioPlaybackKey(playbackKey)
      if (!state.remoteStreams.has(peerId)) disposeRemotePlaybackGraph(playbackKey)
    }
    if (remotePlaybackGraphsRef.current.size === 0) {
      const context = remoteAudioContextRef.current
      if (context?.state === 'running') void context.suspend().catch(() => {})
    }
    applyOutputVolumeToElements(outputVolumeRef.current / 100)
  }, [applyOutputVolumeToElements, attachRemoteAudioPlaybackStream, desktopRuntime, disposeRemotePlaybackGraph, getPlaybackVolumeFactor, lightweightMobileVoice, parseRemoteAudioPlaybackKey, watchedRemoteScreenPeerIds, remoteAudioPlaybackKey, stablePeerIds, remoteAudioTrackCount, ensureRemoteAudioPlayback, state.remoteStreams])

  useEffect(() => {
    const retryTimers = remoteAudioRetryTimerRef.current
    const playbackAttempts = remoteAudioPlaybackAttemptsRef.current
    const playbackGraphs = remotePlaybackGraphsRef.current
    return () => {
      for (const t of retryTimers.values()) {
        window.clearTimeout(t)
      }
      retryTimers.clear()
      playbackAttempts.clear()
      for (const playbackKey of playbackGraphs.keys()) {
        disposeRemotePlaybackGraph(playbackKey)
      }
      const context = remoteAudioContextRef.current
      remoteAudioContextRef.current = null
      if (context && context.state !== 'closed') void context.close().catch(() => {})
    }
  }, [disposeRemotePlaybackGraph])

  const renderRemoteAudioElement = useCallback((
    peerId: string,
    stream: MediaStream,
    kind: RemoteAudioKind,
    include: boolean,
  ) => {
    const playbackKey = remoteAudioPlaybackKey(peerId, kind)
    return (
      <audio
        key={playbackKey}
        data-peer-id={peerId}
        data-remote-audio-kind={kind}
        autoPlay
        playsInline
        ref={(el) => {
          if (el) {
            const audioEl = el as VoxperyAudioElement
            remoteAudioRefsRef.current.set(playbackKey, audioEl)
            const playbackStream = include ? createRemoteAudioKindPlaybackStream(stream, kind) : new MediaStream()
            const currentTrackIds = playbackStream.getTracks().map(t => t.id).sort().join(',')
            const directPlaybackExpected = shouldUseDirectRemoteAudioPlayback(
              kind,
              lightweightMobileVoice,
              desktopRuntime,
              playbackStream.getAudioTracks().length,
              getPlaybackVolumeFactor(peerId, kind),
            )
            const playbackModeChanged = remotePlaybackGraphsRef.current.has(playbackKey) === directPlaybackExpected
            if (audioEl.__voxpery_trackIds !== currentTrackIds || playbackModeChanged) {
              attachRemoteAudioPlaybackStream(playbackKey, kind, playbackStream, currentTrackIds, audioEl)
            }
            const shouldMute = shouldMuteRemoteAudioPlayback(kind, deafenedRef.current)
            const peerFactor = getPlaybackVolumeFactor(peerId, kind)
            const playbackGraph = remotePlaybackGraphsRef.current.get(playbackKey)
            if (playbackGraph) {
              playbackGraph.gain.gain.value = shouldMute ? 0 : peerFactor
            }
            const vol = playbackGraph
              ? Math.min(1, Math.max(0, outputVolumeRef.current / 100))
              : Math.min(1, Math.max(0, (outputVolumeRef.current / 100) * peerFactor))
            try { audioEl.volume = vol } catch (e) { console.warn('[ActiveCallBar] Failed to set volume:', e) }
            audioEl.muted = shouldMute
            if (!shouldMute && currentTrackIds) ensureRemoteAudioPlayback(playbackKey, audioEl)
          } else {
            const detachedElement = remoteAudioRefsRef.current.get(playbackKey)
            queueMicrotask(() => {
              // React briefly invokes an old callback ref with null when the
              // same keyed audio node receives a new ref callback. Only tear
              // down playback state after a real DOM detach or replacement.
              if (!detachedElement || detachedElement.isConnected) return
              if (remoteAudioRefsRef.current.get(playbackKey) !== detachedElement) return
              remoteAudioRefsRef.current.delete(playbackKey)
              remoteAudioPlaybackAttemptsRef.current.delete(playbackKey)
              const timer = remoteAudioRetryTimerRef.current.get(playbackKey)
              if (timer != null) {
                window.clearTimeout(timer)
                remoteAudioRetryTimerRef.current.delete(playbackKey)
              }
            })
          }
        }}
      />
    )
  }, [attachRemoteAudioPlaybackStream, desktopRuntime, ensureRemoteAudioPlayback, getPlaybackVolumeFactor, lightweightMobileVoice, remoteAudioPlaybackKey])

  const showActiveCallBar = !!(state.joinedChannelId || state.localStream || state.isJoining)
  const channelParticipants = useMemo(() => {
    if (!currentVoiceChannelId) return []
    return members.filter((m) => voiceStates[m.user_id] === currentVoiceChannelId)
  }, [currentVoiceChannelId, members, voiceStates])
  const availableRemoteScreenPeerIds = useMemo(() => (
    channelParticipants
      .filter((participant) => participant.user_id !== user?.id && voiceControls[participant.user_id]?.screenSharing)
      .map((participant) => participant.user_id)
  ), [channelParticipants, user?.id, voiceControls])
  const activeRemoteScreenPeerIds = useMemo(() => new Set(
    remoteVideoTrackEntries
      .filter((entry) => entry.kind === 'screen')
      .map((entry) => entry.peerId),
  ), [remoteVideoTrackEntries])
  const remoteScreenSharePlaceholders = useMemo(() => (
    availableRemoteScreenPeerIds.filter((peerId) => (
      !watchedRemoteScreenPeerIds.has(peerId) || !activeRemoteScreenPeerIds.has(peerId)
    ))
  ), [activeRemoteScreenPeerIds, availableRemoteScreenPeerIds, watchedRemoteScreenPeerIds])
  const getScreenShareViewerIds = useCallback((publisherId: string) => (
    (screenShareViewerIdsByPublisherId[publisherId] ?? []).filter((viewerId) => (
      viewerId !== publisherId && voiceStates[viewerId] === currentVoiceChannelId
    ))
  ), [currentVoiceChannelId, screenShareViewerIdsByPublisherId, voiceStates])
  useEffect(() => {
    if (remoteMediaPlaceholders.size === 0) return
    const participantIds = new Set(channelParticipants.map((participant) => participant.user_id))
    const staleKeys = new Set<string>()
    for (const placeholder of remoteMediaPlaceholders.values()) {
      const participantId = resolvePeerVolumeKey(placeholder.peerId)
      const control = voiceControls[participantId]
      const mediaStopped = !activeRemoteMediaKeys.has(placeholder.key) && (
        placeholder.kind === 'screen'
          ? control?.screenSharing === false
          : control?.cameraOn === false
      )
      const participantLeft = channelParticipants.length > 0 && !participantIds.has(participantId)
      if (mediaStopped || participantLeft) staleKeys.add(placeholder.key)
    }
    if (staleKeys.size === 0) return
    setRemoteMediaPlaceholders((current) => {
      const next = new Map(current)
      staleKeys.forEach((key) => next.delete(key))
      return next
    })
    setHiddenRemoteMediaKeys((current) => {
      const next = new Set(current)
      staleKeys.forEach((key) => next.delete(key))
      return next
    })
  }, [activeRemoteMediaKeys, channelParticipants, remoteMediaPlaceholders, resolvePeerVolumeKey, voiceControls])

  const isInThisChannel = useMemo(() => {
    return !!selectedVoiceChannelId && state.joinedChannelId === selectedVoiceChannelId
  }, [selectedVoiceChannelId, state.joinedChannelId])
  // Only show the big voice stage when user is actually viewing the voice channel (clicked it in sidebar), not when on General/Social.
  const isViewingVoiceChannel = activeChannelId === selectedVoiceChannelId
  const showVoiceStage =
    isViewingVoiceChannel &&
    isInThisChannel &&
    (channelParticipants.length > 0 || state.isScreenSharing || !!state.cameraStream || remoteVideoTrackEntries.length > 0 || availableRemoteScreenPeerIds.length > 0)

  const getStageColumns = (tileCount: number) => {
    if (isMobileViewport) {
      if (tileCount <= 2) return 1
      if (tileCount <= 6) return 2
      return 3
    }
    if (tileCount <= 1) return 1
    if (tileCount === 2) return 2
    if (tileCount <= 4) return 2
    if (tileCount <= 9) return 3
    return 4
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(max-width: 700px)')
    const sync = () => setIsMobileViewport(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (isMobileViewport && showActiveCallBar) {
      root.style.setProperty('--mobile-voice-callbar-offset', '0px')
      return () => {
        root.style.removeProperty('--mobile-voice-callbar-offset')
      }
    }
    root.style.removeProperty('--mobile-voice-callbar-offset')
    return () => {
      root.style.removeProperty('--mobile-voice-callbar-offset')
    }
  }, [isMobileViewport, showActiveCallBar])

  // Auto-join disabled intentionally:
  // voice join/leave should only happen on explicit user action (sidebar confirm or callbar button).

  // Expose joinVoice to window for ChannelSidebar
  useEffect(() => {
    const joinFn = async (channelId: string, preflightStream?: MediaStream) => {
      if (!channelId) return
      if (state.isJoining) return
      if (state.joinedChannelId === channelId) return
      if (state.joinedChannelId && state.joinedChannelId !== channelId) {
        leaveVoice({ skipLeaveSound: true })
      }
      if (preflightStream) {
        await joinVoice(channelId, { preflightStream })
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        await joinVoice(channelId)
        return
      }
      let micStream: MediaStream | null = null
      try {
        micStream = await getPreferredMicrophoneStream()
        await joinVoice(channelId, { preflightStream: micStream })
      } catch (err: unknown) {
        micStream?.getTracks().forEach((t) => t.stop())
        const message = mapMicPreflightError(err)
        if (message) {
          if (isMediaPermissionDeniedError(err, 'microphone')) {
            void openDesktopMediaPermissionSettings('microphone')
          }
          pushToast({ level: 'error', title: 'Microphone access required', message })
          return
        }
        throw err // Rethrow LiveKit or connection errors so ChannelSidebar handles them
      }
    }
    ; (window as Window & { __voxperyJoinVoice?: (channelId: string, preflightStream?: MediaStream) => void }).__voxperyJoinVoice = joinFn
    return () => {
      if ((window as Window & { __voxperyJoinVoice?: (channelId: string, preflightStream?: MediaStream) => void }).__voxperyJoinVoice === joinFn) {
        delete (window as Window & { __voxperyJoinVoice?: (channelId: string, preflightStream?: MediaStream) => void }).__voxperyJoinVoice
      }
    }
  }, [joinVoice, leaveVoice, mapMicPreflightError, pushToast, state.isJoining, state.joinedChannelId])

  useEffect(() => {
    if (!blockedAutoJoinChannelId) return
    if (selectedVoiceChannelId !== blockedAutoJoinChannelId) {
      queueMicrotask(() => setBlockedAutoJoinChannelId(null))
    }
  }, [blockedAutoJoinChannelId, selectedVoiceChannelId])

  useEffect(() => {
    if (!state.lastError) {
      lastShownErrorRef.current = null
      return
    }
    if (state.lastError === lastShownErrorRef.current) return
    lastShownErrorRef.current = state.lastError

    const { level, title, message } = classifyVoiceError(state.lastError)

    pushToast({
      level,
      title,
      message,
    })
  }, [pushToast, state.lastError])

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current ?? state.localStream
    if (!state.joinedChannelId || !stream || deafened) return
    const next = !muted
    const shouldMuteTrack = next || deafened || serverMuted || serverDeafened
    for (const t of stream.getAudioTracks()) t.enabled = !shouldMuteTrack
    setMuted(next)
    setVoiceControls(next, deafened, state.isScreenSharing)
    playVoiceCue(next ? 'mute' : 'unmute')
  }, [
    deafened,
    muted,
    playVoiceCue,
    serverDeafened,
    serverMuted,
    setVoiceControls,
    state.isScreenSharing,
    state.joinedChannelId,
    state.localStream,
  ])

  useEffect(() => {
    const onGlobalMuteShortcut = () => toggleMute()
    window.addEventListener(GLOBAL_MUTE_SHORTCUT_EVENT, onGlobalMuteShortcut)
    return () => window.removeEventListener(GLOBAL_MUTE_SHORTCUT_EVENT, onGlobalMuteShortcut)
  }, [toggleMute])

  useEffect(() => {
    if (isTauri()) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableShortcutTarget(event.target)) return
      if (!keyboardEventMatchesShortcut(event, getStoredGlobalMuteShortcut())) return
      event.preventDefault()
      toggleMute()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleMute])

  const joinWithPreflight = async (channelId: string) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      pushToast({
        level: 'error',
        title: 'Voice action failed',
        message: 'Microphone access is not supported in this browser.',
      })
      return
    }
    let stream: MediaStream | null = null
    try {
      stream = await getPreferredMicrophoneStream()
      await joinVoice(channelId, { preflightStream: stream })
    } catch (err: unknown) {
      stream?.getTracks().forEach((t) => t.stop())
      const message = mapMicPreflightError(err)
      if (message) {
        if (isMediaPermissionDeniedError(err, 'microphone')) {
          void openDesktopMediaPermissionSettings('microphone')
        }
        pushToast({ level: 'error', title: 'Microphone access required', message })
        return
      }
      throw err
    }
  }

  const handleJoinLeave = async () => {
    if (!selectedVoiceChannelId && !state.joinedChannelId) return
    if (!selectedVoiceChannelId) return
    if (isInThisChannel) {
      micTestAutoDeafenedRef.current = false
      setVoiceControls(false, false, false)
      leaveVoice()
      setDeafened(false)
      setMuted(false)
      setBlockedAutoJoinChannelId(selectedVoiceChannelId)
    } else {
      await joinWithPreflight(selectedVoiceChannelId)
      micTestAutoDeafenedRef.current = false
      setMuted(false)
      setDeafened(false)
      setVoiceControls(false, false, false)
      setBlockedAutoJoinChannelId(null)
    }
  }

  const toggleDeafen = () => {
    if (!state.joinedChannelId) return
    micTestAutoDeafenedRef.current = false
    const stream = localStreamRef.current ?? state.localStream
    const nextDeafened = !deafened
    deafenedRef.current = nextDeafened || serverDeafened
    applyOutputVolumeToElements(outputVolumeRef.current / 100)
    if (nextDeafened) {
      prevMutedBeforeDeafenRef.current = muted
      if (stream) {
        for (const t of stream.getAudioTracks()) t.enabled = false
      }
      setDeafened(true)
      setMuted(true)
      setVoiceControls(true, true, state.isScreenSharing)
    } else {
      const restoreMuted = prevMutedBeforeDeafenRef.current
      if (stream) {
        const shouldMuteTrack = restoreMuted || serverMuted || serverDeafened
        for (const t of stream.getAudioTracks()) t.enabled = !shouldMuteTrack
      }
      setDeafened(false)
      setMuted(restoreMuted)
      setVoiceControls(restoreMuted, false, state.isScreenSharing)
    }
    playVoiceCue(nextDeafened ? 'deafen' : 'undeafen')
  }

  useEffect(() => {
    const onMicTestAutoDeafen = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled?: boolean }>
      const enabled = !!customEvent.detail?.enabled
      if (!state.joinedChannelId) return
      if (serverDeafened) return
      const stream = localStreamRef.current ?? state.localStream

      if (enabled) {
        if (deafened) return
        deafenedRef.current = true
        applyOutputVolumeToElements(outputVolumeRef.current / 100)
        micTestPrevMutedRef.current = muted
        micTestAutoDeafenedRef.current = true
        if (stream) {
          for (const t of stream.getAudioTracks()) t.enabled = false
        }
        setDeafened(true)
        setMuted(true)
        setVoiceControls(true, true, state.isScreenSharing)
        return
      }

      if (!micTestAutoDeafenedRef.current) return
      micTestAutoDeafenedRef.current = false
      const restoreMuted = micTestPrevMutedRef.current
      deafenedRef.current = false
      applyOutputVolumeToElements(outputVolumeRef.current / 100)
      if (stream) {
        const shouldMuteTrack = restoreMuted || serverMuted || serverDeafened
        for (const t of stream.getAudioTracks()) t.enabled = !shouldMuteTrack
      }
      setDeafened(false)
      setMuted(restoreMuted)
      setVoiceControls(restoreMuted, false, state.isScreenSharing)
    }

    window.addEventListener(MIC_TEST_AUTO_DEAFEN_EVENT, onMicTestAutoDeafen as EventListener)
    return () => window.removeEventListener(MIC_TEST_AUTO_DEAFEN_EVENT, onMicTestAutoDeafen as EventListener)
  }, [
    deafened,
    applyOutputVolumeToElements,
    muted,
    serverDeafened,
    serverMuted,
    setVoiceControls,
    state.isScreenSharing,
    state.joinedChannelId,
    state.localStream,
  ])

  const handleScreenShare = async () => {
    if (!state.joinedChannelId) return
    if (state.isScreenSharing) {
      stopScreenShare()
      playVoiceCue('screen-stop')
      return
    }
    setScreenShareQuality(readScreenShareQuality())
    setShowScreenShareConfirm(true)
  }

  const confirmScreenShare = async () => {
    setShowScreenShareConfirm(false)
    try {
      localStorage.setItem('voxpery-settings-screen-share-quality', screenShareQuality)
      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
    } catch {
      void 0
    }
    try {
      await startScreenShare()
      playVoiceCue('screen-start')
    } catch (e) {
      const permissionDenied = isMediaPermissionDeniedError(e, 'screen')
      const message = permissionDenied
        ? desktopMediaPermissionRecoveryMessage('screen')
        : e instanceof Error
          ? e.message
          : 'Unable to start screen sharing. Check permission and active window selection.'
      pushToast({ level: 'error', title: 'Screen share failed', message })
    }
  }

  const handleCamera = () => {
    if (!state.joinedChannelId) return
    if (state.cameraStream) {
      stopCamera()
      playVoiceCue('camera-stop')
      return
    }
    setShowCameraConfirm(true)
  }

  const handleSwitchCamera = async () => {
    if (isSwitchingCamera || !state.cameraStream || !state.canSwitchCamera) return
    setIsSwitchingCamera(true)
    try {
      await switchCamera()
    } catch (error) {
      const message = mapCameraError(error)
        ?? (error instanceof Error ? error.message : 'Could not switch camera.')
      pushToast({ level: 'error', title: 'Camera switch failed', message })
    } finally {
      setIsSwitchingCamera(false)
    }
  }

  useEffect(() => {
    const stream = localStreamRef.current ?? state.localStream
    if (!stream) return
    const shouldMuteTrack = muted || deafened || serverMuted || serverDeafened
    for (const t of stream.getAudioTracks()) t.enabled = !shouldMuteTrack
  }, [deafened, muted, serverDeafened, serverMuted, state.localStream])

  useEffect(() => {
    if (!showScreenShareConfirm && !showCameraConfirm) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (showCameraConfirm) {
        setShowCameraConfirm(false)
        return
      }
      if (showScreenShareConfirm) {
        setShowScreenShareConfirm(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showScreenShareConfirm, showCameraConfirm])

  const confirmCamera = async () => {
    setShowCameraConfirm(false)
    try {
      await startCamera()
      playVoiceCue('camera-start')
    } catch (e) {
      if (isMediaPermissionDeniedError(e, 'camera')) {
        void openDesktopMediaPermissionSettings('camera')
      }
      const message = mapCameraError(e) ?? (e instanceof Error ? e.message : 'Could not access camera. Check permission.')
      pushToast({ level: 'error', title: 'Camera failed', message })
    }
  }

  const handleTileMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const tile = e.currentTarget as VoxperyHTMLDivElement
    tile.classList.remove('is-mouse-idle')
    const to = tile._idleTimeout
    if (to) clearTimeout(to)
    tile._idleTimeout = setTimeout(() => {
      tile.classList.add('is-mouse-idle')
    }, 1000)
  }

  const handleTileMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const tile = e.currentTarget as VoxperyHTMLDivElement
    tile.classList.remove('is-mouse-idle')
    const to = tile._idleTimeout
    if (to) clearTimeout(to)
  }

  const localInitial = (user?.username?.charAt(0) || 'Y').toUpperCase()
  const remoteShareOwner = (peerId: string) => members.find((m) => m.user_id === peerId)?.username ?? 'User'
  const localFallbackTileCount = currentVoiceChannelId && !channelParticipants.some((p) => p.user_id === user?.id) ? 1 : 0
  const visibleRemoteMediaTileCount = remoteVideoTrackEntries.filter((entry) => (
    entry.kind === 'screen'
      ? watchedRemoteScreenPeerIds.has(entry.peerId)
      : !isRemoteMediaHidden(entry.peerId, entry.kind)
  )).length
  const totalStageTiles = channelParticipants.length
    + localFallbackTileCount
    + (state.isScreenSharing && state.screenStream ? 1 : 0)
    + (state.cameraStream ? 1 : 0)
    + visibleRemoteMediaTileCount
    + remoteMediaPlaceholdersToRender.length
    + remoteScreenSharePlaceholders.length
  const stageColumns = getStageColumns(totalStageTiles)
  const stageDensity = totalStageTiles > 9 ? 'dense' : totalStageTiles > 6 ? 'crowded' : 'standard'
  const roomState = state.livekit.roomState
  const roomConnected = roomState === 'connected'
  const roomReconnecting = roomState === 'reconnecting'
  const joiningTargetChannelId = state.isJoining ? selectedVoiceChannelId : null
  const hasActiveVoiceSession = !!(state.joinedChannelId || joiningTargetChannelId)
  const isDisconnectVisualActive = hasActiveVoiceSession
  const isDisconnectPendingVisual = hasActiveVoiceSession && !roomConnected
  const pingLevel = getVoicePingLevel(hasActiveVoiceSession, state.pingMs)
  const pingStateClass =
    pingLevel === 'good'
      ? 'is-good'
      : pingLevel === 'fair'
        ? 'is-mid'
        : pingLevel === 'poor'
          ? 'is-bad'
          : 'is-unknown'
  const pingDisplay = formatMetric(state.pingMs, 'ms', '...')
  const pingAriaLabel = !hasActiveVoiceSession
    ? 'Voice ping: not in voice'
    : `Voice ping: ${pingDisplay}.`
  const micControlLabel = muted
    ? 'Unmute microphone'
    : (serverMuted || serverDeafened)
      ? 'Muted by server'
      : 'Mute microphone'
  const deafenControlLabel = deafened
    ? 'Undeafen'
    : serverDeafened
      ? 'Deafened by server'
      : 'Deafen'
  const cameraControlLabel = state.cameraStream ? 'Turn off camera' : 'Turn on camera'
  const screenShareControlLabel = state.isScreenSharing ? 'Stop sharing' : 'Share screen'
  const disconnectControlLabel = isDisconnectVisualActive ? 'Leave voice channel' : 'Join voice channel'

  useEffect(() => {
    if (!hasActiveVoiceSession) {
      lastVoiceQualityWarningRef.current = null
      return
    }

    const warningKey = roomReconnecting ? 'reconnecting' : null
    if (!warningKey || lastVoiceQualityWarningRef.current === warningKey) return
    lastVoiceQualityWarningRef.current = warningKey

    pushToast({
      level: 'info',
      title: 'Voice reconnecting',
      message: 'Voice is reconnecting. Stay in the channel while Voxpery resyncs.',
    })
  }, [hasActiveVoiceSession, pushToast, roomReconnecting])

  const screenShareModal = showScreenShareConfirm && (
    <div className="modal-overlay modal-overlay--compact" onClick={() => setShowScreenShareConfirm(false)}>
      <div className="modal screen-share-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Share your screen</h3>
        <p>Only share content you&apos;re comfortable with. Everyone in this channel will see your screen.</p>
        <div className="screen-share-quality-picker">
          <label htmlFor="screen-share-quality-select">Screen share quality</label>
          <select id="screen-share-quality-select" className="user-select" value={screenShareQuality} onChange={(e) => setScreenShareQuality(e.target.value as ScreenShareQuality)}>
            <option value="auto">Auto</option>
            <option value="presentation">Presentation</option>
            <option value="video">Video</option>
            <option value="gaming">Gaming</option>
          </select>
          <div className="screen-share-quality-summary">{screenShareQualitySummary(screenShareQuality)}</div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setShowScreenShareConfirm(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirmScreenShare()}>Share screen</button>
        </div>
      </div>
    </div>
  )

  const cameraModal = showCameraConfirm && (
    <div className="modal-overlay modal-overlay--compact" onClick={() => setShowCameraConfirm(false)}>
      <div className="modal screen-share-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Turn on camera</h3>
        <p>Everyone in this channel will see your camera. Only turn it on if you&apos;re comfortable with that.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setShowCameraConfirm(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirmCamera()}>Turn on camera</button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {state.cameraStream && (
        <video
          ref={attachCameraKeepaliveElement}
          autoPlay
          muted
          playsInline
          aria-hidden="true"
          tabIndex={-1}
          style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: -9999, top: -9999 }}
        />
      )}
      {typeof document !== 'undefined' && createPortal(screenShareModal, document.body)}
      {typeof document !== 'undefined' && createPortal(cameraModal, document.body)}
      {showActiveCallBar && (
        <>
          {showVoiceStage && (
            <div
              className={`screen-share-stage${hasTheaterFocus ? ' screen-share-stage--theater' : ''}`}
              data-stage-density={stageDensity}
              data-stage-columns={stageColumns}
              data-theater-mode={hasTheaterFocus ? 'true' : undefined}
              style={hasTheaterFocus ? undefined : { gridTemplateColumns: `repeat(${stageColumns}, minmax(0, 1fr))` }}
            >
              {channelParticipants.map((p) => {
                const isLocal = p.user_id === user?.id
                const participantControl = voiceControls[p.user_id]
                const participantSilenced = !!(
                  participantControl?.muted
                  || participantControl?.deafened
                  || participantControl?.serverMuted
                  || participantControl?.serverDeafened
                )
                const pSpeaking = (
                  isLocal ? voiceLocalSpeaking : voiceSpeakingUserIds.includes(p.user_id)
                ) && !participantSilenced && (isLocal || !effectiveDeafened)
                return (
                  <div key={`participant-${p.user_id}`} className="voice-stage-tile">
                    <div className={`voice-stage-avatar${pSpeaking ? ' is-speaking' : ''}`}>
                      {p.avatar_url ? <img src={resolveAvatarUrl(p.avatar_url) ?? ''} alt="" /> : (p.username.charAt(0) || '?').toUpperCase()}
                    </div>
                    <div className={`voice-stage-name${pSpeaking ? ' is-speaking' : ''}`}>{p.username}</div>
                    <div className="voice-stage-sub"><Users size={12} />In voice</div>
                  </div>
                )
              })}
              {currentVoiceChannelId && !channelParticipants.some((p) => p.user_id === user?.id) && (
                <div key="participant-local-fallback" className="voice-stage-tile">
                  <div className={`voice-stage-avatar${voiceLocalSpeaking && !(muted || deafened || serverMuted || serverDeafened) ? ' is-speaking' : ''}`}>
                    {user?.avatar_url ? <img src={resolveAvatarUrl(user.avatar_url) ?? ''} alt="" /> : localInitial}
                  </div>
                  <div className={`voice-stage-name${voiceLocalSpeaking && !(muted || deafened || serverMuted || serverDeafened) ? ' is-speaking' : ''}`}>{user?.username ?? 'You'}</div>
                  <div className="voice-stage-sub"><Users size={12} />In voice</div>
                </div>
              )}
              {state.cameraStream && (
                <div className="screen-share-preview voice-stage-share-tile camera-preview" data-fullscreen-key="camera" onMouseMove={handleTileMouseMove} onMouseLeave={handleTileMouseLeave}>
                  <video ref={attachCameraPreviewElement} autoPlay muted playsInline style={{ objectFit: 'cover', width: '100%', height: '100%', backgroundColor: '#000' }} />
                  <div className="screen-share-info-overlay"><span className="screen-share-info-text">Camera · You</span></div>
                  <div className="screen-share-controls-bar">
                    <div className="screen-share-controls-left" />
                    <div className="screen-share-controls-right">
                      {isMobileViewport && state.canSwitchCamera && (
                        <button
                          type="button"
                          className="screen-share-controls-btn"
                          title={state.cameraFacingMode === 'user' ? 'Switch to rear camera' : 'Switch to front camera'}
                          aria-label={state.cameraFacingMode === 'user' ? 'Switch to rear camera' : 'Switch to front camera'}
                          aria-busy={isSwitchingCamera}
                          disabled={isSwitchingCamera}
                          onClick={() => void handleSwitchCamera()}
                        >
                          <SwitchCameraIcon size={16} />
                        </button>
                      )}
                      <button type="button" className="screen-share-controls-btn" title="Toggle fullscreen" onClick={(e) => {
                        const tile = (e.currentTarget as HTMLElement).closest('.screen-share-preview') as HTMLElement | null
                        if (!tile) return
                        if (document.fullscreenElement) void document.exitFullscreen().catch(() => { })
                        else void tile.requestFullscreen?.().catch(() => { })
                      }}>
                        {fullscreenTileKey === 'camera' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {state.isScreenSharing && state.screenStream && (
                <div className={`screen-share-preview voice-stage-share-tile${theaterStreamKey === 'local-screen' ? ' is-theater-focused' : ''}`} data-fullscreen-key="screen" onMouseMove={handleTileMouseMove} onMouseLeave={handleTileMouseLeave}>
                  <video autoPlay muted playsInline ref={attachScreenPreviewElement} />
                  <div className="screen-share-info-overlay"><span className="screen-share-info-text">Screen share · You</span></div>
                  {user?.id && <ScreenShareViewerAvatars viewerIds={getScreenShareViewerIds(user.id)} members={members} />}
                  <div className="screen-share-controls-bar">
                    <div className="screen-share-controls-left" />
                    <div className="screen-share-controls-right">
                      <button
                        type="button"
                        className="screen-share-controls-btn"
                        title={theaterStreamKey === 'local-screen' ? 'Exit focus view' : 'Focus stream'}
                        aria-label={theaterStreamKey === 'local-screen' ? 'Exit focus view' : 'Focus stream'}
                        onClick={() => setTheaterStreamKey((current) => current === 'local-screen' ? null : 'local-screen')}
                      >
                        {theaterStreamKey === 'local-screen' ? <LayoutGrid size={16} /> : <PanelsTopLeft size={16} />}
                      </button>
                      <button type="button" className="screen-share-controls-btn" title="Toggle fullscreen" onClick={(e) => {
                        const tile = (e.currentTarget as HTMLElement).closest('.screen-share-preview') as HTMLElement | null
                        if (!tile) return
                        if (document.fullscreenElement) void document.exitFullscreen().catch(() => { })
                        else void tile.requestFullscreen?.().catch(() => { })
                      }}>
                        {fullscreenTileKey === 'screen' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {remoteScreenSharePlaceholders.map((peerId) => {
                const isConnecting = watchedRemoteScreenPeerIds.has(peerId)
                return (
                  <div key={`screen-available-${peerId}`} className="voice-stage-hidden-media-tile">
                    <div className="voice-stage-hidden-media-icon">
                      <Monitor size={18} />
                    </div>
                    <div className="voice-stage-hidden-media-title">
                      {isConnecting ? 'Connecting to stream' : 'Stream available'}
                    </div>
                    <div className="voice-stage-hidden-media-sub">{remoteShareOwner(peerId)}</div>
                    <ScreenShareViewerAvatars viewerIds={getScreenShareViewerIds(peerId)} members={members} />
                    {!isConnecting && (
                      <button
                        type="button"
                        className="voice-stage-hidden-media-show"
                        onClick={() => setRemoteMediaSubscribed(peerId, 'screen', true)}
                      >
                        <Eye size={14} />
                        Watch stream
                      </button>
                    )}
                  </div>
                )
              })}
              {remoteMediaPlaceholdersToRender.map((placeholder) => (
                <div key={`hidden-${placeholder.key}`} className="voice-stage-hidden-media-tile">
                  <div className="voice-stage-hidden-media-icon">
                    <EyeOff size={18} />
                  </div>
                  <div className="voice-stage-hidden-media-title">
                    {placeholder.label} hidden
                  </div>
                  <div className="voice-stage-hidden-media-sub">{remoteShareOwner(placeholder.peerId)}</div>
                  <button
                    type="button"
                    className="voice-stage-hidden-media-show"
                    onClick={() => setRemoteMediaHidden(placeholder.peerId, placeholder.kind, false)}
                  >
                    <Eye size={14} />
                    Show
                  </button>
                </div>
              ))}
              {remoteVideoTrackEntries.map(({ peerId, track, label, kind }) => {
                const volumeKey = resolvePeerVolumeKey(peerId)
                const screenVolumeKey = remotePlaybackVolumeKey('screen', volumeKey)
                const currentVol = getRemotePlaybackVolume(
                  peerVolumeByUserId,
                  kind === 'screen' ? 'screen' : 'voice',
                  volumeKey,
                )
                const tileKey = `${peerId}-${track.id}`
                const theaterKey = kind === 'screen' ? `screen-${tileKey}` : null
                const owner = remoteShareOwner(peerId)
                const isHidden = isRemoteMediaHidden(peerId, kind)
                if (kind === 'screen' && !watchedRemoteScreenPeerIds.has(peerId)) return null
                if (kind === 'camera' && isHidden) return null
                return (
                  <div key={tileKey} className={`screen-share-preview remote-screen-preview voice-stage-share-tile${theaterStreamKey === theaterKey ? ' is-theater-focused' : ''}`} data-fullscreen-key={tileKey} onMouseMove={handleTileMouseMove} onMouseLeave={handleTileMouseLeave}>
                    <RemoteVideoTrack track={track} />
                    <div className="screen-share-info-overlay"><span className="screen-share-info-text">{label} · {owner}</span></div>
                    {kind === 'screen' && <ScreenShareViewerAvatars viewerIds={getScreenShareViewerIds(peerId)} members={members} />}
                    <div className="screen-share-controls-bar">
                      <div className="screen-share-controls-left">
                        {kind === 'screen' && (
                          <div className="screen-share-volume-container">
                            <button type="button" className="screen-share-volume-btn" title={currentVol === 0 ? 'Unmute' : 'Mute'} onClick={() => {
                              const isMuted = currentVol === 0
                              let newVal: number
                              if (isMuted) {
                                const savedVal = readPreviousScreenPlaybackVolume(volumeKey)
                                newVal = savedVal > 0 ? savedVal : DEFAULT_REMOTE_PLAYBACK_VOLUME
                              } else {
                                writePreviousScreenPlaybackVolume(volumeKey, currentVol)
                                newVal = 0
                              }
                              const next = writeRemotePlaybackVolumes({
                                ...readRemotePlaybackVolumes(),
                                [screenVolumeKey]: newVal,
                              })
                              setPeerVolumeByUserId(next)
                              window.dispatchEvent(new CustomEvent(REMOTE_PLAYBACK_VOLUME_CHANGED_EVENT))
                            }}>
                              {currentVol === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                            </button>
                            <div className="screen-share-volume-slider-wrap">
                              <input type="range" min={0} max={100} value={currentVol} className="screen-share-volume-slider" title={`Volume: ${currentVol}%`} onChange={(e) => {
                                const val = normalizeRemoteScreenPlaybackVolume(Number(e.target.value))
                                const next = writeRemotePlaybackVolumes({
                                  ...readRemotePlaybackVolumes(),
                                  [screenVolumeKey]: val,
                                })
                                setPeerVolumeByUserId(next)
                                window.dispatchEvent(new CustomEvent(REMOTE_PLAYBACK_VOLUME_CHANGED_EVENT))
                              }} />
                              <span className="screen-share-volume-value">{currentVol}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="screen-share-controls-right">
                        <button
                          type="button"
                          className="screen-share-controls-btn"
                          title={kind === 'screen' ? 'Stop watching' : 'Hide camera'}
                          onClick={() => {
                            if (kind === 'screen') setRemoteMediaSubscribed(peerId, 'screen', false)
                            else setRemoteMediaHidden(peerId, kind, true, label)
                          }}
                        >
                          <EyeOff size={16} />
                        </button>
                        {kind === 'screen' ? (
                          <>
                            <button
                              type="button"
                              className="screen-share-controls-btn"
                              title={theaterStreamKey === theaterKey ? 'Exit focus view' : 'Focus stream'}
                              aria-label={theaterStreamKey === theaterKey ? 'Exit focus view' : 'Focus stream'}
                              onClick={() => setTheaterStreamKey((current) => current === theaterKey ? null : theaterKey)}
                            >
                              {theaterStreamKey === theaterKey ? <LayoutGrid size={16} /> : <PanelsTopLeft size={16} />}
                            </button>
                            <button type="button" className="screen-share-controls-btn" title="Toggle fullscreen" onClick={(e) => {
                              const tile = (e.currentTarget as HTMLElement).closest('.screen-share-preview') as HTMLElement | null
                              if (!tile) return
                              if (document.fullscreenElement) void document.exitFullscreen().catch(() => { })
                              else void tile.requestFullscreen?.().catch(() => { })
                            }}>
                              {fullscreenTileKey === tileKey ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                            </button>
                          </>
                        ) : (
                          <button type="button" className="screen-share-controls-btn" title="Toggle fullscreen" onClick={(e) => {
                            const tile = (e.currentTarget as HTMLElement).closest('.screen-share-preview') as HTMLElement | null
                            if (!tile) return
                            if (document.fullscreenElement) void document.exitFullscreen().catch(() => { })
                            else void tile.requestFullscreen?.().catch(() => { })
                          }}>
                            {fullscreenTileKey === tileKey ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="callbar-wrap">
            <div className="active-call-bar">
              <RemoteAudioPlaybackLayer
                remoteStreams={state.remoteStreams}
                watchedScreenPeerIds={watchedRemoteScreenPeerIds}
                renderAudioElement={renderRemoteAudioElement}
              />
              <div className="callbar-status">
                <button
                  type="button"
                  className="active-call-title active-call-title-btn"
                  onClick={goToVoiceChannel}
                  title={`Return to ${voiceLocation.full}`}
                  aria-label={`Return to ${voiceLocation.full}`}
                >
                  <Volume2 className="active-call-title-icon" size={14} aria-hidden="true" />
                  <span className="active-call-title-label">{voiceLocation.display}</span>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
              <div className="callbar-controls-center">
                <button
                  onClick={toggleMute}
                  disabled={!state.joinedChannelId || !state.localStream || deafened}
                  className={`callbar-control-btn ${muted ? 'is-off' : (serverMuted || serverDeafened) ? 'is-server-off' : ''}`}
                  aria-label={micControlLabel}
                  title={micControlLabel}
                >
                  {(muted || serverMuted || serverDeafened) ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                <button
                  onClick={toggleDeafen}
                  disabled={!state.joinedChannelId}
                  className={`callbar-control-btn ${deafened ? 'is-off' : serverDeafened ? 'is-server-off' : ''}`}
                  aria-label={deafenControlLabel}
                  title={deafenControlLabel}
                >
                  {(deafened || serverDeafened) ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <button onClick={handleCamera} disabled={!state.joinedChannelId} className={`callbar-control-btn media-control ${state.cameraStream ? 'is-live' : ''}`} aria-label={cameraControlLabel} title={cameraControlLabel}>
                  {state.cameraStream ? <Video size={16} /> : <VideoOff size={16} />}
                </button>
                {!isMobileViewport && (
                  <button onClick={handleScreenShare} disabled={!state.joinedChannelId} className={`callbar-control-btn media-control ${state.isScreenSharing ? 'is-live' : ''}`} aria-label={screenShareControlLabel} title={screenShareControlLabel}>
                    <Monitor size={16} />
                  </button>
                )}
              </div>
              <div className="callbar-controls-right">
                <span className="callbar-connection-inline">
                  <span className={`callbar-ping-chip ${pingStateClass}`} role="status" aria-label={pingAriaLabel} title={pingAriaLabel}>
                    <span className="callbar-ping-inline-icon" aria-hidden="true">
                      <Wifi size={14} />
                    </span>
                    <span className="callbar-ping-value">{pingDisplay}</span>
                  </span>
                </span>
                <button onClick={handleJoinLeave} disabled={state.isJoining} className={`callbar-control-btn callbar-control-btn-disconnect danger ${isDisconnectVisualActive ? 'is-live is-disconnect-state' : ''} ${isDisconnectPendingVisual ? 'is-disconnect-pending' : ''}`} aria-label={disconnectControlLabel} title={disconnectControlLabel}>
                  <PhoneOff size={16} style={{ transform: isDisconnectVisualActive ? 'none' : 'rotate(135deg)' }} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
