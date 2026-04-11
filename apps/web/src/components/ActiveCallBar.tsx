import { PhoneOff, Mic, MicOff, Monitor, Volume2, VolumeX, Maximize2, Minimize2, Users, Video, VideoOff, Wifi } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useLiveKitVoice } from '../webrtc/useLiveKitVoice'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { isTauri } from '../secureStorage'
import { applyPreferredAudioOutputDevice, buildPreferredMicrophoneConstraints, VOICE_SETTINGS_CHANGED_EVENT } from '../voiceDevices'

interface VoxperyTrack extends MediaStreamTrack {
  __voxpery_isCamera?: boolean
  __voxpery_isScreenShare?: boolean
}

interface VoxperyAudioElement extends HTMLAudioElement {
  __voxpery_trackIds?: string
}

interface VoxperyHTMLDivElement extends HTMLDivElement {
  _idleTimeout?: ReturnType<typeof setTimeout>
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
  if (mode === 'presentation') return '1080p30 · 6 Mbps · detail'
  if (mode === 'video') return '1080p60 · 10 Mbps · motion'
  if (mode === 'gaming') return '1080p60 · 12 Mbps · high motion'
  return 'Auto picks profile by share source.'
}

export default function ActiveCallBar({ selectedVoiceChannelId, activeChannelId }: ActiveCallBarProps) {
  const navigate = useNavigate()
  const { state, joinVoice, leaveVoice, startScreenShare, stopScreenShare, startCamera, stopCamera, setVoiceControls, playVoiceCue } = useLiveKitVoice()
  const { user } = useAuthStore()
  const { members, voiceStates, channels, channelsByServerId, servers, setActiveServer, setActiveChannel, voiceSpeakingUserIds, voiceLocalSpeaking, voiceControls } = useAppStore(
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
    const full = `${serverName} / #${ch.name}`

    return { full, display: `#${shorten(ch.name, 24)}` }
  }, [state.joinedChannelId, selectedVoiceChannelId, allKnownChannels, servers])
  const goToVoiceChannel = () => {
    const id = state.joinedChannelId ?? selectedVoiceChannelId
    const serverId = id ? allKnownChannels.find((c) => c.id === id)?.server_id ?? null : null
    if (!id || !serverId) return
    setActiveServer(serverId)
    setActiveChannel(id)
    navigate('/servers')
  }
  const pushToast = useToastStore((s) => s.pushToast)
  const isLinuxDesktop = useMemo(
    () => isTauri() && typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent),
    []
  )
  const mapMicPreflightError = useCallback((err: unknown): string | null => {
    const errName = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : ''
    const errMessage = err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message).toLowerCase()
      : ''

    const isPermissionError =
      errName === 'NotAllowedError' ||
      errMessage.includes('permission denied') ||
      errMessage.includes('notallowederror') ||
      errMessage.includes('microphone permission denied')

    if (isPermissionError) {
      return isLinuxDesktop
        ? 'Permission was blocked. On Linux desktop, ensure xdg-desktop-portal (+ xdg-desktop-portal-gtk or xdg-desktop-portal-kde) and PipeWire are installed/running, then restart Voxpery.'
        : 'Permission was blocked. Allow microphone/screen access in system or browser settings and try again.'
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
  }, [isLinuxDesktop])
  const mapCameraError = useCallback((err: unknown): string | null => {
    const errName = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : ''
    const errMessage = err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message).toLowerCase()
      : ''

    const isPermissionError =
      errName === 'NotAllowedError' ||
      errMessage.includes('permission denied') ||
      errMessage.includes('camera permission denied') ||
      errMessage.includes('securityerror')

    if (isPermissionError) {
      return isLinuxDesktop
        ? 'Permission was blocked. On Linux desktop, ensure xdg-desktop-portal (+ xdg-desktop-portal-gtk or xdg-desktop-portal-kde) and PipeWire are installed/running, then restart Voxpery.'
        : 'Permission was blocked. Allow camera access in system or browser settings and try again.'
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
  }, [isLinuxDesktop])
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const localControl = user?.id ? voiceControls[user.id] : null
  const serverMuted = !!localControl?.serverMuted
  const serverDeafened = !!localControl?.serverDeafened
  const [blockedAutoJoinChannelId, setBlockedAutoJoinChannelId] = useState<string | null>(null)
  const [showScreenShareConfirm, setShowScreenShareConfirm] = useState(false)
  const [screenShareQuality, setScreenShareQuality] = useState<ScreenShareQuality>(() => readScreenShareQuality())
  const [showCameraConfirm, setShowCameraConfirm] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false
  )
  const lastShownErrorRef = useRef<string | null>(null)
  const OUTPUT_VOL_KEY = 'voxpery-settings-output-volume'
  const SETTINGS_CHANGED_EVENT = VOICE_SETTINGS_CHANGED_EVENT
  const PEER_VOLUME_KEY = 'voxpery-voice-peer-volume'
  const PEER_VOLUME_CHANGED_EVENT = 'voxpery-voice-peer-volume-changed'
  const [outputVolume, setOutputVolume] = useState(() =>
    Math.min(100, Math.max(1, Number(localStorage.getItem(OUTPUT_VOL_KEY)) || 100))
  )
  const [peerVolumeByUserId, setPeerVolumeByUserId] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(PEER_VOLUME_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const next: Record<string, number> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        next[key] = Math.min(200, Math.max(0, Math.round(value)))
      }
      return next
    } catch {
      return {}
    }
  })
  const [fullscreenTileKey, setFullscreenTileKey] = useState<string | null>(null)
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
  const remoteAudioRefsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const remoteAudioRetryTimerRef = useRef<Map<string, number>>(new Map())
  const remoteVideoStreamByTrackIdRef = useRef<Map<string, MediaStream>>(new Map())
  // Per-peer WebAudio nodes for amplification above 100% (GainNode allows gain > 1.0)
  const perPeerAudioCtxRef = useRef<Map<string, { ctx: AudioContext; source: MediaElementAudioSourceNode; gain: GainNode }>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    localStreamRef.current = state.localStream
  }, [state.localStream])
  useEffect(() => {
    const video = cameraVideoRef.current
    const stream = state.cameraStream
    if (!video || !stream) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
      const play = () => void video.play().catch(() => { })
      video.addEventListener('loadeddata', play, { once: true })
      video.addEventListener('loadedmetadata', play, { once: true })
      if (video.readyState >= 2) play()
      const t = setTimeout(play, 150)
      return () => {
        clearTimeout(t)
        if (video.srcObject === stream) video.srcObject = null
      }
    }
  }, [state.cameraStream])
  useEffect(() => {
    deafenedRef.current = deafened || serverDeafened
  }, [deafened, serverDeafened])

  const resolvePeerVolumeKey = useCallback((peerId: string) => {
    if (peerVolumeByUserId[peerId] !== undefined) return peerId
    const member = members.find((m) => m.username === peerId)
    return member?.user_id ?? peerId
  }, [members, peerVolumeByUserId])

  const peerIdsWithScreenShareRef = useRef<Set<string>>(new Set())
  const getPeerVolumeFactor = useCallback((peerId: string) => {
    const volumeKey = resolvePeerVolumeKey(peerId)
    const useScreenKey = peerIdsWithScreenShareRef.current.has(peerId)
    const storageKey = useScreenKey ? `screen:${volumeKey}` : volumeKey
    const raw = peerVolumeByUserId[storageKey]
    const bounded = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(200, Math.max(0, raw)) : 100
    return bounded / 100  // returns 0.0–2.0
  }, [peerVolumeByUserId, resolvePeerVolumeKey])

  const ensureRemoteAudioPlayback = useCallback((peerId: string, el: HTMLAudioElement) => {
    const retryTimers = remoteAudioRetryTimerRef.current
    const clearRetry = () => {
      const t = retryTimers.get(peerId)
      if (t != null) {
        window.clearTimeout(t)
        retryTimers.delete(peerId)
      }
    }
    const attempt = () => {
      // Check if element is still available and not muted/deafened
      if (!el || !el.isConnected) {
        console.warn('[ensureRemoteAudioPlayback] Element not connected for peer', peerId)
        clearRetry()
        return
      }
      if (el.muted || deafenedRef.current) {
        clearRetry()
        return
      }
      if (!el.srcObject) {
        console.warn('[ensureRemoteAudioPlayback] No srcObject for peer', peerId)
        clearRetry()
        return
      }

      const p = el.play()
      if (!p || typeof p.catch !== 'function') {
        console.warn('[ensureRemoteAudioPlayback] play() did not return a promise for peer', peerId)
        clearRetry()
        return
      }
      p.then(() => {
        clearRetry()
      }).catch(() => {
        // Suppress expected "The play() request was interrupted by a new load request" warnings
        // console.warn('[ensureRemoteAudioPlayback] Failed to play for peer', peerId, ':', err.message)
        clearRetry()
        const retry = window.setTimeout(() => {
          attempt()
        }, 500) // Increased delay to 500ms for more stable retry
        retryTimers.set(peerId, retry)
      })
    }
    attempt()
  }, [])

  const applyOutputDeviceToElements = useCallback(() => {
    for (const el of remoteAudioRefsRef.current.values()) {
      void applyPreferredAudioOutputDevice(el)
    }
  }, [])

  const applyOutputVolumeToElements = useCallback((vol: number) => {
    const global = Math.min(1, Math.max(0, vol))
    const isDeafened = deafenedRef.current
    for (const [peerId, el] of remoteAudioRefsRef.current.entries()) {
      try {
        const peerFactor = getPeerVolumeFactor(peerId)  // 0.0–2.0
        const combined = isDeafened ? 0 : global * peerFactor
        if (peerFactor <= 1.0) {
          // Normal range: use plain audio.volume (0–1)
          el.volume = Math.min(1, Math.max(0, combined))
          // Tear down any existing GainNode for this peer (they lowered it back)
          const existing = perPeerAudioCtxRef.current.get(peerId)
          if (existing) {
            try { existing.source.disconnect(); existing.gain.disconnect() } catch { /* ignore */ }
            void existing.ctx.close().catch(() => { })
            perPeerAudioCtxRef.current.delete(peerId)
          }
        } else {
          // Amplified range (>100%): route through a GainNode. When captured, el.muted is ignored
          // by the browser, so we mute by setting gain.gain.value = 0 when deafened.
          let nodes = perPeerAudioCtxRef.current.get(peerId)
          if (!nodes) {
            // When deafened (combined === 0), avoid createMediaElementSource so Firefox doesn't warn
            // about captured MediaElement (volume/mute not supported after capture)
            if (combined === 0) {
              el.volume = 0
              el.muted = true
              continue
            }
            try {
              const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
              if (AudioCtor) {
                const ctx = new AudioCtor()
                const source = ctx.createMediaElementSource(el)
                const gain = ctx.createGain()
                source.connect(gain)
                gain.connect(ctx.destination)
                nodes = { ctx, source, gain }
                perPeerAudioCtxRef.current.set(peerId, nodes)
              }
            } catch {
              // WebAudio unavailable: clamp to 1.0
              el.volume = 1
              continue
            }
          }
          if (nodes) {
            nodes.gain.gain.value = Math.min(4, combined)  // 0 when deafened, else cap at 4×
            // Do not set el.volume/el.muted: element is captured by Web Audio, Firefox warns and it has no effect
          }
        }
        // Only set el.muted when not using GainNode (captured element ignores it; mute is via gain.gain.value)
        if (!perPeerAudioCtxRef.current.has(peerId)) {
          el.muted = isDeafened
        }
      } catch {
        // ignore
      }
    }
  }, [getPeerVolumeFactor])

  useEffect(() => {
    const onSettingsChanged = () => {
      const raw = Math.min(100, Math.max(1, Number(localStorage.getItem(OUTPUT_VOL_KEY)) || 100))
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
      try {
        const raw = localStorage.getItem(PEER_VOLUME_KEY)
        if (!raw) {
          setPeerVolumeByUserId({})
          return
        }
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const next: Record<string, number> = {}
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value !== 'number' || !Number.isFinite(value)) continue
          next[key] = Math.min(200, Math.max(0, Math.round(value)))
        }
        setPeerVolumeByUserId(next)
      } catch {
        setPeerVolumeByUserId({})
      }
    }
    window.addEventListener(PEER_VOLUME_CHANGED_EVENT, onPeerVolumeChanged)
    return () => window.removeEventListener(PEER_VOLUME_CHANGED_EVENT, onPeerVolumeChanged)
  }, [])
  const effectiveDeafened = deafened || serverDeafened

  useEffect(() => {
    outputVolumeRef.current = outputVolume
    applyOutputVolumeToElements(outputVolume / 100)
  }, [applyOutputVolumeToElements, effectiveDeafened, outputVolume, peerVolumeByUserId])

  const remoteEntries = useMemo(() => Array.from(state.remoteStreams.entries()), [state.remoteStreams])
  const stablePeerIds = useMemo(() => {
    const ids = Array.from(state.remoteStreams.keys()).sort()
    return ids.join(',')
  }, [state.remoteStreams])
  // Track total audio track count so we re-trigger playback when screen share audio arrives
  const remoteAudioTrackCount = useMemo(() => {
    let count = 0
    for (const stream of state.remoteStreams.values()) {
      count += stream.getAudioTracks().length
    }
    return count
  }, [state.remoteStreams])
  const remoteVideoTrackEntries = useMemo(() => {
    const entries: Array<{ peerId: string; track: MediaStreamTrack; label: string }> = []
    for (const [peerId, stream] of remoteEntries) {
      const tracks = stream
        .getVideoTracks()
        .filter((track) => track.readyState === 'live' && !track.muted)
      for (const track of tracks) {
        // Prefer camera: if track was published as Camera, always show "Camera" (not "Screen share")
        if ('__voxpery_isCamera' in track && (track as VoxperyTrack).__voxpery_isCamera) {
          entries.push({ peerId, track, label: 'Camera' })
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
        entries.push({ peerId, track, label: isScreen ? 'Screen share' : 'Camera' })
      }
    }
    return entries
  }, [remoteEntries, state.remoteScreenTrackIds])
  useEffect(() => {
    peerIdsWithScreenShareRef.current = new Set(
      remoteVideoTrackEntries.filter((e) => e.label === 'Screen share').map((e) => e.peerId)
    )
  }, [remoteVideoTrackEntries])

  useEffect(() => {
    for (const [peerId, stream] of state.remoteStreams.entries()) {
      const el = remoteAudioRefsRef.current.get(peerId) as VoxperyAudioElement | undefined
      if (!el) continue
      // Force srcObject re-assignment when track count changes (e.g. screen share audio added)
      const currentTrackIds = stream.getTracks().map(t => t.id).sort().join(',')
      const prevTrackIds = el.__voxpery_trackIds
      if (el.srcObject !== stream || currentTrackIds !== prevTrackIds) {
        el.srcObject = new MediaStream(stream.getTracks())
        el.__voxpery_trackIds = currentTrackIds
        void applyPreferredAudioOutputDevice(el)
      }
      if (!perPeerAudioCtxRef.current.has(peerId)) {
        el.muted = deafenedRef.current
      }
      if (!deafenedRef.current) ensureRemoteAudioPlayback(peerId, el)
    }
  }, [stablePeerIds, remoteAudioTrackCount, ensureRemoteAudioPlayback, state.remoteStreams])

  useEffect(() => {
    const retryTimers = remoteAudioRetryTimerRef.current
    const remoteVideoStreams = remoteVideoStreamByTrackIdRef.current
    return () => {
      for (const t of retryTimers.values()) {
        window.clearTimeout(t)
      }
      retryTimers.clear()
      remoteVideoStreams.clear()
    }
  }, [])

  const currentVoiceChannelId = state.joinedChannelId
  const channelParticipants = useMemo(() => {
    if (!currentVoiceChannelId) return []
    return members.filter((m) => voiceStates[m.user_id] === currentVoiceChannelId)
  }, [currentVoiceChannelId, members, voiceStates])

  const isInThisChannel = useMemo(() => {
    return !!selectedVoiceChannelId && state.joinedChannelId === selectedVoiceChannelId
  }, [selectedVoiceChannelId, state.joinedChannelId])
  // Only show the big voice stage when user is actually viewing the voice channel (clicked it in sidebar), not when on General/Social.
  const isViewingVoiceChannel = activeChannelId === selectedVoiceChannelId
  const showVoiceStage =
    isViewingVoiceChannel &&
    isInThisChannel &&
    (channelParticipants.length > 0 || state.isScreenSharing || !!state.cameraStream || remoteVideoTrackEntries.length > 0)

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
    const media = window.matchMedia('(max-width: 900px)')
    const sync = () => setIsMobileViewport(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

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
        micStream = await navigator.mediaDevices.getUserMedia({ audio: buildPreferredMicrophoneConstraints(), video: false })
        await joinVoice(channelId, { preflightStream: micStream })
      } catch (err: unknown) {
        micStream?.getTracks().forEach((t) => t.stop())
        const message = mapMicPreflightError(err)
        if (message) {
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

    const raw = state.lastError
    const lower = raw.toLowerCase()
    let message = raw
    let title = 'Voice action failed'
    let level: 'error' | 'info' = 'error'
    if (
      lower.includes('voice access denied')
      || lower.includes('missing required permission')
      || lower.includes('forbidden')
    ) {
      title = 'Voice access denied'
      level = 'info'
      message = "You don't have permission to connect to this voice channel."
    } else
    if (lower.includes('notallowederror') || lower.includes('permission denied') || lower.includes('permission')) {
      message = isLinuxDesktop
        ? 'Permission was blocked. On Linux desktop, ensure xdg-desktop-portal (+ xdg-desktop-portal-gtk or xdg-desktop-portal-kde) and PipeWire are installed/running, then restart Voxpery.'
        : 'Permission was blocked. Allow microphone/screen access in system or browser settings and try again.'
    } else if (lower.includes('notfounderror') || lower.includes('device not found')) {
      message = 'No microphone device detected. Connect a microphone and retry.'
    } else if (lower.includes('websocket is not connected')) {
      message = 'Voice service is reconnecting. Wait a few seconds and try again.'
    }

    pushToast({
      level,
      title,
      message,
    })
  }, [isLinuxDesktop, pushToast, state.lastError])

  const toggleMute = () => {
    const stream = localStreamRef.current ?? state.localStream
    const next = !muted
    if (stream) {
      const shouldMuteTrack = next || deafened || serverMuted || serverDeafened
      for (const t of stream.getAudioTracks()) t.enabled = !shouldMuteTrack
    }
    setMuted(next)
    setVoiceControls(next, deafened, state.isScreenSharing)
    playVoiceCue(next ? 'mute' : 'unmute')
  }

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
      stream = await navigator.mediaDevices.getUserMedia({ audio: buildPreferredMicrophoneConstraints(), video: false })
      await joinVoice(channelId, { preflightStream: stream })
    } catch (err: unknown) {
      stream?.getTracks().forEach((t) => t.stop())
      const message = mapMicPreflightError(err)
      if (message) {
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
      setVoiceControls(false, false, false)
      leaveVoice()
      setDeafened(false)
      setMuted(false)
      setBlockedAutoJoinChannelId(selectedVoiceChannelId)
    } else {
      await joinWithPreflight(selectedVoiceChannelId)
      setMuted(false)
      setDeafened(false)
      setVoiceControls(false, false, false)
      setBlockedAutoJoinChannelId(null)
    }
  }

  const toggleDeafen = () => {
    if (!state.joinedChannelId) return
    const stream = localStreamRef.current ?? state.localStream
    const nextDeafened = !deafened
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

  const handleScreenShare = async () => {
    if (!state.joinedChannelId) return
    if (state.isScreenSharing) {
      stopScreenShare()
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
    } catch (e) {
      const message = e instanceof Error
        ? e.message
        : 'Unable to start screen sharing. Check permission and active window selection.'
      pushToast({ level: 'error', title: 'Screen share failed', message })
    }
  }

  const handleCamera = () => {
    if (!state.joinedChannelId) return
    if (state.cameraStream) {
      stopCamera()
      return
    }
    setShowCameraConfirm(true)
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
    } catch (e) {
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
  const totalStageTiles = channelParticipants.length + localFallbackTileCount + (state.isScreenSharing && state.screenStream ? 1 : 0) + (state.cameraStream ? 1 : 0) + remoteVideoTrackEntries.length
  const stageColumns = getStageColumns(totalStageTiles)
  const roomState = state.livekit.roomState
  const roomConnected = roomState === 'connected'
  const roomConnecting = state.isJoining || roomState === 'connecting'
  const roomReconnecting = roomState === 'reconnecting'
  const joiningTargetChannelId = state.isJoining ? selectedVoiceChannelId : null
  const hasActiveVoiceSession = !!(state.joinedChannelId || joiningTargetChannelId)
  const participantIds = new Set(channelParticipants.map((member) => member.user_id))
  if (state.joinedChannelId && user?.id) participantIds.add(user.id)
  const participantCount = participantIds.size
  const participantLabel = `${participantCount}`
  const connectionLabel = !hasActiveVoiceSession ? 'Offline' : roomConnecting ? 'Connecting...' : roomReconnecting ? 'Reconnecting...' : roomConnected ? `Connected (${participantLabel})` : 'Offline'
  const connectionTitle = roomConnected ? 'Connected' : connectionLabel
  const isDisconnectVisualActive = hasActiveVoiceSession
  const isDisconnectPendingVisual = hasActiveVoiceSession && !roomConnected
  const packetLossPct = state.diagnostics.packetLossPct
  const networkJitterMs = state.diagnostics.jitterMs
  const pingJitterMs = state.diagnostics.pingJitterMs
  const qualityLevel =
    !hasActiveVoiceSession || state.pingMs == null
      ? 'unknown'
      : (state.pingMs >= 220 || (packetLossPct ?? 0) >= 5 || (networkJitterMs ?? 0) >= 45)
        ? 'poor'
        : (state.pingMs >= 120 || (packetLossPct ?? 0) >= 2 || (networkJitterMs ?? 0) >= 25 || (pingJitterMs ?? 0) >= 35)
          ? 'fair'
          : 'good'
  const pingStateClass =
    qualityLevel === 'good'
      ? 'is-good'
      : qualityLevel === 'fair'
        ? 'is-mid'
        : qualityLevel === 'poor'
          ? 'is-bad'
          : 'is-unknown'
  const pingTooltip = !hasActiveVoiceSession
    ? 'Quality: N/A'
    : [
      `Quality: ${qualityLevel === 'good' ? 'Good' : qualityLevel === 'fair' ? 'Fair' : qualityLevel === 'poor' ? 'Poor' : 'Measuring'}`,
      state.pingMs != null ? `Ping: ${state.pingMs} ms` : null,
      pingJitterMs != null ? `Ping jitter: ${pingJitterMs} ms` : null,
      networkJitterMs != null ? `Audio jitter: ${networkJitterMs} ms` : null,
      packetLossPct != null ? `Loss: ${packetLossPct.toFixed(1)}%` : null,
    ]
      .filter(Boolean)
      .join(' • ')
  const connectionStateClass = !hasActiveVoiceSession ? 'is-offline' : roomConnecting || roomReconnecting ? 'is-connecting' : roomConnected ? 'is-connected' : 'is-offline'

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

  const showActiveCallBar = !!(state.joinedChannelId || state.localStream || state.isJoining)

  return (
    <>
      {typeof document !== 'undefined' && createPortal(screenShareModal, document.body)}
      {typeof document !== 'undefined' && createPortal(cameraModal, document.body)}
      {showActiveCallBar && (
        <>
          {showVoiceStage && (
            <div className="screen-share-stage" style={{ gridTemplateColumns: `repeat(${stageColumns}, minmax(0, 1fr))` }}>
              {channelParticipants.map((p) => {
                const isLocal = p.user_id === user?.id
                const pSpeaking = isLocal ? voiceLocalSpeaking && !voiceControls[p.user_id]?.muted && !voiceControls[p.user_id]?.deafened : voiceSpeakingUserIds.includes(p.user_id) && !voiceControls[p.user_id]?.muted && !voiceControls[p.user_id]?.deafened
                return (
                  <div key={`participant-${p.user_id}`} className="voice-stage-tile">
                    <div className={`voice-stage-avatar${pSpeaking ? ' is-speaking' : ''}`}>
                      {p.avatar_url ? <img src={p.avatar_url} alt="" /> : (p.username.charAt(0) || '?').toUpperCase()}
                    </div>
                    <div className={`voice-stage-name${pSpeaking ? ' is-speaking' : ''}`}>{p.username}</div>
                    <div className="voice-stage-sub"><Users size={12} />In voice</div>
                  </div>
                )
              })}
              {currentVoiceChannelId && !channelParticipants.some((p) => p.user_id === user?.id) && (
                <div key="participant-local-fallback" className="voice-stage-tile">
                  <div className={`voice-stage-avatar${voiceLocalSpeaking && !(muted || deafened || serverMuted || serverDeafened) ? ' is-speaking' : ''}`}>
                    {user?.avatar_url ? <img src={user.avatar_url} alt="" /> : localInitial}
                  </div>
                  <div className={`voice-stage-name${voiceLocalSpeaking && !(muted || deafened || serverMuted || serverDeafened) ? ' is-speaking' : ''}`}>{user?.username ?? 'You'}</div>
                  <div className="voice-stage-sub"><Users size={12} />In voice</div>
                </div>
              )}
              {state.cameraStream && (
                <div className="screen-share-preview voice-stage-share-tile camera-preview" data-fullscreen-key="camera" onMouseMove={handleTileMouseMove} onMouseLeave={handleTileMouseLeave}>
                  <video ref={(el) => { cameraVideoRef.current = el }} autoPlay muted playsInline style={{ objectFit: 'cover', width: '100%', height: '100%', backgroundColor: '#000' }} />
                  <div className="screen-share-info-overlay"><span className="screen-share-info-text">Camera · You</span></div>
                  <div className="screen-share-controls-bar">
                    <div className="screen-share-controls-left" />
                    <div className="screen-share-controls-right">
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
                <div className="screen-share-preview voice-stage-share-tile" data-fullscreen-key="screen" onMouseMove={handleTileMouseMove} onMouseLeave={handleTileMouseLeave}>
                  <video autoPlay muted playsInline ref={(el) => { if (!el) return; if (el.srcObject !== state.screenStream) el.srcObject = state.screenStream; void el.play().catch(() => { }) }} />
                  <div className="screen-share-info-overlay"><span className="screen-share-info-text">Screen share · You</span></div>
                  <div className="screen-share-controls-bar">
                    <div className="screen-share-controls-left" />
                    <div className="screen-share-controls-right">
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
              {remoteVideoTrackEntries.map(({ peerId, track, label }) => {
                const volumeKey = resolvePeerVolumeKey(peerId)
                const screenVolumeKey = `screen:${volumeKey}`
                const currentVol = label === 'Screen share' ? (peerVolumeByUserId[screenVolumeKey] ?? 100) : (peerVolumeByUserId[volumeKey] ?? 100)
                const tileKey = `${peerId}-${track.id}`
                return (
                  <div key={tileKey} className="screen-share-preview remote-screen-preview voice-stage-share-tile" data-fullscreen-key={tileKey} onMouseMove={handleTileMouseMove} onMouseLeave={handleTileMouseLeave}>
                    <video autoPlay muted playsInline ref={(el) => { if (!el) return; let stream = remoteVideoStreamByTrackIdRef.current.get(track.id); if (!stream) { stream = new MediaStream([track]); remoteVideoStreamByTrackIdRef.current.set(track.id, stream) }; if (el.srcObject !== stream) el.srcObject = stream; void el.play().catch(() => { }) }} />
                    <div className="screen-share-info-overlay"><span className="screen-share-info-text">{label} · {remoteShareOwner(peerId)}</span></div>
                    <div className="screen-share-controls-bar">
                      <div className="screen-share-controls-left">
                        {label === 'Screen share' && (
                          <div className="screen-share-volume-container">
                            <button type="button" className="screen-share-volume-btn" title={currentVol === 0 ? 'Unmute' : 'Mute'} onClick={() => {
                              const isMuted = currentVol === 0
                              const prevVolumeKey = `${screenVolumeKey}_prev`
                              let newVal: number
                              if (isMuted) {
                                const savedStr = localStorage.getItem(prevVolumeKey)
                                const savedVal = savedStr ? Number(savedStr) : 100
                                newVal = savedVal > 0 ? savedVal : 100
                              } else {
                                localStorage.setItem(prevVolumeKey, String(currentVol))
                                newVal = 0
                              }
                              const next = { ...peerVolumeByUserId, [screenVolumeKey]: newVal }
                              setPeerVolumeByUserId(next)
                              localStorage.setItem(PEER_VOLUME_KEY, JSON.stringify(next))
                              applyOutputVolumeToElements(outputVolumeRef.current / 100)
                            }}>
                              {currentVol === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                            </button>
                            <div className="screen-share-volume-slider-wrap">
                              <input type="range" min={0} max={200} value={currentVol} className="screen-share-volume-slider" title={`Volume: ${currentVol}%`} onChange={(e) => {
                                const val = Number(e.target.value)
                                const next = { ...peerVolumeByUserId, [screenVolumeKey]: val }
                                setPeerVolumeByUserId(next)
                                localStorage.setItem(PEER_VOLUME_KEY, JSON.stringify(next))
                                applyOutputVolumeToElements(outputVolumeRef.current / 100)
                              }} />
                              <span className="screen-share-volume-value">{currentVol}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="screen-share-controls-right">
                        <button type="button" className="screen-share-controls-btn" title="Toggle fullscreen" onClick={(e) => {
                          const tile = (e.currentTarget as HTMLElement).closest('.screen-share-preview') as HTMLElement | null
                          if (!tile) return
                          if (document.fullscreenElement) void document.exitFullscreen().catch(() => { })
                          else void tile.requestFullscreen?.().catch(() => { })
                        }}>
                          {fullscreenTileKey === tileKey ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="callbar-wrap">
            <div className="active-call-bar">
              <div style={{ display: 'none' }}>
                {Array.from(state.remoteStreams.keys()).map((peerId) => {
                  const stream = state.remoteStreams.get(peerId)
                  if (!stream) return null
                  return (
                    <audio key={peerId} autoPlay playsInline ref={(el) => {
                      if (el) {
                        remoteAudioRefsRef.current.set(peerId, el)
                        if (el.srcObject !== stream) el.srcObject = stream
                        void applyPreferredAudioOutputDevice(el)
                        const shouldMute = deafenedRef.current
                        const isCaptured = perPeerAudioCtxRef.current.has(peerId)
                        if (!isCaptured) {
                          const peerFactor = getPeerVolumeFactor(peerId)
                          const vol = Math.min(1, Math.max(0, (outputVolumeRef.current / 100) * peerFactor))
                          try { el.volume = vol } catch (e) { console.warn('[ActiveCallBar] Failed to set volume:', e) }
                          el.muted = shouldMute
                        }
                        if (!shouldMute) ensureRemoteAudioPlayback(peerId, el)
                      } else {
                        remoteAudioRefsRef.current.delete(peerId)
                        const t = remoteAudioRetryTimerRef.current.get(peerId)
                        if (t != null) { window.clearTimeout(t); remoteAudioRetryTimerRef.current.delete(peerId) }
                      }
                    }} />
                  )
                })}
              </div>
              <div className="callbar-status">
                <button type="button" className="active-call-title active-call-title-btn" onClick={goToVoiceChannel} title={voiceLocation.full}>{voiceLocation.display}</button>
              </div>
              <div className="callbar-controls-center">
                <button
                  onClick={toggleMute}
                  disabled={!state.joinedChannelId || !state.localStream || deafened}
                  className={`callbar-control-btn ${muted ? 'is-off' : (serverMuted || serverDeafened) ? 'is-server-off' : ''}`}
                  title={
                    muted
                      ? 'Unmute (self)'
                      : (serverMuted || serverDeafened)
                        ? 'Muted by server'
                        : 'Mute'
                  }
                >
                  {(muted || serverMuted || serverDeafened) ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                <button
                  onClick={toggleDeafen}
                  disabled={!state.joinedChannelId}
                  className={`callbar-control-btn ${deafened ? 'is-off' : serverDeafened ? 'is-server-off' : ''}`}
                  title={deafened ? 'Enable headphones (self)' : serverDeafened ? 'Deafened by server' : 'Disable headphones'}
                >
                  {(deafened || serverDeafened) ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <button onClick={handleCamera} disabled={!state.joinedChannelId} className={`callbar-control-btn media-control ${state.cameraStream ? 'is-live' : ''}`} title={state.cameraStream ? 'Turn off camera' : 'Turn on camera'}>
                  {state.cameraStream ? <Video size={16} /> : <VideoOff size={16} />}
                </button>
                <button onClick={handleScreenShare} disabled={!state.joinedChannelId} className={`callbar-control-btn media-control ${state.isScreenSharing ? 'is-live' : ''}`} title={state.isScreenSharing ? 'Stop sharing' : 'Share screen'}>
                  <Monitor size={16} />
                </button>
              </div>
              <div className="callbar-controls-right">
                <span className="callbar-connection-inline">
                  <span className={`active-call-subtitle active-call-subtitle-inline ${connectionStateClass}`} title={connectionTitle}>
                    {(roomConnecting || roomReconnecting) && <span className="active-call-subtitle-spinner" />}
                    {connectionLabel}
                  </span>
                  <span
                    className={`callbar-ping-inline-icon ${pingStateClass}`}
                    title={pingTooltip}
                    aria-label={pingTooltip}
                  >
                    <Wifi size={14} />
                  </span>
                </span>
                <button onClick={handleJoinLeave} disabled={state.isJoining} className={`callbar-control-btn callbar-control-btn-disconnect danger ${isDisconnectVisualActive ? 'is-live is-disconnect-state' : ''} ${isDisconnectPendingVisual ? 'is-disconnect-pending' : ''}`} title={isDisconnectVisualActive ? 'Leave voice channel' : 'Join voice channel'}>
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
