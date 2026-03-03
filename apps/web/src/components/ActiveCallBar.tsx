import { PhoneOff, Mic, MicOff, Monitor, Volume2, VolumeX, Maximize2, Minimize2, Users, Video, VideoOff, Wifi } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveKitVoice } from '../webrtc/useLiveKitVoice'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'

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
  const { members, voiceStates, channels, servers, setActiveServer, setActiveChannel, voiceSpeakingUserIds, voiceLocalSpeaking } = useAppStore(
    useShallow((s) => ({
      members: s.members,
      voiceStates: s.voiceStates,
      channels: s.channels,
      servers: s.servers,
      setActiveServer: s.setActiveServer,
      setActiveChannel: s.setActiveChannel,
      voiceSpeakingUserIds: s.voiceSpeakingUserIds,
      voiceLocalSpeaking: s.voiceLocalSpeaking,
    }))
  )
  const voiceLocation = useMemo(() => {
    const shorten = (value: string, max: number) =>
      value.length <= max ? value : `${value.slice(0, Math.max(1, max - 1))}…`

    const id = state.joinedChannelId ?? selectedVoiceChannelId
    if (!id) return { full: 'Voice', display: 'Voice' }
    const ch = channels.find((c) => c.id === id)
    if (!ch) return { full: 'Voice', display: 'Voice' }
    const serverName = servers.find((s) => s.id === ch.server_id)?.name ?? 'Server'
    const full = `${serverName} / #${ch.name}`

    return { full, display: `#${shorten(ch.name, 24)}` }
  }, [state.joinedChannelId, selectedVoiceChannelId, channels, servers])
  const goToVoiceChannel = () => {
    const id = state.joinedChannelId ?? selectedVoiceChannelId
    const serverId = id ? channels.find((c) => c.id === id)?.server_id ?? null : null
    if (!id || !serverId) return
    setActiveServer(serverId)
    setActiveChannel(id)
    navigate('/app/servers')
  }
  const pushToast = useToastStore((s) => s.pushToast)
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [blockedAutoJoinChannelId, setBlockedAutoJoinChannelId] = useState<string | null>(null)
  const [showScreenShareConfirm, setShowScreenShareConfirm] = useState(false)
  const [screenShareQuality, setScreenShareQuality] = useState<ScreenShareQuality>(() => readScreenShareQuality())
  const [showCameraConfirm, setShowCameraConfirm] = useState(false)
  const lastShownErrorRef = useRef<string | null>(null)
  const OUTPUT_VOL_KEY = 'voxpery-settings-output-volume'
  const SETTINGS_CHANGED_EVENT = 'voxpery-voice-settings-changed'
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
    deafenedRef.current = deafened
  }, [deafened])

  const resolvePeerVolumeKey = useCallback((peerId: string) => {
    if (peerVolumeByUserId[peerId] !== undefined) return peerId
    const member = members.find((m) => m.username === peerId)
    return member?.user_id ?? peerId
  }, [members, peerVolumeByUserId])

  const getPeerVolumeFactor = useCallback((peerId: string) => {
    const volumeKey = resolvePeerVolumeKey(peerId)
    const raw = peerVolumeByUserId[volumeKey]
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
        console.log('[ensureRemoteAudioPlayback] Skipping playback - muted:', el.muted, 'deafened:', deafenedRef.current)
        clearRetry()
        return
      }
      if (!el.srcObject) {
        console.warn('[ensureRemoteAudioPlayback] No srcObject for peer', peerId)
        clearRetry()
        return
      }

      console.log('[ensureRemoteAudioPlayback] Attempting to play audio for peer', peerId, 'readyState:', el.readyState, 'networkState:', el.networkState)
      const p = el.play()
      if (!p || typeof p.catch !== 'function') {
        console.warn('[ensureRemoteAudioPlayback] play() did not return a promise for peer', peerId)
        clearRetry()
        return
      }
      p.then(() => {
        console.log('[ensureRemoteAudioPlayback] Successfully playing audio for peer', peerId)
        clearRetry()
      }).catch((err) => {
        console.warn('[ensureRemoteAudioPlayback] Failed to play for peer', peerId, ':', err.message)
        clearRetry()
        const retry = window.setTimeout(() => {
          attempt()
        }, 500) // Increased delay to 500ms for more stable retry
        retryTimers.set(peerId, retry)
      })
    }
    attempt()
  }, [])

  const applyOutputVolumeToElements = useCallback((vol: number) => {
    const global = Math.min(1, Math.max(0, vol))
    for (const [peerId, el] of remoteAudioRefsRef.current.entries()) {
      try {
        const peerFactor = getPeerVolumeFactor(peerId)  // 0.0–2.0
        const combined = global * peerFactor
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
          // Amplified range (>100%): route through a GainNode so audio.volume stays at 1.0
          let nodes = perPeerAudioCtxRef.current.get(peerId)
          if (!nodes) {
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
            nodes.gain.gain.value = Math.min(4, combined)  // cap at 4× (400%) for safety
            el.volume = 1
          }
        }
        el.muted = deafenedRef.current
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
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [applyOutputVolumeToElements])

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
  useEffect(() => {
    outputVolumeRef.current = outputVolume
    applyOutputVolumeToElements(outputVolume / 100)
  }, [applyOutputVolumeToElements, deafened, outputVolume, peerVolumeByUserId])

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
        if ('__voxpery_isCamera' in track && (track as any).__voxpery_isCamera) {
          entries.push({ peerId, track, label: 'Camera' })
          continue
        }
        // Screen share: authoritative set from useLiveKitVoice or property set on subscribe
        let isScreen = state.remoteScreenTrackIds.has(track.id) || !!(track as any).__voxpery_isScreenShare
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
    for (const [peerId, stream] of state.remoteStreams.entries()) {
      const el = remoteAudioRefsRef.current.get(peerId)
      if (!el) continue
      // Force srcObject re-assignment when track count changes (e.g. screen share audio added)
      const currentTrackIds = stream.getTracks().map(t => t.id).sort().join(',')
      const prevTrackIds = (el as any).__voxpery_trackIds as string | undefined
      if (el.srcObject !== stream || currentTrackIds !== prevTrackIds) {
        console.log('[ActiveCallBar] Updating srcObject for peer', peerId, 'tracks:', currentTrackIds)
        el.srcObject = new MediaStream(stream.getTracks())
          ; (el as any).__voxpery_trackIds = currentTrackIds
      }
      el.muted = deafenedRef.current
      if (!deafenedRef.current) ensureRemoteAudioPlayback(peerId, el)
    }
  }, [stablePeerIds, remoteAudioTrackCount, ensureRemoteAudioPlayback, state.remoteStreams])

  useEffect(() => {
    const retryTimers = remoteAudioRetryTimerRef.current
    return () => {
      for (const t of retryTimers.values()) {
        window.clearTimeout(t)
      }
      retryTimers.clear()
      remoteVideoStreamByTrackIdRef.current.clear()
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
    if (tileCount <= 1) return 1
    if (tileCount === 2) return 2
    if (tileCount <= 4) return 2
    if (tileCount <= 9) return 3
    return 4
  }

  // Auto-join when user clicks a voice channel. If already in another voice channel, leave it first then join the new one.
  useEffect(() => {
    if (!selectedVoiceChannelId) return
    if (blockedAutoJoinChannelId === selectedVoiceChannelId) return
    if (state.joinedChannelId === selectedVoiceChannelId) return
    if (state.joinedChannelId && state.joinedChannelId !== selectedVoiceChannelId) {
      leaveVoice({ skipLeaveSound: true })
      return
    }
    if (state.livekit) return
    const tryAutoJoin = async () => {
      if (navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          if (status.state !== 'granted') return
        } catch {
          // ignore permission API errors
        }
      }
      try {
        await joinVoice(selectedVoiceChannelId)
      } catch (e) {
        console.error('Failed to auto-join voice:', e)
      }
    }
    void tryAutoJoin()
  }, [blockedAutoJoinChannelId, joinVoice, leaveVoice, selectedVoiceChannelId, state.joinedChannelId])

  useEffect(() => {
    if (!state.livekit) return
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
      if (!navigator.mediaDevices?.getUserMedia) return
      let micStream: MediaStream | null = null
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        await joinVoice(channelId, { preflightStream: micStream })
      } catch {
        micStream?.getTracks().forEach((t) => t.stop())
      }
    }
      ; (window as Window & { __voxperyJoinVoice?: (channelId: string, preflightStream?: MediaStream) => void }).__voxperyJoinVoice = joinFn
    return () => {
      if ((window as Window & { __voxperyJoinVoice?: (channelId: string, preflightStream?: MediaStream) => void }).__voxperyJoinVoice === joinFn) {
        delete (window as Window & { __voxperyJoinVoice?: (channelId: string, preflightStream?: MediaStream) => void }).__voxperyJoinVoice
      }
    }
  }, [joinVoice, leaveVoice, state.isJoining, state.joinedChannelId, state.livekit])

  // Unblock auto-join when user switches to another channel.
  useEffect(() => {
    if (!blockedAutoJoinChannelId) return
    if (selectedVoiceChannelId !== blockedAutoJoinChannelId) {
      queueMicrotask(() => setBlockedAutoJoinChannelId(null))
    }
  }, [blockedAutoJoinChannelId, selectedVoiceChannelId])

  useEffect(() => {
    if (!state.lastError) return
    if (state.lastError === lastShownErrorRef.current) return
    lastShownErrorRef.current = state.lastError

    const raw = state.lastError
    const lower = raw.toLowerCase()
    let message = raw
    if (lower.includes('notallowederror') || lower.includes('permission denied') || lower.includes('permission')) {
      message = 'Permission was blocked. Allow microphone/screen access in browser settings and try again.'
    } else if (lower.includes('notfounderror') || lower.includes('device not found')) {
      message = 'No microphone device detected. Connect a microphone and retry.'
    } else if (lower.includes('websocket is not connected')) {
      message = 'Voice service is reconnecting. Wait a few seconds and try again.'
    }

    pushToast({
      level: 'error',
      title: 'Voice action failed',
      message,
    })
  }, [pushToast, state.lastError])

  const toggleMute = () => {
    const stream = localStreamRef.current ?? state.localStream
    if (!stream) return
    const next = !muted
    for (const t of stream.getAudioTracks()) t.enabled = !next
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      await joinVoice(channelId, { preflightStream: stream })
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop())
      const errObj = err as Error
      const name = errObj.name ?? ''
      let message = errObj.message || 'Unable to access microphone. Check your device and try again.'
      if (message === 'Failed to fetch') {
        message = 'Connection error. Check your internet connection.'
      } else if (name === 'NotAllowedError' || name === 'SecurityError') {
        message = 'Permission was blocked. Allow microphone access in browser settings and try again.'
      } else if (name === 'NotFoundError') {
        message = 'No microphone device detected. Connect a microphone and retry.'
      } else if (name === 'NotReadableError') {
        message = 'Microphone is in use by another app. Close it and retry.'
      }
      pushToast({
        level: 'error',
        title: 'Voice action failed',
        message,
      })
    }
  }

  const handleJoinLeave = async () => {
    // Never auto-leave when navigating (e.g. to Social). Only leave when user explicitly leaves this channel.
    if (!selectedVoiceChannelId && !state.joinedChannelId) return
    if (!selectedVoiceChannelId) return // in call but no channel selected in UI (e.g. on Social) – keep call, do nothing
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
        for (const t of stream.getAudioTracks()) t.enabled = !restoreMuted
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
      // ignore storage errors
    }
    try {
      await startScreenShare()
    } catch (e) {
      const message = e instanceof Error
        ? e.message
        : 'Unable to start screen sharing. Check permission and active window selection.'
      pushToast({
        level: 'error',
        title: 'Screen share failed',
        message,
      })
      console.error('Failed to start screen share:', e)
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

  const confirmCamera = async () => {
    setShowCameraConfirm(false)
    try {
      await startCamera()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not access camera. Check permission.'
      pushToast({ level: 'error', title: 'Camera failed', message })
    }
  }

  // Hide dock only when both call state and local media are absent.
  // This prevents transient state desync from making controls disappear.
  if (!state.joinedChannelId && !state.localStream) return null
  const handleTileMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const tile = e.currentTarget
    tile.classList.remove('is-mouse-idle')
    const to = (tile as any)._idleTimeout
    if (to) clearTimeout(to)
      ; (tile as any)._idleTimeout = setTimeout(() => {
        tile.classList.add('is-mouse-idle')
      }, 1000)
  }

  const handleTileMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const tile = e.currentTarget
    tile.classList.remove('is-mouse-idle')
    const to = (tile as any)._idleTimeout
    if (to) clearTimeout(to)
  }

  const localInitial = (user?.username?.charAt(0) || 'Y').toUpperCase()

  const remoteShareOwner = (peerId: string) =>
    members.find((m) => m.user_id === peerId)?.username ?? 'User'

  const localFallbackTileCount =
    currentVoiceChannelId && !channelParticipants.some((p) => p.user_id === user?.id) ? 1 : 0
  const totalStageTiles =
    channelParticipants.length +
    localFallbackTileCount +
    (state.isScreenSharing && state.screenStream ? 1 : 0) +
    (state.cameraStream ? 1 : 0) +
    remoteVideoTrackEntries.length
  const stageColumns = getStageColumns(totalStageTiles)
  const livekitInfo = state.livekit
  const roomState = livekitInfo.roomState
  const roomConnected = roomState === 'connected'
  const roomConnecting = state.isJoining || roomState === 'connecting'
  const roomReconnecting = roomState === 'reconnecting'
  const roomDisconnected = roomState === 'disconnected'
  const participantIds = new Set(channelParticipants.map((member) => member.user_id))
  if (state.joinedChannelId && user?.id) participantIds.add(user.id)
  const participantCount = participantIds.size
  const livekitLabel = livekitInfo
    ? `${livekitInfo.roomState} • P:${livekitInfo.participants} • S:${livekitInfo.remoteStreams}`
    : null
  const participantLabel = `${participantCount}`
  const connectionLabel =
    !state.joinedChannelId
      ? 'Offline'
      : roomConnecting
        ? 'Connecting...'
        : roomReconnecting
          ? 'Reconnecting...'
          : roomConnected
            ? `Connected (${participantLabel})`
            : roomDisconnected
              ? 'Offline'
              : 'Connecting...'
  const connectionTitle =
    roomConnected
      ? 'Connected'
      : connectionLabel
  const pingTooltip =
    !state.joinedChannelId
      ? 'Ping: N/A'
      : state.pingMs != null
        ? `Ping: ${state.pingMs} ms${state.diagnostics.wsPingMs != null ? ` (WS ${state.diagnostics.wsPingMs} ms` : ''}${state.diagnostics.rtcPingMs != null ? `${state.diagnostics.wsPingMs != null ? ', ' : ' ('}RTC ${state.diagnostics.rtcPingMs} ms` : ''}${state.diagnostics.wsPingMs != null || state.diagnostics.rtcPingMs != null ? ')' : ''}`
        : 'Ping: measuring...'
  const pingStateClass =
    !state.joinedChannelId || state.pingMs == null
      ? 'is-unknown'
      : state.pingMs <= 80
        ? 'is-good'
        : state.pingMs <= 150
          ? 'is-mid'
          : 'is-bad'
  const connectionStateClass =
    !state.joinedChannelId || roomDisconnected
      ? 'is-offline'
      : roomConnecting || roomReconnecting
        ? 'is-connecting'
        : 'is-connected'

  return (
    <>
      {showScreenShareConfirm && (
        <div className="modal-overlay" onClick={() => setShowScreenShareConfirm(false)}>
          <div className="modal screen-share-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Share your screen</h3>
            <p>
              Only share content you&apos;re comfortable with. Everyone in this channel will see your screen.
            </p>
            <div className="screen-share-quality-picker">
              <label htmlFor="screen-share-quality-select">Screen share quality</label>
              <select
                id="screen-share-quality-select"
                className="user-select"
                value={screenShareQuality}
                onChange={(e) => {
                  const raw = e.target.value
                  const next: ScreenShareQuality =
                    raw === 'presentation' || raw === 'video' || raw === 'gaming' ? raw : 'auto'
                  setScreenShareQuality(next)
                }}
              >
                <option value="auto">Auto</option>
                <option value="presentation">Presentation</option>
                <option value="video">Video</option>
                <option value="gaming">Gaming</option>
              </select>
              <div className="screen-share-quality-summary">{screenShareQualitySummary(screenShareQuality)}</div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowScreenShareConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void confirmScreenShare()}>
                Share screen
              </button>
            </div>
          </div>
        </div>
      )}
      {showCameraConfirm && (
        <div className="modal-overlay" onClick={() => setShowCameraConfirm(false)}>
          <div className="modal screen-share-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Turn on camera</h3>
            <p>
              Everyone in this channel will see your camera. Only turn it on if you&apos;re comfortable with that.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowCameraConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void confirmCamera()}>
                Turn on camera
              </button>
            </div>
          </div>
        </div>
      )}
      {showVoiceStage && (
        <div
          className="screen-share-stage"
          style={{ gridTemplateColumns: `repeat(${stageColumns}, minmax(0, 1fr))` }}
        >
          {channelParticipants.map((p) => (
            <div key={`participant-${p.user_id}`} className="voice-stage-tile">
              <div className={`voice-stage-avatar${voiceSpeakingUserIds.includes(p.user_id) ? ' is-speaking' : ''}`}>
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" />
                ) : (
                  (p.username.charAt(0) || '?').toUpperCase()
                )}
              </div>
              <div className="voice-stage-name">{p.username}</div>
              <div className="voice-stage-sub">
                <Users size={12} />
                In voice
              </div>
            </div>
          ))}
          {currentVoiceChannelId && !channelParticipants.some((p) => p.user_id === user?.id) && (
            <div key="participant-local-fallback" className="voice-stage-tile">
              <div className={`voice-stage-avatar${voiceLocalSpeaking ? ' is-speaking' : ''}`}>
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" />
                ) : (
                  localInitial
                )}
              </div>
              <div className="voice-stage-name">{user?.username ?? 'You'}</div>
              <div className="voice-stage-sub">
                <Users size={12} />
                In voice
              </div>
            </div>
          )}
          {state.cameraStream && (
            <div
              className="screen-share-preview voice-stage-share-tile camera-preview"
              onMouseMove={handleTileMouseMove}
              onMouseLeave={handleTileMouseLeave}
            >
              <video
                ref={(el) => { cameraVideoRef.current = el }}
                autoPlay
                muted
                playsInline
                style={{ objectFit: 'cover', width: '100%', height: '100%', backgroundColor: '#000' }}
              />
              <div className="screen-share-info-overlay">
                <span className="screen-share-info-text">Camera · You</span>
              </div>
            </div>
          )}
          {state.isScreenSharing && state.screenStream && (
            <div
              className="screen-share-preview voice-stage-share-tile"
              onMouseMove={handleTileMouseMove}
              onMouseLeave={handleTileMouseLeave}
            >
              <video
                autoPlay
                muted
                playsInline
                ref={(el) => {
                  if (!el) return
                  if (el.srcObject !== state.screenStream) el.srcObject = state.screenStream
                  void el.play().catch(() => { })
                }}
              />
              <div className="screen-share-info-overlay">
                <span className="screen-share-info-text">Screen share · You</span>
              </div>

              <div className="screen-share-controls-bar">
                <div className="screen-share-controls-left" />
                <div className="screen-share-controls-right">
                  <button
                    type="button"
                    className="screen-share-controls-btn"
                    title="Toggle fullscreen"
                    onClick={(e) => {
                      const tile = (e.currentTarget as HTMLElement).closest('.screen-share-preview') as HTMLElement | null
                      if (!tile) return
                      if (document.fullscreenElement) {
                        void document.exitFullscreen().catch(() => { })
                      } else {
                        void tile.requestFullscreen?.().catch(() => { })
                      }
                    }}
                  >
                    {document.fullscreenElement ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
              </div>
            </div>
          )}
          {remoteVideoTrackEntries.map(({ peerId, track, label }) => {
            const volumeKey = resolvePeerVolumeKey(peerId)
            const currentVol = peerVolumeByUserId[volumeKey] ?? 100
            return (
              <div
                key={`${peerId}-${track.id}`}
                className="screen-share-preview remote-screen-preview voice-stage-share-tile"
                onMouseMove={handleTileMouseMove}
                onMouseLeave={handleTileMouseLeave}
              >
                <video
                  autoPlay
                  muted
                  playsInline
                  ref={(el) => {
                    if (!el) return
                    let stream = remoteVideoStreamByTrackIdRef.current.get(track.id)
                    if (!stream) {
                      stream = new MediaStream([track])
                      remoteVideoStreamByTrackIdRef.current.set(track.id, stream)
                    }
                    if (el.srcObject !== stream) el.srcObject = stream
                    void el.play().catch(() => { })
                  }}
                />

                {/* Top info overlay */}
                <div className="screen-share-info-overlay">
                  <span className="screen-share-info-text">{label} · {remoteShareOwner(peerId)}</span>
                </div>

                {/* YouTube-style hover control bar */}
                <div className="screen-share-controls-bar">
                  <div className="screen-share-controls-left">
                    <div className="screen-share-volume-container">
                      <button
                        type="button"
                        className="screen-share-volume-btn"
                        onClick={() => {
                          const isMuted = currentVol === 0
                          const prevVolumeKey = `${volumeKey}_prev`

                          let newVal: number
                          if (isMuted) {
                            const savedStr = localStorage.getItem(prevVolumeKey)
                            const savedVal = savedStr ? Number(savedStr) : 100
                            newVal = savedVal > 0 ? savedVal : 100
                          } else {
                            localStorage.setItem(prevVolumeKey, String(currentVol))
                            newVal = 0
                          }

                          const next = { ...peerVolumeByUserId, [volumeKey]: newVal }
                          setPeerVolumeByUserId(next)
                          localStorage.setItem(PEER_VOLUME_KEY, JSON.stringify(next))
                          applyOutputVolumeToElements(outputVolumeRef.current / 100)
                        }}
                      >
                        {currentVol === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                      <div className="screen-share-volume-slider-wrap">
                        <input
                          type="range"
                          min={0}
                          max={200}
                          value={currentVol}
                          className="screen-share-volume-slider"
                          title={`Volume: ${currentVol}%`}
                          onChange={(e) => {
                            const val = Number(e.target.value)
                            const next = { ...peerVolumeByUserId, [volumeKey]: val }
                            setPeerVolumeByUserId(next)
                            localStorage.setItem(PEER_VOLUME_KEY, JSON.stringify(next))
                            applyOutputVolumeToElements(outputVolumeRef.current / 100)
                          }}
                        />
                        <span className="screen-share-volume-value">{currentVol}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="screen-share-controls-right">
                    <button
                      type="button"
                      className="screen-share-controls-btn"
                      title="Toggle fullscreen"
                      onClick={(e) => {
                        const tile = (e.currentTarget as HTMLElement).closest('.screen-share-preview') as HTMLElement | null
                        if (!tile) return
                        if (document.fullscreenElement) {
                          void document.exitFullscreen().catch(() => { })
                        } else {
                          void tile.requestFullscreen?.().catch(() => { })
                        }
                      }}
                    >
                      {document.fullscreenElement ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
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
          {/* Remote audio outputs (required to actually hear peers) */}
          <div style={{ display: 'none' }}>
            {Array.from(state.remoteStreams.keys()).map((peerId) => {
              const stream = state.remoteStreams.get(peerId)
              if (!stream) return null
              return (
                <audio
                  key={peerId}
                  autoPlay
                  playsInline
                  ref={(el) => {
                    if (el) {
                      console.log('[ActiveCallBar] Audio element for peer', peerId, 'created/updated')
                      remoteAudioRefsRef.current.set(peerId, el)
                      // Always ensure srcObject is set to the current stream
                      if (el.srcObject !== stream) {
                        console.log('[ActiveCallBar] Setting srcObject for peer', peerId)
                        el.srcObject = stream
                      }
                      // Set volume
                      const peerFactor = getPeerVolumeFactor(peerId)
                      const vol = Math.min(1, Math.max(0, (outputVolumeRef.current / 100) * peerFactor))
                      try {
                        el.volume = vol
                        console.log('[ActiveCallBar] Set volume for peer', peerId, 'to', vol)
                      } catch (e) {
                        console.warn('[ActiveCallBar] Failed to set volume:', e)
                      }
                      // Always unmute unless globally deafened
                      const shouldMute = deafenedRef.current
                      el.muted = shouldMute
                      console.log('[ActiveCallBar] Set muted for peer', peerId, 'to', shouldMute)
                      // Try to play if not deafened
                      if (!shouldMute) {
                        console.log('[ActiveCallBar] Attempting to play audio for peer', peerId)
                        ensureRemoteAudioPlayback(peerId, el)
                      }
                    } else {
                      console.log('[ActiveCallBar] Cleaning up audio element for peer', peerId)
                      remoteAudioRefsRef.current.delete(peerId)
                      const t = remoteAudioRetryTimerRef.current.get(peerId)
                      if (t != null) {
                        window.clearTimeout(t)
                        remoteAudioRetryTimerRef.current.delete(peerId)
                      }
                    }
                  }}
                />
              )
            })}
          </div>

          <div className="callbar-status">
            <div className="callbar-status-left">
              <button
                type="button"
                className="active-call-title active-call-title-btn"
                onClick={goToVoiceChannel}
                title={voiceLocation.full}
              >
                {voiceLocation.display}
              </button>
              <span className="callbar-connection-inline">
                <span className={`active-call-subtitle active-call-subtitle-inline ${connectionStateClass}`} title={connectionTitle}>
                  {(roomConnecting || roomReconnecting) && <span className="active-call-subtitle-spinner" aria-hidden="true" />}
                  {connectionLabel}
                </span>
                <span className={`callbar-ping-inline-icon ${pingStateClass}`} title={pingTooltip} aria-label={pingTooltip}>
                  <Wifi size={14} />
                </span>
              </span>
            </div>
          </div>

          <div className="callbar-controls">
            <div className="callbar-controls-main">
              <button
                onClick={toggleMute}
                disabled={!state.joinedChannelId || !state.localStream || deafened}
                className={`callbar-control-btn ${muted ? 'is-off' : ''}`}
                title={muted ? 'Unmute' : 'Mute'}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {muted ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
              <button
                onClick={toggleDeafen}
                disabled={!state.joinedChannelId}
                className={`callbar-control-btn ${deafened ? 'is-off' : ''}`}
                title={deafened ? 'Enable headphones' : 'Disable headphones'}
                aria-label={deafened ? 'Enable headphones' : 'Disable headphones'}
              >
                {deafened ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <button
                onClick={handleCamera}
                disabled={!state.joinedChannelId}
                className={`callbar-control-btn media-control ${state.cameraStream ? 'is-live' : ''}`}
                title={state.cameraStream ? 'Turn off camera' : 'Turn on camera'}
                aria-label={state.cameraStream ? 'Turn off camera' : 'Turn on camera'}
              >
                {state.cameraStream ? <Video size={16} /> : <VideoOff size={16} />}
              </button>
              <button
                onClick={handleScreenShare}
                disabled={!state.joinedChannelId}
                className={`callbar-control-btn media-control ${state.isScreenSharing ? 'is-live' : ''}`}
                title={state.isScreenSharing ? 'Stop sharing' : 'Share screen'}
                aria-label={state.isScreenSharing ? 'Stop screen sharing' : 'Start screen sharing'}
              >
                <Monitor size={16} />
              </button>
            </div>

            <div className="callbar-controls-right">
              <button
                onClick={handleJoinLeave}
                disabled={state.isJoining}
                className={`callbar-control-btn callbar-control-btn-disconnect danger ${(isInThisChannel || state.joinedChannelId) ? 'is-live' : ''}`}
                title={(isInThisChannel || state.joinedChannelId) ? 'Leave voice channel' : 'Join voice channel'}
                aria-label={(isInThisChannel || state.joinedChannelId) ? 'Leave voice channel' : 'Join voice channel'}
              >
                {(isInThisChannel || state.joinedChannelId) ? <PhoneOff size={16} /> : <PhoneOff size={16} style={{ transform: 'rotate(135deg)' }} />}
              </button>
            </div>
          </div>

          {livekitLabel && <div style={{ display: 'none' }}>{livekitLabel}</div>}
        </div>
      </div>
    </>
  )
}

