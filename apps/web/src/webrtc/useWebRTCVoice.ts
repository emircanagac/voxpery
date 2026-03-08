import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { webrtcApi, type TurnCredentials } from '../api'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { useSocketStore } from '../stores/socket'
import type { SignalingMessage } from '../types'
import { startAudioLevelMonitor } from './audioLevelMonitor'

type PeerId = string
/** getStats() forEach callback: each entry is a map of stat properties. */
type RtcStatEntry = Record<string, unknown>

/** Fallback ICE from build-time env (when API not used). */
function getIceServersFromEnv(): RTCIceServer[] {
  const env = typeof import.meta !== 'undefined' ? import.meta.env : ({} as Record<string, string>)
  const turnUrls = env.VITE_TURN_URLS
  const turnUser = env.VITE_TURN_USERNAME
  const turnCred = env.VITE_TURN_CREDENTIAL
  const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }]
  if (turnUrls && typeof turnUrls === 'string' && turnUrls.trim()) {
    const urls = turnUrls.split(',').map((u) => u.trim()).filter(Boolean)
    if (urls.length) {
      servers.push(
        turnUser && turnCred
          ? { urls, username: turnUser, credential: turnCred }
          : { urls }
      )
    }
  }
  return servers
}

export interface UseWebRTCVoiceState {
  joinedChannelId: string | null
  isJoining: boolean
  localStream: MediaStream | null
  screenStream: MediaStream | null
  isScreenSharing: boolean
  cameraStream: MediaStream | null
  remoteStreams: Map<PeerId, MediaStream>
  pingMs: number | null
  lastError: string | null
  diagnostics: {
    enabled: boolean
    voiceMode: 'voice_activity' | 'push_to_talk'
    packetLossPct: number | null
    jitterMs: number | null
    pingJitterMs: number | null
  }
}

/**
 * Serializes async WebRTC signaling tasks so that concurrent WebSocket events
 * (VoiceStateUpdate, Signal, VoiceControlUpdate) do not race each other.
 * Without this, rapid back-to-back events cause duplicate PeerConnections,
 * concurrent offer/answer negotiations on the same PC, and lost SDP answers —
 * the root cause of multi-user voice communication failures (5+ users).
 */
class SignalingQueue {
  private queue: (() => Promise<void>)[] = []
  private running = false

  enqueue(task: () => Promise<void>) {
    this.queue.push(task)
    if (!this.running) void this.drain()
  }

  private async drain() {
    this.running = true
    while (this.queue.length > 0) {
      const task = this.queue.shift()!
      try {
        await task()
      } catch (e) {
        console.error('[SignalingQueue] task error:', e)
      }
    }
    this.running = false
  }

  clear() {
    this.queue.length = 0
  }
}

function shouldInitiateOffer(localUserId: string, remoteUserId: string): boolean {
  // Deterministic tie-breaker to avoid "glare" (both sides creating offers).
  // Works because UUID strings are comparable lexicographically.
  return localUserId < remoteUserId
}

export function useWebRTCVoice() {
  const SOUND_KEY = 'voxpery-settings-sound-enabled'
  const NOISE_SUPPRESSION_KEY = 'voxpery-settings-noise-suppression'
  const INPUT_VOL_KEY = 'voxpery-settings-input-volume'
  const VOICE_MODE_KEY = 'voxpery-settings-voice-mode'
  const PTT_KEY_KEY = 'voxpery-settings-ptt-key'
  const SCREEN_SHARE_RESOLUTION_KEY = 'voxpery-settings-screen-share-resolution'
  const SCREEN_SHARE_FRAMERATE_KEY = 'voxpery-settings-screen-share-framerate'
  const SETTINGS_CHANGED_EVENT = 'voxpery-voice-settings-changed'

  type ScreenShareResolution = '720p' | '1080p'
  type ScreenShareFramerate = 30 | 60
  const getScreenShareConstraints = useCallback((): DisplayMediaStreamOptions['video'] => {
    const presetRaw = localStorage.getItem(SCREEN_SHARE_RESOLUTION_KEY)
    const preset: ScreenShareResolution = presetRaw === '1080p' ? '1080p' : '720p'
    const fpsRaw = localStorage.getItem(SCREEN_SHARE_FRAMERATE_KEY) || '30'
    const fps: ScreenShareFramerate = fpsRaw === '60' ? 60 : 30
    const base = { frameRate: { ideal: fps } as MediaTrackConstraintSet['frameRate'] }
    switch (preset) {
      case '1080p':
        return { ...base, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } }
      case '720p':
      default:
        return { ...base, width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 } }
    }
  }, [])
  const { user, token } = useAuthStore()
  const { send, subscribe, isConnected } = useSocketStore()

  const userId = user?.id ?? null

  const turnCredsRef = useRef<TurnCredentials | null>(null)
  const turnCredsLoadedRef = useRef(false)
  const turnCredsPromiseRef = useRef<Promise<void> | null>(null)
  useEffect(() => {
    if (!user) {
      turnCredsRef.current = null
      turnCredsLoadedRef.current = true
      turnCredsPromiseRef.current = null
      return
    }
    turnCredsLoadedRef.current = false
    let cancelled = false
    const p = webrtcApi.getTurnCredentials(token)
      .then((c) => {
        if (cancelled) return
        turnCredsRef.current = c
      })
      .catch(() => {
        if (cancelled) return
        turnCredsRef.current = null
      })
      .finally(() => {
        if (cancelled) return
        turnCredsLoadedRef.current = true
        turnCredsPromiseRef.current = null
      })
    turnCredsPromiseRef.current = p.then(() => { })
    return () => {
      cancelled = true
    }
  }, [user, token])

  const waitForTurnCreds = useCallback(async (timeoutMs = 1200) => {
    if (turnCredsLoadedRef.current) return
    const p = turnCredsPromiseRef.current
    if (!p) return
    let timer: number | null = null
    await Promise.race([
      p,
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, timeoutMs)
      }),
    ])
    if (timer != null) window.clearTimeout(timer)
  }, [])

  const getIceServers = useCallback((): RTCIceServer[] => {
    const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }]
    const c = turnCredsRef.current
    if (c?.urls?.length) {
      servers.push(
        c.username && c.credential
          ? { urls: c.urls, username: c.username, credential: c.credential }
          : { urls: c.urls }
      )
    } else {
      servers.push(...getIceServersFromEnv().slice(1))
    }
    return servers
  }, [])

  const pcsRef = useRef<Map<PeerId, RTCPeerConnection>>(new Map())
  const audioTxRef = useRef<Map<PeerId, RTCRtpTransceiver>>(new Map())
  const screenTxRef = useRef<Map<PeerId, RTCRtpTransceiver>>(new Map())
  const screenAudioTxRef = useRef<Map<PeerId, RTCRtpTransceiver>>(new Map())
  const cameraTxRef = useRef<Map<PeerId, RTCRtpTransceiver>>(new Map())
  const remoteStreamsRef = useRef<Map<PeerId, MediaStream>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const sendStreamRef = useRef<MediaStream | null>(null) // mic with input gain applied, used for addTrack
  const inputGainNodeRef = useRef<GainNode | null>(null)
  const voiceGateGainNodeRef = useRef<GainNode | null>(null)
  const voiceActivitySpeakingRef = useRef(false)
  const remoteMonitorCleanupsRef = useRef<Map<PeerId, () => void>>(new Map())
  const localMonitorCleanupRef = useRef<(() => void) | null>(null)
  const joinedChannelIdRef = useRef<string | null>(null)
  const pttPressedRef = useRef(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const localJoinAtRef = useRef(0)
  const peerVoiceChannelRef = useRef<Map<string, string | null>>(new Map())
  const signalingQueueRef = useRef(new SignalingQueue())
  const inlineMonitorIntervalRef = useRef<number | null>(null)
  const pendingIceCandidatesRef = useRef<Map<PeerId, RTCIceCandidateInit[]>>(new Map())
  const peerRtpStatsRef = useRef<Map<PeerId, { sent: number; recv: number; at: number }>>(new Map())
  const initialOfferTimersRef = useRef<Map<PeerId, number>>(new Map())

  const [joinedChannelId, setJoinedChannelId] = useState<string | null>(null)
  const [isJoining, setIsJoining] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [remoteStreamsVersion, setRemoteStreamsVersion] = useState(0)
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [wsPingMs, setWsPingMs] = useState<number | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [packetLossPct, setPacketLossPct] = useState<number | null>(null)
  const [jitterMs, setJitterMs] = useState<number | null>(null)
  const [wsPingJitterMs, setWsPingJitterMs] = useState<number | null>(null)
  const [icePingJitterMs, setIcePingJitterMs] = useState<number | null>(null)
  const lastWsPingSamplesRef = useRef<number[]>([])
  const lastIcePingSamplesRef = useRef<number[]>([])
  const lastWsPingMsRef = useRef<number | null>(null)
  const lastIcePingMsRef = useRef<number | null>(null)
  const prevPacketsRef = useRef<{ received: number; lost: number } | null>(null)
  const [voiceMode, setVoiceMode] = useState<'voice_activity' | 'push_to_talk'>(() => {
    const modeRaw = localStorage.getItem(VOICE_MODE_KEY)
    return modeRaw === 'push_to_talk' ? 'push_to_talk' : 'voice_activity'
  })
  const remoteStreams = useMemo(() => {
    // Expose a stable snapshot while still updating when map changes.
    return new Map(remoteStreamsRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remoteStreamsVersion intentionally triggers re-run to snapshot ref
  }, [remoteStreamsVersion])

  const bumpRemote = () => setRemoteStreamsVersion((v) => v + 1)

  const queueIceCandidate = useCallback((peerId: PeerId, candidate: RTCIceCandidateInit) => {
    const buf = pendingIceCandidatesRef.current.get(peerId) ?? []
    buf.push(candidate)
    pendingIceCandidatesRef.current.set(peerId, buf)
  }, [])

  const drainIceCandidates = useCallback(async (peerId: PeerId, pc: RTCPeerConnection) => {
    const buf = pendingIceCandidatesRef.current.get(peerId)
    if (!buf || buf.length === 0) return
    pendingIceCandidatesRef.current.delete(peerId)
    for (const candidate of buf) {
      try {
        await pc.addIceCandidate(candidate)
      } catch {
        // stale candidate; safe to ignore
      }
    }
  }, [])

  const closePeer = useCallback((peerId: PeerId) => {
    remoteMonitorCleanupsRef.current.get(peerId)?.()
    remoteMonitorCleanupsRef.current.delete(peerId)
    pendingIceCandidatesRef.current.delete(peerId)
    peerRtpStatsRef.current.delete(peerId)
    const t = initialOfferTimersRef.current.get(peerId)
    if (t != null) {
      window.clearTimeout(t)
      initialOfferTimersRef.current.delete(peerId)
    }
    useAppStore.getState().setVoiceSpeaking(
      useAppStore.getState().voiceSpeakingUserIds.filter((id) => id !== peerId),
      useAppStore.getState().voiceLocalSpeaking
    )
    const pc = pcsRef.current.get(peerId)
    if (pc) {
      try {
        pc.onicecandidate = null
        pc.ontrack = null
        pc.onconnectionstatechange = null
        pc.close()
      } catch {
        // ignore
      }
      pcsRef.current.delete(peerId)
    }
    audioTxRef.current.delete(peerId)
    screenTxRef.current.delete(peerId)
    screenAudioTxRef.current.delete(peerId)
    cameraTxRef.current.delete(peerId)
    if (remoteStreamsRef.current.has(peerId)) {
      remoteStreamsRef.current.delete(peerId)
      bumpRemote()
    }
  }, [])

  const cleanupAllPeers = useCallback(() => {
    for (const peerId of pcsRef.current.keys()) closePeer(peerId)
  }, [closePeer])

  const stopLocalMedia = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    for (const t of stream.getTracks()) t.stop()
    localStreamRef.current = null
    sendStreamRef.current = null
    inputGainNodeRef.current = null
    voiceGateGainNodeRef.current = null
    voiceActivitySpeakingRef.current = false
    if (inlineMonitorIntervalRef.current != null) {
      window.clearInterval(inlineMonitorIntervalRef.current)
      inlineMonitorIntervalRef.current = null
    }
    setLocalStream(null)
  }, [])

  const sendSignal = useCallback((targetUserId: string, signal: SignalingMessage) => {
    send('Signal', { target_user_id: targetUserId, signal })
  }, [send])

  const setVoiceControls = useCallback((muted: boolean, deafened: boolean, screenSharing: boolean) => {
    const store = useAppStore.getState()
    const cameraOn = userId ? store.voiceControls[userId]?.cameraOn ?? false : false
    send('SetVoiceControl', { muted, deafened, screen_sharing: screenSharing, camera_on: cameraOn })
  }, [send, userId])

  const getVoiceModeSettings = useCallback(() => {
    const modeRaw = localStorage.getItem(VOICE_MODE_KEY)
    const mode = modeRaw === 'push_to_talk' ? 'push_to_talk' : 'voice_activity'
    const keyRaw = localStorage.getItem(PTT_KEY_KEY)
    const key = keyRaw && keyRaw.trim().length > 0 ? keyRaw.trim() : 'V'
    return { mode, key }
  }, [])

  const isSoundEnabled = useCallback(() => localStorage.getItem(SOUND_KEY) !== '0', [])

  type VoiceCueKind = 'join' | 'leave' | 'mute' | 'unmute' | 'deafen' | 'undeafen'

  const playVoiceCue = useCallback((kind: VoiceCueKind) => {
    if (!isSoundEnabled()) return
    const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    if (!audioCtxRef.current) audioCtxRef.current = new AudioCtor()
    const ctx = audioCtxRef.current
    if (!ctx) return
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => { })
    }

    const playTone = (opts: {
      from: number
      to?: number
      offsetSec: number
      durationSec: number
      wave?: OscillatorType
      peak?: number
    }) => {
      const {
        from,
        to,
        offsetSec,
        durationSec,
        wave = 'sine',
        peak = 0.026,
      } = opts
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const startAt = ctx.currentTime + offsetSec
      const endAt = startAt + durationSec
      const attack = Math.max(0.006, Math.min(0.012, durationSec * 0.3))
      const releaseAt = startAt + Math.max(attack + 0.004, durationSec * 0.45)

      osc.type = wave
      osc.frequency.setValueAtTime(from, startAt)
      if (typeof to === 'number' && Number.isFinite(to) && to > 0) {
        osc.frequency.exponentialRampToValueAtTime(to, endAt)
      }
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.exponentialRampToValueAtTime(peak, startAt + attack)
      gain.gain.setValueAtTime(peak * 0.92, releaseAt)
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(startAt)
      osc.stop(endAt)
    }

    switch (kind) {
      case 'join':
        playTone({ from: 640, to: 820, offsetSec: 0, durationSec: 0.075, wave: 'triangle', peak: 0.024 })
        playTone({ from: 980, to: 1220, offsetSec: 0.085, durationSec: 0.1, wave: 'triangle', peak: 0.026 })
        break
      case 'leave':
        playTone({ from: 760, to: 600, offsetSec: 0, durationSec: 0.08, wave: 'triangle', peak: 0.024 })
        playTone({ from: 520, to: 390, offsetSec: 0.085, durationSec: 0.11, wave: 'sine', peak: 0.023 })
        break
      case 'mute':
        playTone({ from: 430, to: 350, offsetSec: 0, durationSec: 0.07, wave: 'square', peak: 0.019 })
        break
      case 'unmute':
        playTone({ from: 360, to: 520, offsetSec: 0, durationSec: 0.075, wave: 'triangle', peak: 0.023 })
        break
      case 'deafen':
        playTone({ from: 420, to: 330, offsetSec: 0, durationSec: 0.075, wave: 'sawtooth', peak: 0.02 })
        playTone({ from: 280, to: 220, offsetSec: 0.078, durationSec: 0.09, wave: 'sine', peak: 0.018 })
        break
      case 'undeafen':
        playTone({ from: 250, to: 320, offsetSec: 0, durationSec: 0.075, wave: 'triangle', peak: 0.02 })
        playTone({ from: 420, to: 590, offsetSec: 0.078, durationSec: 0.095, wave: 'triangle', peak: 0.024 })
        break
    }
  }, [isSoundEnabled])

  const applyPushToTalkGate = useCallback(() => {
    if (!userId) return
    const stream = localStreamRef.current
    if (!stream) return
    const { mode } = getVoiceModeSettings()
    const control = useAppStore.getState().voiceControls[userId]
    const manualMuted = !!control?.muted
    const deafened = !!control?.deafened
    const shouldEnable = mode === 'push_to_talk'
      ? (pttPressedRef.current && !manualMuted && !deafened)
      : (!manualMuted && !deafened)
    for (const t of stream.getAudioTracks()) t.enabled = shouldEnable
  }, [getVoiceModeSettings, userId])

  const applyVoiceActivityGate = useCallback((speaking: boolean) => {
    voiceActivitySpeakingRef.current = speaking
    const gate = voiceGateGainNodeRef.current
    const ctx = audioCtxRef.current
    if (!gate || !ctx) return
    const target = speaking ? 1 : 0.0001
    const now = ctx.currentTime
    gate.gain.cancelScheduledValues(now)
    gate.gain.setTargetAtTime(target, now, speaking ? 0.012 : 0.02)
  }, [])
  const getLocalVoiceControl = useCallback(() => {
    if (!userId) return { muted: false, deafened: false }
    const s = useAppStore.getState().voiceControls[userId]
    return { muted: s?.muted ?? false, deafened: s?.deafened ?? false }
  }, [userId])

  const ensurePeerConnection = useCallback(async (peerId: PeerId): Promise<RTCPeerConnection> => {
    let pc = pcsRef.current.get(peerId)
    if (pc) return pc

    await waitForTurnCreds()

    pc = new RTCPeerConnection({
      iceServers: getIceServers(),
    })

    // Reserve stable audio m-line so SDP always has m=audio (avoids race when mic arrives late).
    const audioTx = pc.addTransceiver('audio', { direction: 'recvonly' })
    audioTxRef.current.set(peerId, audioTx)

    // Reserve stable video m-lines for screen share and camera.
    const screenTx = pc.addTransceiver('video', { direction: 'recvonly' })
    screenTxRef.current.set(peerId, screenTx)
    const cameraTx = pc.addTransceiver('video', { direction: 'recvonly' })
    cameraTxRef.current.set(peerId, cameraTx)

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      sendSignal(peerId, {
        type: 'IceCandidate',
        payload: {
          candidate: ev.candidate.candidate,
          sdp_mid: ev.candidate.sdpMid ?? undefined,
          sdp_m_line_index: ev.candidate.sdpMLineIndex ?? undefined,
        },
      })
    }

    // We intentionally avoid auto onnegotiationneeded offers here because
    // it can cause glare (simultaneous offers). We renegotiate explicitly
    // from controlled actions like start/stop screen share.

    pc.ontrack = (ev) => {
      const incomingTrack = ev.track
      if (!incomingTrack) return

      if (ev.transceiver === screenTxRef.current.get(peerId)) {
        Object.defineProperty(incomingTrack, '__voxpery_isScreenShare', { value: true, writable: true, configurable: true })
      } else if (ev.transceiver === cameraTxRef.current.get(peerId)) {
        Object.defineProperty(incomingTrack, '__voxpery_isCamera', { value: true, writable: true, configurable: true })
      }

      // Keep a stable combined remote stream per peer.
      // Some browsers deliver audio/video in different stream objects.
      const combined = remoteStreamsRef.current.get(peerId) ?? new MediaStream()
      if (!combined.getTracks().some((t) => t.id === incomingTrack.id)) {
        combined.addTrack(incomingTrack)
      }
      remoteStreamsRef.current.set(peerId, combined)
      bumpRemote()
      incomingTrack.onunmute = () => bumpRemote()
      incomingTrack.onmute = () => bumpRemote()

      if (!remoteMonitorCleanupsRef.current.has(peerId)) {
        const cleanup = startAudioLevelMonitor(combined, (speaking) => {
          const store = useAppStore.getState()
          const next = new Set(store.voiceSpeakingUserIds)
          if (speaking) next.add(peerId)
          else next.delete(peerId)
          store.setVoiceSpeaking(Array.from(next), store.voiceLocalSpeaking)
        }, { forRemote: true })
        remoteMonitorCleanupsRef.current.set(peerId, cleanup)
      }

      incomingTrack.onended = () => {
        const current = remoteStreamsRef.current.get(peerId)
        if (!current) return
        const track = current.getTracks().find((t) => t.id === incomingTrack.id)
        if (track) current.removeTrack(track)
        if (current.getTracks().length === 0) {
          closePeer(peerId)
          return
        }
        bumpRemote()
      }
    }

    pc.onconnectionstatechange = () => {
      const st = pc!.connectionState
      // `disconnected` can be transient during renegotiation; don't close eagerly.
      if (st === 'failed' || st === 'closed') {
        closePeer(peerId)
      }
    }

    // Attach local tracks if already available (use send stream with input gain applied)
    const stream = sendStreamRef.current
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        audioTx.direction = 'sendrecv'
        await audioTx.sender.replaceTrack(audioTrack)
      }
    }
    const shared = screenStreamRef.current
    if (shared) {
      const [videoTrack] = shared.getVideoTracks()
      if (videoTrack) {
        screenTx.direction = 'sendrecv'
        await screenTx.sender.replaceTrack(videoTrack)

        try {
          const params = screenTx.sender.getParameters()
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}]
          }
          params.encodings[0].maxBitrate = 2500000
          await screenTx.sender.setParameters(params)
        } catch {
          // ignore
        }
      }
      const [screenAudioTrack] = shared.getAudioTracks()
      if (screenAudioTrack) {
        let screenAudioTx = screenAudioTxRef.current.get(peerId)
        if (!screenAudioTx) {
          screenAudioTx = pc.addTransceiver('audio', { direction: 'recvonly' })
          screenAudioTxRef.current.set(peerId, screenAudioTx)
        }
        screenAudioTx.direction = 'sendrecv'
        await screenAudioTx.sender.replaceTrack(screenAudioTrack)
      }
    }
    const camStream = cameraStreamRef.current
    if (camStream) {
      const [cameraTrack] = camStream.getVideoTracks()
      if (cameraTrack) {
        const camTx = cameraTxRef.current.get(peerId)
        if (camTx) {
          camTx.direction = 'sendrecv'
          await camTx.sender.replaceTrack(cameraTrack)
        }
      }
    }

    pcsRef.current.set(peerId, pc)
    return pc
  }, [closePeer, getIceServers, sendSignal, waitForTurnCreds])

  const ensureLocalAudioSender = useCallback(async (peerId: PeerId, pc: RTCPeerConnection) => {
    const stream = sendStreamRef.current
    if (!stream) return
    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) return
    const audioTx = audioTxRef.current.get(peerId)
    if (audioTx) {
      audioTx.direction = 'sendrecv'
      if (audioTx.sender.track?.id !== audioTrack.id) {
        await audioTx.sender.replaceTrack(audioTrack)
      }
      return
    }
    pc.addTrack(audioTrack, stream)
  }, [])

  const createAndSendOffer = useCallback(async (peerId: PeerId, options?: { iceRestart?: boolean }) => {
    const pc = await ensurePeerConnection(peerId)
    await ensureLocalAudioSender(peerId, pc)
    const offer = await pc.createOffer({ iceRestart: options?.iceRestart })
    await pc.setLocalDescription(offer)
    sendSignal(peerId, { type: 'Offer', payload: { sdp: offer.sdp ?? '' } })
  }, [ensureLocalAudioSender, ensurePeerConnection, sendSignal])

  const syncPeersInChannel = useCallback(async (channelId: string, forceRenegotiate = false) => {
    if (!userId) return
    const voice = useAppStore.getState().voiceStates
    const peerIds = Object.entries(voice)
      .filter(([uid, cid]) => uid !== userId && cid === channelId)
      .map(([uid]) => uid)
    for (const peerId of peerIds) {
      const isOfferer = shouldInitiateOffer(userId, peerId)
      if (!isOfferer) continue
      const alreadyConnected = pcsRef.current.has(peerId)
      const pc = await ensurePeerConnection(peerId)
      if (alreadyConnected && !forceRenegotiate) continue
      if (pc.signalingState !== 'stable') continue
      try {
        await createAndSendOffer(peerId)
      } catch (e: unknown) {
        setLastError((e as Error)?.message ?? 'Failed to sync peer connection')
      }
    }
  }, [createAndSendOffer, ensurePeerConnection, userId])

  const renegotiateAllPeers = useCallback(async () => {
    for (const [peerId, pc] of pcsRef.current.entries()) {
      if (pc.signalingState !== 'stable') continue
      try {
        await createAndSendOffer(peerId)
      } catch (e: unknown) {
        setLastError((e as Error)?.message ?? 'Failed to renegotiate peer')
      }
    }
  }, [createAndSendOffer])

  const joinVoice = useCallback(async (channelId: string) => {
    if (!isConnected) throw new Error('WebSocket is not connected')
    if (!userId) throw new Error('Not authenticated')

    setLastError(null)
    setIsJoining(true)
    try {
      await waitForTurnCreds()
      // Create and resume AudioContext immediately (while still in user gesture) so iOS Safari allows audio.
      const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioCtor && !audioCtxRef.current) {
        audioCtxRef.current = new AudioCtor()
        const ctx = audioCtxRef.current
        if (ctx.state === 'suspended') await ctx.resume()
      }

      // Acquire mic with basic noise suppression / echo cancellation so peer connections can attach tracks.
      const noiseSuppressionEnabled = localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0'
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: noiseSuppressionEnabled,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
        video: false,
      })
      // Store in ref immediately to avoid races with offer creation.
      localStreamRef.current = stream
      setLocalStream(stream)
      // Apply input volume via Web Audio gain (mic send level); context created at top for iOS, or here if missing.
      const AudioCtorForGain = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioCtorForGain) {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioCtorForGain()
        const ctx = audioCtxRef.current
        if (ctx.state === 'suspended') await ctx.resume()
        const source = ctx.createMediaStreamSource(stream)
        const gainNode = ctx.createGain()
        const gateNode = ctx.createGain()
        const dest = ctx.createMediaStreamDestination()
        // Inline analyser shares the SAME AudioContext and source node.
        // Previous design used a separate AudioContext for the speaking
        // monitor which could stay suspended (created outside user gesture
        // in a useEffect) or receive no mic data (some browsers break when
        // two createMediaStreamSource() target the same stream on different
        // contexts). Both failures kept the voice gate at 0.0001 = silence.
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.85
        source.connect(analyser)  // branch 1: speaking detection
        source.connect(gainNode)  // branch 2: voice send chain
        gainNode.connect(gateNode)
        gateNode.connect(dest)
        const inputVol = Math.min(100, Math.max(1, Number(localStorage.getItem(INPUT_VOL_KEY)) || 100)) / 100
        gainNode.gain.value = inputVol
        inputGainNodeRef.current = gainNode
        voiceGateGainNodeRef.current = gateNode
        // Gate starts OPEN (1.0) so audio flows immediately on join.
        // Voice activity detection closes it only after confirmed silence.
        // This prevents the old failure mode where a suspended monitor kept
        // the gate at 0.0001 indefinitely, causing total silence.
        gateNode.gain.value = 1
        voiceActivitySpeakingRef.current = true
        // Inline voice-activity monitor — same AudioContext, no suspend issues.
        // Runs for all modes (speaking indicator always needed); gate control
        // is only applied when mode is voice_activity (checked each tick).
        const monBufLen = Math.max(128, analyser.frequencyBinCount || 128, analyser.fftSize || 256)
        const monData = new Float32Array(monBufLen)
        let monLastSpeaking = true
        let monBelowCount = 0
        const monHoldTicks = Math.max(1, Math.ceil(450 / 80))
        if (inlineMonitorIntervalRef.current != null) window.clearInterval(inlineMonitorIntervalRef.current)
        inlineMonitorIntervalRef.current = window.setInterval(() => {
          try {
            if (ctx.state === 'closed') return
            if (ctx.state === 'suspended') { void ctx.resume().catch(() => { }); return }
            analyser.getFloatTimeDomainData(monData)
            let sum = 0
            for (let i = 0; i < monData.length; i++) sum += monData[i] * monData[i]
            const rms = Math.sqrt(sum / monData.length)
            const thrRaw = localStorage.getItem('voxpery-settings-speaking-threshold')
            const slider = Math.min(100, Math.max(0, Number(thrRaw) || 22))
            const onThr = 0.005 + (slider / 100) * 0.055
            const offThr = Math.max(0.002, onThr * 0.35)
            if (rms >= onThr) {
              monBelowCount = 0
              if (!monLastSpeaking) {
                monLastSpeaking = true
                voiceActivitySpeakingRef.current = true
                if (getVoiceModeSettings().mode === 'voice_activity') applyVoiceActivityGate(true)
                useAppStore.getState().setVoiceSpeaking(useAppStore.getState().voiceSpeakingUserIds, true)
              }
            } else if (monLastSpeaking) {
              if (rms >= offThr) { monBelowCount = 0 }
              else {
                monBelowCount++
                if (monBelowCount >= monHoldTicks) {
                  monLastSpeaking = false
                  monBelowCount = 0
                  voiceActivitySpeakingRef.current = false
                  if (getVoiceModeSettings().mode === 'voice_activity') applyVoiceActivityGate(false)
                  useAppStore.getState().setVoiceSpeaking(useAppStore.getState().voiceSpeakingUserIds, false)
                }
              }
            }
          } catch { /* ignore analyser errors */ }
        }, 80)
        sendStreamRef.current = dest.stream
      } else {
        sendStreamRef.current = stream
      }
      const voiceMode = getVoiceModeSettings().mode
      if (voiceMode === 'push_to_talk') {
        for (const t of stream.getAudioTracks()) t.enabled = false
      }

      // Notify server (it will echo existing users to us via VoiceStateUpdate)
      joinedChannelIdRef.current = channelId
      send('JoinVoice', { channel_id: channelId })
      setJoinedChannelId(channelId)
      useAppStore.getState().setJoinedVoiceChannelId(channelId)
      setVoiceControls(false, false, false)
      localJoinAtRef.current = Date.now()
      peerVoiceChannelRef.current = new Map(
        Object.entries(useAppStore.getState().voiceStates).filter(([uid]) => uid !== userId)
      )
      playVoiceCue('join')
      window.setTimeout(() => {
        signalingQueueRef.current.enqueue(() => syncPeersInChannel(channelId))
      }, 50)
      // Retry once with renegotiation to catch late snapshots/race conditions
      // where an already-sharing peer was connected just before we joined.
      window.setTimeout(() => {
        signalingQueueRef.current.enqueue(() => syncPeersInChannel(channelId, true))
      }, 500)
    } catch (e: unknown) {
      setLastError((e as Error)?.message ?? 'Failed to join voice')
      stopLocalMedia()
      throw e
    } finally {
      setIsJoining(false)
    }
  }, [applyVoiceActivityGate, getVoiceModeSettings, isConnected, playVoiceCue, send, setVoiceControls, stopLocalMedia, syncPeersInChannel, userId, waitForTurnCreds])

  const leaveVoice = useCallback((options?: { skipLeaveSound?: boolean }) => {
    if (joinedChannelIdRef.current && !options?.skipLeaveSound) playVoiceCue('leave')
    setLastError(null)
    send('LeaveVoice', null)
    joinedChannelIdRef.current = null
    setJoinedChannelId(null)
    useAppStore.getState().setJoinedVoiceChannelId(null)
    localJoinAtRef.current = 0
    peerVoiceChannelRef.current.clear()
    signalingQueueRef.current.clear()
    remoteMonitorCleanupsRef.current.forEach((c) => c())
    remoteMonitorCleanupsRef.current.clear()
    if (inlineMonitorIntervalRef.current != null) {
      window.clearInterval(inlineMonitorIntervalRef.current)
      inlineMonitorIntervalRef.current = null
    }
    localMonitorCleanupRef.current?.()
    localMonitorCleanupRef.current = null
    useAppStore.getState().setVoiceSpeaking([], false)
    voiceGateGainNodeRef.current = null
    voiceActivitySpeakingRef.current = false
    cleanupAllPeers()
    stopLocalMedia()
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    setScreenStream(null)
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
    cameraStreamRef.current = null
    setCameraStream(null)
  }, [cleanupAllPeers, playVoiceCue, send, stopLocalMedia])

  const stopScreenShare = useCallback(() => {
    const stream = screenStreamRef.current
    if (!stream) return
    stream.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    setScreenStream(null)
    for (const [peerId] of pcsRef.current.entries()) {
      const tx = screenTxRef.current.get(peerId)
      if (tx) {
        tx.direction = 'recvonly'
        void tx.sender.replaceTrack(null)
      }
      const screenAudioTx = screenAudioTxRef.current.get(peerId)
      if (screenAudioTx) {
        screenAudioTx.direction = 'recvonly'
        void screenAudioTx.sender.replaceTrack(null)
      }
    }
    screenAudioTxRef.current.clear()
    const local = getLocalVoiceControl()
    setVoiceControls(local.muted, local.deafened, false)
    void renegotiateAllPeers()
  }, [getLocalVoiceControl, renegotiateAllPeers, setVoiceControls])

  const startScreenShare = useCallback(async () => {
    if (!joinedChannelId) {
      throw new Error('Join a voice channel before sharing your screen')
    }
    if (screenStreamRef.current) return
    const videoConstraints = getScreenShareConstraints()
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints,
      audio: true,
    })
    const [videoTrack] = stream.getVideoTracks()
    if (!videoTrack) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('No screen video track available')
    }

    try {
      if ('contentHint' in videoTrack) {
        videoTrack.contentHint = 'detail'
      }
    } catch {
      // ignore
    }
    const [screenAudioTrack] = stream.getAudioTracks()
    screenStreamRef.current = stream
    setScreenStream(stream)
    for (const [peerId, pc] of pcsRef.current.entries()) {
      let tx = screenTxRef.current.get(peerId)
      if (!tx) {
        tx = pc.addTransceiver('video', { direction: 'recvonly' })
        screenTxRef.current.set(peerId, tx)
      }
      tx.direction = 'sendrecv'
      await tx.sender.replaceTrack(videoTrack)

      try {
        const params = tx.sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}]
        }
        params.encodings[0].maxBitrate = 2500000 // 2.5 Mbps
        if ('networkPriority' in params.encodings[0]) {
          (params.encodings[0] as any).networkPriority = 'high'
        }
        await tx.sender.setParameters(params)
      } catch {
        // ignore setParameters errors (e.g. Firefox constraints)
      }
      if (screenAudioTrack) {
        let screenAudioTx = screenAudioTxRef.current.get(peerId)
        if (!screenAudioTx) {
          screenAudioTx = pc.addTransceiver('audio', { direction: 'recvonly' })
          screenAudioTxRef.current.set(peerId, screenAudioTx)
        }
        screenAudioTx.direction = 'sendrecv'
        await screenAudioTx.sender.replaceTrack(screenAudioTrack)
      }
    }
    const local = getLocalVoiceControl()
    setVoiceControls(local.muted, local.deafened, true)
    await renegotiateAllPeers()
    videoTrack.onended = () => {
      stopScreenShare()
    }
  }, [getLocalVoiceControl, getScreenShareConstraints, joinedChannelId, renegotiateAllPeers, setVoiceControls, stopScreenShare])

  const stopCamera = useCallback(() => {
    const stream = cameraStreamRef.current
    if (!stream) return
    stream.getTracks().forEach((t) => t.stop())
    cameraStreamRef.current = null
    setCameraStream(null)
    for (const [peerId] of pcsRef.current.entries()) {
      const tx = cameraTxRef.current.get(peerId)
      if (tx) {
        tx.direction = 'recvonly'
        void tx.sender.replaceTrack(null)
      }
    }
    void renegotiateAllPeers()
  }, [renegotiateAllPeers])

  const startCamera = useCallback(async () => {
    if (!joinedChannelId) {
      throw new Error('Join a voice channel before turning on camera')
    }
    if (cameraStreamRef.current) return
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    })
    const [videoTrack] = stream.getVideoTracks()
    if (!videoTrack) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('No camera video track available')
    }
    cameraStreamRef.current = stream
    setCameraStream(stream)
    for (const [peerId, pc] of pcsRef.current.entries()) {
      let tx = cameraTxRef.current.get(peerId)
      if (!tx) {
        tx = pc.addTransceiver('video', { direction: 'recvonly' })
        cameraTxRef.current.set(peerId, tx)
      }
      tx.direction = 'sendrecv'
      await tx.sender.replaceTrack(videoTrack)
    }
    await renegotiateAllPeers()
    videoTrack.onended = () => {
      stopCamera()
    }
  }, [joinedChannelId, renegotiateAllPeers, stopCamera])

  // When localStream becomes available after join, attach tracks (from send stream with gain) to existing PCs.
  // If we add/replace tracks on existing PCs, we must renegotiate so the remote peer gets the updated SDP (fixes P0: audio not reaching other party).
  useEffect(() => {
    if (!localStream) return
    // Keep ref in sync for code paths that use it (safety).
    localStreamRef.current = localStream
    const toSend = sendStreamRef.current
    let needsRenegotiation = false
    if (toSend) {
      const audioTrack = toSend.getAudioTracks()[0]
      if (audioTrack) {
        for (const [peerId, pc] of pcsRef.current.entries()) {
          const audioTx = audioTxRef.current.get(peerId)
          if (audioTx) {
            const existingTrackId = audioTx.sender.track?.id
            if (existingTrackId !== audioTrack.id) {
              audioTx.direction = 'sendrecv'
              audioTx.sender.replaceTrack(audioTrack)
              needsRenegotiation = true
            }
          } else {
            pc.addTrack(audioTrack, toSend)
            needsRenegotiation = true
          }
        }
      }
    }
    if (needsRenegotiation) void renegotiateAllPeers()
    // Local speaking monitor is now handled by the inline analyser created
    // in joinVoice (same AudioContext / same source node — no separate
    // context suspend issues).  Only cleanup the speaking indicator state.
    return () => {
      useAppStore.getState().setVoiceSpeaking(useAppStore.getState().voiceSpeakingUserIds, false)
    }
  }, [localStream, renegotiateAllPeers])

  // Keep store in sync with voice state so AppShell always has correct selectedVoiceChannelId (e.g. on Social).
  useEffect(() => {
    useAppStore.getState().setJoinedVoiceChannelId(joinedChannelId)
  }, [joinedChannelId])

  // Self-heal: if joined channel state is lost but local media is still active,
  // restore joined channel id from refs/store to avoid disappearing call controls.
  useEffect(() => {
    if (joinedChannelId) return
    if (!localStreamRef.current) return
    const fromRef = joinedChannelIdRef.current
    const fromStore = userId ? (useAppStore.getState().voiceStates[userId] ?? null) : null
    const recovered = fromRef ?? fromStore
    if (!recovered) return
    joinedChannelIdRef.current = recovered
    setJoinedChannelId(recovered)
    useAppStore.getState().setJoinedVoiceChannelId(recovered)
  }, [joinedChannelId, localStream, userId])

  // Input volume: always listen for settings change so gain updates even when effect below hasn't run yet.
  useEffect(() => {
    const onInputVolumeChanged = () => {
      const inputVol = Math.min(100, Math.max(1, Number(localStorage.getItem(INPUT_VOL_KEY)) || 100)) / 100
      if (inputGainNodeRef.current) inputGainNodeRef.current.gain.value = inputVol

      const nsEnabled = localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0'
      const audioTrack = localStreamRef.current?.getAudioTracks()[0]
      if (audioTrack?.applyConstraints) {
        void audioTrack.applyConstraints({ noiseSuppression: nsEnabled }).catch(() => { })
      }
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onInputVolumeChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onInputVolumeChanged)
  }, [])

  // Push-to-talk: only transmit while key is held.
  useEffect(() => {
    if (!joinedChannelId) return
    const onKeyDown = (e: KeyboardEvent) => {
      const { mode, key } = getVoiceModeSettings()
      if (mode !== 'push_to_talk') return
      const pressed = e.key?.length === 1 ? e.key.toUpperCase() : e.key
      const target = key.length === 1 ? key.toUpperCase() : key
      if (pressed !== target) return
      pttPressedRef.current = true
      applyPushToTalkGate()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const { mode, key } = getVoiceModeSettings()
      if (mode !== 'push_to_talk') return
      const pressed = e.key?.length === 1 ? e.key.toUpperCase() : e.key
      const target = key.length === 1 ? key.toUpperCase() : key
      if (pressed !== target) return
      pttPressedRef.current = false
      applyPushToTalkGate()
    }
    const onSettingsChanged = () => {
      const nextModeRaw = localStorage.getItem(VOICE_MODE_KEY)
      const nextMode = nextModeRaw === 'push_to_talk' ? 'push_to_talk' : 'voice_activity'
      setVoiceMode(nextMode)
      pttPressedRef.current = false
      if (nextMode === 'push_to_talk') {
        applyVoiceActivityGate(true)
      } else {
        applyVoiceActivityGate(voiceActivitySpeakingRef.current)
      }
      applyPushToTalkGate()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener)
    }
  }, [applyPushToTalkGate, applyVoiceActivityGate, getVoiceModeSettings, joinedChannelId])

  const PING_SAMPLE_SIZE = 5
  const computeJitter = (buf: number[]) => {
    if (buf.length < 2) return null
    let sum = 0
    for (let i = 1; i < buf.length; i++) sum += Math.abs(buf[i]! - buf[i - 1]!)
    return Math.round(sum / (buf.length - 1))
  }
  const pushWsPingSample = useCallback((ms: number) => {
    const buf = lastWsPingSamplesRef.current
    buf.push(ms)
    if (buf.length > PING_SAMPLE_SIZE) buf.shift()
    setWsPingJitterMs(computeJitter(buf))
  }, [])
  const pushIcePingSample = useCallback((ms: number) => {
    const buf = lastIcePingSamplesRef.current
    buf.push(ms)
    if (buf.length > PING_SAMPLE_SIZE) buf.shift()
    setIcePingJitterMs(computeJitter(buf))
  }, [])

  // Poll selected ICE candidate-pair RTT as voice path ping; burst then steady interval; asymmetric EMA (fast drop, slow rise).
  useEffect(() => {
    if (!joinedChannelId) {
      setPingMs(null)
      setWsPingMs(null)
      setWsPingJitterMs(null)
      setIcePingJitterMs(null)
      lastWsPingSamplesRef.current = []
      lastIcePingSamplesRef.current = []
      lastWsPingMsRef.current = null
      lastIcePingMsRef.current = null
      return
    }
    let cancelled = false
    let sampleCount = 0
    let timer: ReturnType<typeof window.setTimeout>

    const applyIcePing = (raw: number) => {
      const prev = lastIcePingMsRef.current
      const value =
        prev == null
          ? raw
          : raw < prev
            ? Math.round(prev * 0.2 + raw * 0.8)
            : Math.round(prev * 0.6 + raw * 0.4)
      pushIcePingSample(value)
      lastIcePingMsRef.current = value
      setPingMs(value)
    }

    const samplePing = async () => {
      const samples: number[] = []
      for (const pc of pcsRef.current.values()) {
        try {
          const stats = await pc.getStats()
          const byId = new Map<string, RtcStatEntry>()
          stats.forEach((report: RtcStatEntry) => {
            if (report?.id) byId.set(report.id as string, report)
          })

          // Chromium/WebKit path: resolve selected candidate pair via transport report.
          stats.forEach((report: RtcStatEntry) => {
            if (report.type !== 'transport') return
            const selectedPairId = report.selectedCandidatePairId as string | undefined
            if (!selectedPairId) return
            const pair = byId.get(selectedPairId)
            if (!pair || pair.type !== 'candidate-pair') return
            let rttSec: number | null =
              typeof pair.currentRoundTripTime === 'number' ? (pair.currentRoundTripTime as number) : null
            if (
              rttSec == null &&
              typeof pair.totalRoundTripTime === 'number' &&
              typeof pair.responsesReceived === 'number' &&
              (pair.responsesReceived as number) > 0
            ) {
              rttSec = (pair.totalRoundTripTime as number) / (pair.responsesReceived as number)
            }
            if (typeof rttSec === 'number' && Number.isFinite(rttSec) && rttSec > 0) {
              samples.push(rttSec * 1000)
            }
          })

          // Fallback path: candidate-pair reports directly marked selected/nominated.
          stats.forEach((report: RtcStatEntry) => {
            if (report.type !== 'candidate-pair') return
            if (report.state !== 'succeeded') return
            if (!report.nominated && !report.selected) return

            let rttSec: number | null =
              typeof report.currentRoundTripTime === 'number' ? (report.currentRoundTripTime as number) : null
            if (
              rttSec == null &&
              typeof report.totalRoundTripTime === 'number' &&
              typeof report.responsesReceived === 'number' &&
              (report.responsesReceived as number) > 0
            ) {
              rttSec = (report.totalRoundTripTime as number) / (report.responsesReceived as number)
            }
            if (typeof rttSec === 'number' && Number.isFinite(rttSec) && rttSec > 0) {
              samples.push(rttSec * 1000)
            }
          })

          // Firefox fallback: remote-inbound-rtp roundTripTime.
          stats.forEach((report: RtcStatEntry) => {
            if (report.type !== 'remote-inbound-rtp') return
            if (typeof report.roundTripTime !== 'number') return
            if (!Number.isFinite(report.roundTripTime) || (report.roundTripTime as number) <= 0) return
            samples.push((report.roundTripTime as number) * 1000)
          })
        } catch {
          // ignore transient stats failures
        }
      }

      if (cancelled) return
      if (samples.length === 0) {
        const rttHint = Number((navigator as Navigator & { connection?: { rtt?: number } })?.connection?.rtt)
        if (Number.isFinite(rttHint) && rttHint > 0) {
          applyIcePing(Math.round(rttHint))
        }
        sampleCount++
        return
      }
      const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      applyIcePing(avg)
      sampleCount++
    }

    const scheduleNext = () => {
      if (cancelled) return
      const interval = sampleCount < 10 ? 500 : pcsRef.current.size > 0 ? 2500 : 5000
      timer = window.setTimeout(() => {
        void samplePing().then(scheduleNext)
      }, interval)
    }

    void samplePing().then(scheduleNext)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [joinedChannelId, remoteStreamsVersion, pushIcePingSample])

  // Poll inbound audio stats for diagnostics (packet loss and jitter). Packet loss = interval-based % (delta lost / delta packets) so it reflects recent quality.
  useEffect(() => {
    if (!joinedChannelId) {
      setPacketLossPct(null)
      setJitterMs(null)
      prevPacketsRef.current = null
      return
    }
    let cancelled = false
    const sampleDiagnostics = async () => {
      let totalLost = 0
      let totalReceived = 0
      const jitters: number[] = []
      for (const pc of pcsRef.current.values()) {
        try {
          const stats = await pc.getStats()
          stats.forEach((report: RtcStatEntry) => {
            const kind = report?.kind ?? report?.mediaType
            if (report?.type !== 'inbound-rtp') return
            if (report?.isRemote) return
            if (kind !== 'audio') return
            const lost = Number(report?.packetsLost ?? 0)
            const received = Number(report?.packetsReceived ?? 0)
            if (Number.isFinite(lost)) totalLost += lost
            if (Number.isFinite(received)) totalReceived += received
            const jitterSec = Number(report?.jitter)
            if (Number.isFinite(jitterSec) && jitterSec >= 0) {
              jitters.push(jitterSec * 1000)
            }
          })
        } catch {
          // ignore
        }
      }
      if (cancelled) return
      const prev = prevPacketsRef.current
      prevPacketsRef.current = { received: totalReceived, lost: totalLost }
      if (prev != null) {
        const deltaLost = totalLost - prev.lost
        const deltaReceived = totalReceived - prev.received
        const deltaPackets = deltaReceived + deltaLost
        if (deltaPackets > 0 && deltaLost >= 0) {
          const intervalLossPct = (deltaLost / deltaPackets) * 100
          setPacketLossPct((p) => {
            const next = Number(intervalLossPct.toFixed(1))
            return p == null ? next : Number((p * 0.5 + next * 0.5).toFixed(1))
          })
        }
      } else {
        const totalPackets = totalReceived + totalLost
        if (totalPackets > 0) {
          setPacketLossPct(Number(((totalLost / totalPackets) * 100).toFixed(1)))
        }
      }
      if (jitters.length > 0) {
        const avgJitter = jitters.reduce((a, b) => a + b, 0) / jitters.length
        setJitterMs((prev) => {
          if (prev == null) return Math.round(avgJitter)
          return Math.round(prev * 0.65 + avgJitter * 0.35)
        })
      } else {
        setJitterMs(null)
      }
    }
    void sampleDiagnostics()
    const timer = window.setInterval(() => { void sampleDiagnostics() }, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [joinedChannelId, remoteStreamsVersion])

  // WS ping/pong latency probe: burst first 5 pings at 500ms, then 2.5s or 5s.
  useEffect(() => {
    if (!joinedChannelId || !isConnected) return

    let count = 0
    let timer: ReturnType<typeof window.setTimeout>

    const runPingLoop = () => {
      send('Ping', { sent_at_ms: Date.now() })
      count++
      const delay = count < 5 ? 500 : pcsRef.current.size > 0 ? 2500 : 5000
      timer = window.setTimeout(runPingLoop, delay)
    }

    runPingLoop()
    return () => window.clearTimeout(timer)
  }, [isConnected, joinedChannelId, send, remoteStreamsVersion])

  // WS event handling for voice + signaling.
  // All WebRTC signaling is serialized through a queue to prevent concurrent
  // PC creation / offer / answer races that break multi-user voice.
  useEffect(() => {
    if (!userId) return
    const queue = signalingQueueRef.current
    const unsub = subscribe((evt: unknown) => {
      type WsEvt = { type: string; data?: unknown }
      const e = evt as WsEvt
      if (!e || typeof e.type !== 'string') return

      // Pong is synchronous and latency-sensitive — handle outside the queue.
      if (e.type === 'Pong') {
        const sentAt = Number((e.data as { sent_at_ms?: number })?.sent_at_ms)
        if (!Number.isFinite(sentAt) || sentAt <= 0) return
        const rtt = Date.now() - sentAt
        if (!Number.isFinite(rtt) || rtt <= 0) return
        const next = Math.round(rtt)
        const prev = lastWsPingMsRef.current
        const value =
          prev == null
            ? next
            : next < prev
              ? Math.round(prev * 0.2 + next * 0.8)
              : Math.round(prev * 0.6 + next * 0.4)
        pushWsPingSample(value)
        lastWsPingMsRef.current = value
        setWsPingMs(value)
        return
      }

      // Serialize all WebRTC signaling events through the queue to prevent
      // race conditions from concurrent async processing.
      queue.enqueue(async () => {

        if (e.type === 'VoiceStateUpdate') {
          const { channel_id, user_id } = (e.data as Record<string, unknown>) ?? {}
          // Server sends: channel_id = Some(id) when joined, None when left.
          if (!user_id || typeof user_id !== 'string') return
          if (user_id === userId) return
          const prevChannelId =
            peerVoiceChannelRef.current.get(user_id) ?? (useAppStore.getState().voiceStates[user_id] ?? null)
          const nextChannelId = typeof channel_id === 'string' ? channel_id : null
          peerVoiceChannelRef.current.set(user_id, nextChannelId)
          const localJoinedChannelId = joinedChannelIdRef.current
          if (!localJoinedChannelId) return
          const suppressJoinSound = Date.now() - localJoinAtRef.current < 1600
          if (nextChannelId === localJoinedChannelId && prevChannelId !== localJoinedChannelId && !suppressJoinSound) {
            playVoiceCue('join')
          } else if (prevChannelId === localJoinedChannelId && nextChannelId !== localJoinedChannelId) {
            playVoiceCue('leave')
          }

          if (channel_id === localJoinedChannelId) {
            // Peer joined the same channel — always create peer connection.
            // The deterministic offerer sends the offer; the non-offerer also
            // sends an offer after a short delay if no incoming offer arrives,
            // to guarantee connection even when events are delayed or lost.
            await ensurePeerConnection(user_id)
            if (screenStreamRef.current) {
              // If we are currently sharing screen, proactively offer to new peers
              // so late joiners receive the active stream immediately.
              try {
                await createAndSendOffer(user_id)
              } catch (e: unknown) {
                setLastError((e as Error)?.message ?? 'Failed to create offer for screen share')
              }
            } else if (shouldInitiateOffer(userId, user_id)) {
              try {
                await createAndSendOffer(user_id)
              } catch (e: unknown) {
                setLastError((e as Error)?.message ?? 'Failed to create offer')
              }
            } else {
              // Non-offerer: if no offer arrives within 300ms, send one ourselves
              // to avoid deadlock when the offerer's VoiceStateUpdate is delayed.
              const peerId = user_id
              window.setTimeout(() => {
                signalingQueueRef.current.enqueue(async () => {
                  const pc = pcsRef.current.get(peerId)
                  if (!pc) return
                  // Only offer if still in 'new' state (no incoming offer processed yet)
                  if (pc.connectionState !== 'new') return
                  if (pc.signalingState !== 'stable') return
                  try {
                    await createAndSendOffer(peerId)
                  } catch { /* self-heal will retry */ }
                })
              }, 300)
            }

            // Safety: if we still don't have remote audio shortly after join,
            // force a renegotiation with ICE restart to stabilize multi-peer.
            if (!initialOfferTimersRef.current.has(user_id)) {
              const timer = window.setTimeout(() => {
                signalingQueueRef.current.enqueue(async () => {
                  const pc = pcsRef.current.get(user_id)
                  if (!pc) return
                  if (pc.signalingState !== 'stable') return
                  const remote = remoteStreamsRef.current.get(user_id)
                  const hasLiveRemoteAudio = !!remote?.getAudioTracks().some((t) => t.readyState === 'live')
                  if (hasLiveRemoteAudio) return
                  try {
                    await createAndSendOffer(user_id, { iceRestart: true })
                  } catch { /* self-heal will retry */ }
                })
              }, 600)
              initialOfferTimersRef.current.set(user_id, timer)
            }
          } else if (channel_id == null) {
            // Peer left voice (we don't know which channel), close if exists
            closePeer(user_id)
          } else {
            // Peer switched channels; if not ours, close connection
            closePeer(user_id)
          }
        }

        if (e.type === 'VoiceControlUpdate') {
          const data = (e.data as Record<string, unknown>) ?? {}
          const user_id = data.user_id as string | undefined
          const screen_sharing = data.screen_sharing
          if (!user_id || user_id === userId || !screen_sharing) return
          const localJoinedChannelId = joinedChannelIdRef.current
          if (!localJoinedChannelId) return
          const voiceStates = useAppStore.getState().voiceStates
          if (voiceStates[user_id] !== localJoinedChannelId) return

          const pc = await ensurePeerConnection(user_id)
          if (pc.signalingState !== 'stable') return
          try {
            await createAndSendOffer(user_id)
          } catch (e: unknown) {
            setLastError((e as Error)?.message ?? 'Failed to sync active screen share')
          }
        }

        if (e.type === 'Signal') {
          const sigData = (e.data as Record<string, unknown>) ?? {}
          const sender_id = sigData.sender_id as string | undefined
          const signal = sigData.signal as { type?: string; payload?: Record<string, unknown> } | undefined
          if (!sender_id || sender_id === userId) return
          if (!joinedChannelIdRef.current) return
          if (!signal || typeof signal.type !== 'string') return

          let pc = await ensurePeerConnection(sender_id)

          try {
            if (signal.type === 'Offer') {
              const sdp = (signal.payload?.sdp as string | undefined) ?? ''
              // Handle renegotiation glare gracefully instead of hard-resetting peer.
              if (pc.signalingState !== 'stable') {
                try {
                  await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit)
                } catch {
                  closePeer(sender_id)
                  pc = await ensurePeerConnection(sender_id)
                }
              }
              // Try to apply the remote offer. If it fails (e.g. RTP extension
              // remap after rollback), destroy the corrupted PC and retry on
              // a completely fresh connection.
              try {
                await pc.setRemoteDescription({ type: 'offer', sdp })
              } catch {
                closePeer(sender_id)
                pc = await ensurePeerConnection(sender_id)
                await pc.setRemoteDescription({ type: 'offer', sdp })
              }
              await drainIceCandidates(sender_id, pc)
              await ensureLocalAudioSender(sender_id, pc)
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              sendSignal(sender_id, { type: 'Answer', payload: { sdp: answer.sdp ?? '' } })
            } else if (signal.type === 'Answer') {
              const sdp = (signal.payload?.sdp as string | undefined) ?? ''
              // Only set remote answer if we actually have a local offer outstanding.
              if (pc.signalingState === 'have-local-offer') {
                try {
                  await pc.setRemoteDescription({ type: 'answer', sdp })
                  await drainIceCandidates(sender_id, pc)
                } catch {
                  // Answer incompatible (extension remap, codec mismatch, etc.).
                  // Recreate the PC and send a fresh offer to restart negotiation.
                  closePeer(sender_id)
                  const freshPc = await ensurePeerConnection(sender_id)
                  if (freshPc.signalingState === 'stable') {
                    await createAndSendOffer(sender_id)
                  }
                }
              } else {
                // Ignore stray/duplicate answers; they can happen on reconnect/race.
                console.warn('Ignoring remote answer in state', pc.signalingState)
              }
            } else if (signal.type === 'IceCandidate') {
              const c = signal.payload?.candidate as string | undefined
              if (!c) return
              const candidate: RTCIceCandidateInit = {
                candidate: c,
                sdpMid: (signal.payload?.sdp_mid as string | undefined) ?? null,
                sdpMLineIndex: (signal.payload?.sdp_m_line_index as number | undefined) ?? null,
              }
              if (!pc.remoteDescription) {
                queueIceCandidate(sender_id, candidate)
                return
              }
              try {
                await pc.addIceCandidate(candidate)
              } catch {
                // Stale ICE candidate for a previous generation; safe to ignore.
              }
            }
          } catch (e: unknown) {
            setLastError((e as Error)?.message ?? 'Signaling error')
          }
        }

      }) // end queue.enqueue
    })

    return () => unsub()
  }, [closePeer, createAndSendOffer, drainIceCandidates, ensureLocalAudioSender, ensurePeerConnection, playVoiceCue, pushWsPingSample, queueIceCandidate, sendSignal, subscribe, userId])

  // Periodic self-heal: recover from missed signaling/ICE races so every peer in channel keeps audio flowing.
  // Also removes the offerer-only constraint during repair — either side can reoffer to fix stuck peers.
  useEffect(() => {
    if (!joinedChannelId || !userId) return
    const queue = signalingQueueRef.current
    let cancelled = false
    const lastRepairOfferAtMs = new Map<string, number>()

    const heal = async () => {
      if (cancelled) return
      const voice = useAppStore.getState().voiceStates
      const peersInChannel = Object.entries(voice)
        .filter(([uid, cid]) => uid !== userId && cid === joinedChannelId)
        .map(([uid]) => uid)

      const peersSet = new Set(peersInChannel)
      for (const peerId of Array.from(pcsRef.current.keys())) {
        if (!peersSet.has(peerId)) closePeer(peerId)
      }

      for (const peerId of peersInChannel) {
        try {
          let pc = await ensurePeerConnection(peerId)
          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            // Recreate immediately: close the broken PC and build a fresh one
            // in the same cycle instead of waiting for the next heal tick.
            closePeer(peerId)
            pc = await ensurePeerConnection(peerId)
          }
          // During repair, EITHER side can offer (not just the deterministic offerer)
          // because the initial offerer may have missed events or failed.
          if (pc.signalingState !== 'stable') continue

          // ------ check local sender health ------
          // If the sender has no track, an ended track, or a stale track,
          // re-attach the current sendStream track so audio actually flows.
          const audioTx = audioTxRef.current.get(peerId)
          if (audioTx && sendStreamRef.current) {
            const senderTrack = audioTx.sender.track
            const liveSendTrack = sendStreamRef.current.getAudioTracks()[0]
            if (liveSendTrack && (!senderTrack || senderTrack.readyState !== 'live' || senderTrack.id !== liveSendTrack.id)) {
              audioTx.direction = 'sendrecv'
              await audioTx.sender.replaceTrack(liveSendTrack)
              const now = Date.now()
              lastRepairOfferAtMs.set(peerId, now)
              await createAndSendOffer(peerId)
              continue
            }
          }

          // ------ check remote audio health ------
          const remote = remoteStreamsRef.current.get(peerId)
          const hasLiveRemoteAudio = !!remote?.getAudioTracks().some((t) => t.readyState === 'live')
          const shouldRepairMissingAudio =
            pc.connectionState === 'connected' &&
            !hasLiveRemoteAudio &&
            Date.now() - localJoinAtRef.current > 1200

          const shouldOfferByState = pc.connectionState === 'new' || pc.connectionState === 'disconnected'

          // ------ check RTP packet flow ------
          let shouldRepairStalledRtp = false
          if (pc.connectionState === 'connected') {
            try {
              let sent = 0
              let recv = 0
              const stats = await pc.getStats()
              stats.forEach((report: RtcStatEntry) => {
                const kind = report?.kind ?? report?.mediaType
                if (kind !== 'audio') return
                if (report.type === 'outbound-rtp') {
                  const s = Number(report.packetsSent ?? 0)
                  if (Number.isFinite(s)) sent += s
                } else if (report.type === 'inbound-rtp') {
                  const r = Number(report.packetsReceived ?? 0)
                  if (Number.isFinite(r)) recv += r
                }
              })
              const now = Date.now()
              const prev = peerRtpStatsRef.current.get(peerId)
              peerRtpStatsRef.current.set(peerId, { sent, recv, at: now })
              if (prev && now - prev.at >= 1200) {
                const sentDelta = sent - prev.sent
                const recvDelta = recv - prev.recv
                if (sentDelta <= 0 || recvDelta <= 0) {
                  shouldRepairStalledRtp = true
                }
              }
            } catch {
              // ignore stats errors
            }
          }

          if (shouldOfferByState || shouldRepairMissingAudio || shouldRepairStalledRtp) {
            const now = Date.now()
            const lastAt = lastRepairOfferAtMs.get(peerId) ?? 0
            if (now - lastAt < 1500) continue
            lastRepairOfferAtMs.set(peerId, now)
            await createAndSendOffer(peerId, { iceRestart: true })
          }
        } catch (e: unknown) {
          setLastError((e as Error)?.message ?? 'Peer self-heal failed')
        }
      }
    }

    const timer = window.setInterval(() => {
      queue.enqueue(() => heal())
    }, 1500)
    queue.enqueue(() => heal())

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [closePeer, createAndSendOffer, ensurePeerConnection, joinedChannelId, userId])

  useEffect(() => {
    return () => {
      if (inlineMonitorIntervalRef.current != null) {
        window.clearInterval(inlineMonitorIntervalRef.current)
        inlineMonitorIntervalRef.current = null
      }
      const ctx = audioCtxRef.current
      audioCtxRef.current = null
      if (ctx) void ctx.close().catch(() => { })
    }
  }, [])

  // Safety: leaving voice on logout/unmount
  useEffect(() => {
    if (userId) return
    leaveVoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Only expose ping when in call with peers (voice path). When alone, show no number so UI can show "Waiting for peers" instead of misleading WS ping.
  const hasVoicePeers = remoteStreams.size > 0
  const displayIcePing = hasVoicePeers && pingMs != null
  const displayedPing = displayIcePing ? pingMs : (wsPingMs ?? pingMs)
  const displayedPingJitter = displayIcePing ? icePingJitterMs : wsPingJitterMs
  const pingMsForUi = hasVoicePeers ? displayedPing : null
  const pingJitterForUi = hasVoicePeers ? displayedPingJitter : null

  const state: UseWebRTCVoiceState = {
    joinedChannelId,
    isJoining,
    localStream,
    screenStream,
    isScreenSharing: !!screenStream,
    cameraStream,
    remoteStreams,
    pingMs: pingMsForUi,
    lastError,
    diagnostics: {
      enabled: true,
      voiceMode,
      packetLossPct,
      jitterMs,
      pingJitterMs: pingJitterForUi,
    },
  }

  return { state, joinVoice, leaveVoice, startScreenShare, stopScreenShare, startCamera, stopCamera, setVoiceControls, playVoiceCue }
}

