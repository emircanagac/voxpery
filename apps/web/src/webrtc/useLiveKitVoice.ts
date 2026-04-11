import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LocalAudioTrack,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client'
import { webrtcApi } from '../api'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { useSocketStore } from '../stores/socket'
import { startAudioLevelMonitor } from './audioLevelMonitor'
import { useAudioEngine } from './hooks/useAudioEngine'
import { useLocalMedia } from './hooks/useLocalMedia'
import { useVoiceActivity } from './hooks/useVoiceActivity'
import { useWebrtcDiagnostics } from './hooks/useWebrtcDiagnostics'
import { getStoredVoiceInputDeviceId, VOICE_SETTINGS_CHANGED_EVENT } from '../voiceDevices'

type PeerId = string

export interface UseLiveKitVoiceState {
  joinedChannelId: string | null
  isJoining: boolean
  localStream: MediaStream | null
  screenStream: MediaStream | null
  isScreenSharing: boolean
  cameraStream: MediaStream | null
  remoteStreams: Map<PeerId, MediaStream>
  remoteScreenTrackIds: Set<string>
  pingMs: number | null
  lastError: string | null
  livekit: {
    roomState: string
    participants: number
    remoteStreams: number
  }
  diagnostics: {
    enabled: boolean
    voiceMode: 'voice_activity' | 'push_to_talk'
    wsPingMs: number | null
    rtcPingMs: number | null
    packetLossPct: number | null
    jitterMs: number | null
    pingJitterMs: number | null
  }
}

export function useLiveKitVoice() {
  const { user, token } = useAuthStore()
  const { send, subscribe, isConnected, onReconnect } = useSocketStore()
  const userId = user?.id ?? null

  const roomRef = useRef<Room | null>(null)
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null)
  const localCameraTrackRef = useRef<MediaStreamTrack | null>(null)
  const localScreenTracksRef = useRef<MediaStreamTrack[]>([])

  const rawMicTrackRef = useRef<MediaStreamTrack | null>(null)
  const inputGainNodeRef = useRef<GainNode | null>(null)
  const gateCancelRef = useRef<(() => void) | null>(null)
  const vadStreamRef = useRef<MediaStream | null>(null)

  const remoteStreamsRef = useRef<Map<PeerId, MediaStream>>(new Map())
  const remoteMonitorCleanupsRef = useRef<Map<PeerId, () => void>>(new Map())
  const joinedChannelIdRef = useRef<string | null>(null)
  const desiredMicMutedRef = useRef(false)
  const activeInputDeviceIdRef = useRef(getStoredVoiceInputDeviceId())

  const [joinedChannelId, setJoinedChannelId] = useState<string | null>(null)
  const isJoiningRef = useRef(false)
  const [isJoining, setIsJoining] = useState(false)

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const remoteScreenTrackIdsRef = useRef<Set<string>>(new Set())

  const [remoteStreamsVersion, setRemoteStreamsVersion] = useState(0)
  const [remoteScreenTrackIds, setRemoteScreenTrackIds] = useState<Set<string>>(new Set())
  const bumpRemote = () => {
    setRemoteStreamsVersion((v) => v + 1)
    setRemoteScreenTrackIds(new Set(remoteScreenTrackIdsRef.current))
  }

  const [roomState, setRoomState] = useState('disconnected')
  const [participantCount, setParticipantCount] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)

  const remoteStreams = useMemo(() => {
    void remoteStreamsVersion
    return new Map(remoteStreamsRef.current)
  }, [remoteStreamsVersion])

  const { getAudioContext, playVoiceCue, disconnectAudioContext, buildMicSendTrack, setRnnoiseEnabled, destroyRnnoise } = useAudioEngine()
  const { applyLocalMicSettings, getMicrophoneStream, getCameraStream, getScreenStream, getScreenShareEncoding, getInputVolumeFactor, cleanupLocalMedia } = useLocalMedia()

  const updateRoomStats = useCallback(() => {
    const room = roomRef.current
    if (!room) {
      setRoomState('disconnected')
      setParticipantCount(0)
      return
    }
    setRoomState(String(room.state))
    setParticipantCount(room.numParticipants ?? 0)
  }, [])

  const setLocalMicMuted = useCallback(async (muted: boolean) => {
    desiredMicMutedRef.current = muted
    const track = localAudioTrackRef.current
    const publishedMediaTrack = track?.mediaStreamTrack
    const rawTrack = rawMicTrackRef.current

    if (muted) {
      try {
        if (track) await track.mute()
      } catch {
        // ignore and continue hard mute via track.enabled
      }
      if (publishedMediaTrack) publishedMediaTrack.enabled = false
      if (rawTrack) rawTrack.enabled = false
      return
    }

    if (publishedMediaTrack) publishedMediaTrack.enabled = true
    if (rawTrack) rawTrack.enabled = true
    try {
      if (track) await track.unmute()
    } catch {
      // ignore; media track has already been re-enabled
    }
  }, [])

  const { voiceMode, startLocalSpeakingMonitor, stopLocalSpeakingMonitor } = useVoiceActivity({
    userId,
    joinedChannelId,
    localStream,
    getAudioContext,
    setLocalMicMuted,
    localAudioTrackRef
  })

  const { pingMs, wsPingMs, rtcPingMs, packetLossPct, jitterMs, pingJitterMs } = useWebrtcDiagnostics({
    joinedChannelId,
    isConnected,
    roomRef,
    roomState,
    remoteStreamsVersion,
    send,
    subscribe
  })

  const refreshLocalStreams = useCallback(() => {
    const room = roomRef.current
    if (!room) return

    const audioPub = room.localParticipant.getTrackPublication(Track.Source.Microphone)
    const audioTrack = audioPub?.track
    if (audioTrack && audioTrack.kind === Track.Kind.Audio) {
      const stream = new MediaStream([audioTrack.mediaStreamTrack])
      setLocalStream(stream)
      localAudioTrackRef.current = audioTrack as LocalAudioTrack
      audioTrack.mediaStreamTrack.enabled = !desiredMicMutedRef.current
    } else {
      setLocalStream(null)
      localAudioTrackRef.current = null
    }

    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera)
    const camTrack = camPub?.track
    if (camTrack && camTrack.kind === Track.Kind.Video) {
      localCameraTrackRef.current = camTrack.mediaStreamTrack
      setCameraStream(new MediaStream([camTrack.mediaStreamTrack]))
    } else {
      localCameraTrackRef.current = null
      setCameraStream(null)
    }

    const screenPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
    const screenTrack = screenPub?.track
    if (screenTrack && screenTrack.kind === Track.Kind.Video) {
      setScreenStream(new MediaStream([screenTrack.mediaStreamTrack]))
    } else {
      setScreenStream(null)
    }
  }, [])

  const switchMicrophoneDevice = useCallback(async () => {
    const room = roomRef.current
    const publishedTrack = localAudioTrackRef.current
    if (!room || !publishedTrack) return

    const nextDeviceId = getStoredVoiceInputDeviceId()
    const previousTrack = publishedTrack
    const previousGateCancel = gateCancelRef.current
    let nextGateCancel: (() => void) | null = null

    try {
      const stream = await getMicrophoneStream(true)
      const noiseSuppressionEnabled = localStorage.getItem('voxpery-settings-noise-suppression') !== '0'
      const { track: nextTrack, vadStream, cancelGate } = await buildMicSendTrack(
        stream,
        getInputVolumeFactor(),
        desiredMicMutedRef.current,
        rawMicTrackRef,
        inputGainNodeRef,
        noiseSuppressionEnabled,
      )
      nextGateCancel = cancelGate

      await room.localParticipant.unpublishTrack(previousTrack)
      previousTrack.stop()

      const publication = await room.localParticipant.publishTrack(nextTrack, { source: Track.Source.Microphone })
      previousGateCancel?.()
      gateCancelRef.current = nextGateCancel
      localAudioTrackRef.current = publication.track as LocalAudioTrack
      vadStreamRef.current = vadStream
      activeInputDeviceIdRef.current = nextDeviceId

      refreshLocalStreams()
      startLocalSpeakingMonitor(vadStreamRef.current)
      await setLocalMicMuted(desiredMicMutedRef.current)
    } catch (error) {
      nextGateCancel?.()
      gateCancelRef.current = previousGateCancel ?? null
      setLastError(error instanceof Error ? error.message : 'Could not switch microphone device')
    }
  }, [buildMicSendTrack, getInputVolumeFactor, getMicrophoneStream, refreshLocalStreams, setLocalMicMuted, startLocalSpeakingMonitor])

  const closePeer = useCallback((peerId: PeerId) => {
    remoteMonitorCleanupsRef.current.get(peerId)?.()
    remoteMonitorCleanupsRef.current.delete(peerId)
    const current = remoteStreamsRef.current.get(peerId)
    if (current) {
      remoteStreamsRef.current.delete(peerId)
      bumpRemote()
    }
    const store = useAppStore.getState()
    store.setVoiceSpeaking(
      store.voiceSpeakingUserIds.filter((id) => id !== peerId),
      store.voiceLocalSpeaking
    )
    const existingControl = store.voiceControls[peerId]
    store.setVoiceCamera(peerId, false)
    if (existingControl) {
      store.setVoiceControl(peerId, !!existingControl.muted, !!existingControl.deafened, false)
    }
  }, [])

  const syncParticipantMediaState = useCallback((participant: RemoteParticipant) => {
    let hasCamera = false
    let hasScreenShare = false

    participant.trackPublications.forEach((pub) => {
      if (!pub.track || !pub.isSubscribed || pub.track.kind !== Track.Kind.Video) return
      if (pub.isMuted) return
      const mediaTrack = pub.track.mediaStreamTrack
      if (!mediaTrack || mediaTrack.readyState !== 'live' || mediaTrack.muted) return
      if (pub.source === Track.Source.Camera) hasCamera = true
      if (pub.source === Track.Source.ScreenShare) hasScreenShare = true
    })

    const store = useAppStore.getState()
    const current = store.voiceControls[participant.identity]
    store.setVoiceCamera(participant.identity, hasCamera)
    store.setVoiceControl(participant.identity, !!current?.muted, !!current?.deafened, hasScreenShare)
  }, [])

  const joinVoice = useCallback(async (channelId: string, options?: { preflightStream?: MediaStream }) => {
    if (!isConnected) throw new Error('WebSocket is not connected')
    if (!userId) throw new Error('Not authenticated')
    if (joinedChannelIdRef.current === channelId) return
    if (isJoiningRef.current) {
      console.warn('[useLiveKitVoice] Already joining a channel, ignoring request.')
      return
    }

    setLastError(null)
    isJoiningRef.current = true
    setIsJoining(true)
    let preflightStream: MediaStream | null = options?.preflightStream ?? null
    let micPublished = false

    try {
      if (!preflightStream) {
        preflightStream = await getMicrophoneStream()
      }
      activeInputDeviceIdRef.current = getStoredVoiceInputDeviceId()

      const rawMicTrack = preflightStream.getAudioTracks()[0]
      if (!rawMicTrack) throw new Error('No microphone track available')

      const audioContext = getAudioContext()
      if (!audioContext) throw new Error('Audio context required for voice processors')
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      const noiseSuppressionEnabled = localStorage.getItem('voxpery-settings-noise-suppression') !== '0'

      // Always keep echo cancellation & auto gain from browser; noise suppression
      // is handled by RNNoise when enabled, so we leave browser NS off.
      try {
        await rawMicTrack.applyConstraints({
          noiseSuppression: false,
          echoCancellation: true,
          autoGainControl: true,
        })
      } catch { /* ignore unsupported constraints */ }

      // Build the processed audio pipeline: mic → RNNoise (if enabled) → volume gain → publishTrack
      gateCancelRef.current?.()
      gateCancelRef.current = null
      const { track: publishTrack, vadStream, cancelGate } = await buildMicSendTrack(
        preflightStream,
        getInputVolumeFactor(),
        desiredMicMutedRef.current,
        rawMicTrackRef,
        inputGainNodeRef,
        noiseSuppressionEnabled,
      )
      gateCancelRef.current = cancelGate

      // Keep vadStream ref so we can pass it to the speaking monitor after room connect
      vadStreamRef.current = vadStream

      const { ws_url, token: lkToken } = await webrtcApi.getLivekitToken(channelId, token ?? null)

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          screenShareEncoding: getScreenShareEncoding(),
          screenShareSimulcastLayers: [],
          videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
        },
      })
      roomRef.current = room

      const iceServers: RTCIceServer[] = [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] },
      ]

      // Optional: Add TURN servers only if configured in .env
      try {
        const turnCreds = await webrtcApi.getTurnCredentials(token ?? null)
        if (turnCreds.urls && turnCreds.urls.length > 0) {
          iceServers.push({
            urls: turnCreds.urls,
            username: turnCreds.username,
            credential: turnCreds.credential,
          })
        }
      } catch {
        // Ignore TURN errors in dev
      }

      room.on(RoomEvent.TrackPublished, (publication) => {
        if (!publication.isSubscribed) publication.setSubscribed(true)
      })

      room
        .on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
          const peerId = participant.identity

          const combined = remoteStreamsRef.current.get(peerId) ?? new MediaStream()
          const mediaTrack = track.mediaStreamTrack

          if (pub.source === Track.Source.ScreenShare) {
            Object.defineProperty(mediaTrack, '__voxpery_isScreenShare', { value: true, writable: true, configurable: true })
            remoteScreenTrackIdsRef.current.add(mediaTrack.id)
          } else if (pub.source === Track.Source.Camera) {
            Object.defineProperty(mediaTrack, '__voxpery_isCamera', { value: true, writable: true, configurable: true })
            remoteScreenTrackIdsRef.current.delete(mediaTrack.id)
          }

          mediaTrack.onmute = () => { syncParticipantMediaState(participant); bumpRemote() }
          mediaTrack.onunmute = () => { syncParticipantMediaState(participant); bumpRemote() }
          mediaTrack.onended = () => { syncParticipantMediaState(participant); bumpRemote() }

          if (!combined.getTracks().some((t) => t.id === mediaTrack.id)) {
            combined.addTrack(mediaTrack)
          }
          remoteStreamsRef.current.set(peerId, combined)
          bumpRemote()

          if (track.kind === Track.Kind.Audio && !remoteMonitorCleanupsRef.current.has(peerId)) {
            const cleanup = startAudioLevelMonitor(combined, (speaking) => {
              const store = useAppStore.getState()
              const next = new Set(store.voiceSpeakingUserIds)
              if (speaking) next.add(peerId)
              else next.delete(peerId)
              store.setVoiceSpeaking(Array.from(next), store.voiceLocalSpeaking)
            }, { forRemote: true })
            remoteMonitorCleanupsRef.current.set(peerId, cleanup)
          }
          syncParticipantMediaState(participant)
          updateRoomStats()
        })
        .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
          const peerId = participant.identity
          const stream = remoteStreamsRef.current.get(peerId)
          if (!stream) return
          const mediaTrack = track.mediaStreamTrack
          const existing = stream.getTracks().find((t) => t.id === mediaTrack.id)
          if (existing) {
            stream.removeTrack(existing)
            remoteScreenTrackIdsRef.current.delete(existing.id)
          }
          if (stream.getTracks().length === 0) closePeer(peerId)
          else bumpRemote()

          syncParticipantMediaState(participant)
          updateRoomStats()
        })
        .on(RoomEvent.ParticipantDisconnected, (participant) => {
          closePeer(participant.identity)
          updateRoomStats()
          playVoiceCue('leave')
        })
        .on(RoomEvent.ParticipantConnected, (participant) => {
          participant.trackPublications.forEach((publication) => {
            if (!publication.isSubscribed) publication.setSubscribed(true)
          })
          syncParticipantMediaState(participant)
          updateRoomStats()
          playVoiceCue('join')
        })
        .on(RoomEvent.Reconnecting, () => {
          console.warn('[useLiveKitVoice] LiveKit Room reconnecting...')
          updateRoomStats()
        })
        .on(RoomEvent.Reconnected, () => {
          updateRoomStats()
          refreshLocalStreams()
          // Re-subscribe to all existing remote participants' tracks
          const currentRoom = roomRef.current
          if (currentRoom) {
            currentRoom.remoteParticipants.forEach((participant) => {
              participant.trackPublications.forEach((publication) => {
                if (!publication.isSubscribed) publication.setSubscribed(true)
              })
              syncParticipantMediaState(participant)
            })
          }
        })
        .on(RoomEvent.Disconnected, (reason) => {
          if (!import.meta.env.PROD) {
            console.warn('[useLiveKitVoice] LiveKit Room disconnected, reason:', reason)
          }
          updateRoomStats()
          // If the room disconnects unexpectedly, clean up local state
          // but do NOT call leaveVoice() — the WS resync effect handles re-join
        })

      const connectPromise = room.connect(ws_url, lkToken, { rtcConfig: { iceServers } })
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LiveKit connection timeout after 15 seconds')), 15000)
      )

      await Promise.race([connectPromise, timeoutPromise])

      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (!publication.isSubscribed) publication.setSubscribed(true)
        })
        syncParticipantMediaState(participant)
      })
      updateRoomStats()

      // Publish the track directly to LiveKit.
      const pub = await room.localParticipant.publishTrack(publishTrack, { source: Track.Source.Microphone })

      micPublished = true
      localAudioTrackRef.current = pub.track as LocalAudioTrack
      await setLocalMicMuted(desiredMicMutedRef.current)

      refreshLocalStreams()
      // Feed the speaking monitor with the post-RNNoise signal so the
      // indicator only lights up when actual voice passes through the
      // denoiser — background noise (claps, keyboard, fan) won't trigger it.
      startLocalSpeakingMonitor(vadStreamRef.current)

      if (voiceMode === 'push_to_talk') {
        await setLocalMicMuted(true)
      }

      joinedChannelIdRef.current = channelId
      send('JoinVoice', { channel_id: channelId })
      setJoinedChannelId(channelId)
      useAppStore.getState().setJoinedVoiceChannelId(channelId)
      send('SetVoiceControl', { muted: desiredMicMutedRef.current, deafened: false, screen_sharing: false, camera_on: false })
      playVoiceCue('join')
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? 'Failed to join voice'
      setLastError(msg)
      if (!micPublished) cleanupLocalMedia()
      throw e
    } finally {
      isJoiningRef.current = false
      setIsJoining(false)
    }
    }, [buildMicSendTrack, cleanupLocalMedia, closePeer, getAudioContext, getMicrophoneStream, getScreenShareEncoding, getInputVolumeFactor, isConnected, playVoiceCue, refreshLocalStreams, send, setLocalMicMuted, startLocalSpeakingMonitor, syncParticipantMediaState, token, updateRoomStats, userId, voiceMode])

    const leaveVoice = useCallback((options?: { skipLeaveSound?: boolean }) => {
    isJoiningRef.current = false
    if (joinedChannelIdRef.current && !options?.skipLeaveSound) playVoiceCue('leave')
    setLastError(null)
    send('LeaveVoice', null)
    joinedChannelIdRef.current = null
    setJoinedChannelId(null)
    useAppStore.getState().setJoinedVoiceChannelId(null)
    if (userId) useAppStore.getState().setVoiceCamera(userId, false)
    remoteMonitorCleanupsRef.current.forEach((c) => c())
    remoteMonitorCleanupsRef.current.clear()

    stopLocalSpeakingMonitor()
    gateCancelRef.current?.()
    gateCancelRef.current = null

    const room = roomRef.current
    roomRef.current = null
    localAudioTrackRef.current?.stop()
    localAudioTrackRef.current = null
    destroyRnnoise()
    rawMicTrackRef.current?.stop()
    rawMicTrackRef.current = null
    vadStreamRef.current = null
    inputGainNodeRef.current = null
    localCameraTrackRef.current = null
    localScreenTracksRef.current = []

    if (room) room.disconnect()

    setRoomState('disconnected')
    setParticipantCount(0)

    remoteStreamsRef.current.clear()
    bumpRemote()
    cleanupLocalMedia()

    setLocalStream(null)
    setScreenStream(null)
    setCameraStream(null)
  }, [cleanupLocalMedia, destroyRnnoise, playVoiceCue, send, stopLocalSpeakingMonitor, userId])

  const stopScreenShare = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    const pubs = room.localParticipant.trackPublications
    pubs.forEach((pub) => {
      if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) {
        if (pub.track) room.localParticipant.unpublishTrack(pub.track)
      }
    })
    localScreenTracksRef.current.forEach((t) => t.stop())
    localScreenTracksRef.current = []
    refreshLocalStreams()
    const control = useAppStore.getState().voiceControls[userId ?? '']
    send('SetVoiceControl', { muted: !!control?.muted, deafened: !!control?.deafened, screen_sharing: false, camera_on: !!control?.cameraOn })
  }, [refreshLocalStreams, send, userId])

  const startScreenShare = useCallback(async () => {
    const room = roomRef.current
    if (!room) throw new Error('Join a voice channel before sharing your screen')
    stopScreenShare()

    const stream = await getScreenStream()
    const tracks = stream.getTracks()
    localScreenTracksRef.current = tracks

    for (const track of tracks) {
      const source = track.kind === 'audio' ? Track.Source.ScreenShareAudio : Track.Source.ScreenShare
      const screenVideo = track.kind === 'video' ? getScreenShareEncoding(track) : undefined
      if (track.kind === 'video' && screenVideo && 'contentHint' in track) {
        try { track.contentHint = screenVideo.contentHint } catch { /* ignore */ }
      }
      await room.localParticipant.publishTrack(track, {
        source,
        // Screen share tracks use screenShareEncoding (not videoEncoding)
        screenShareEncoding: screenVideo
          ? { maxBitrate: screenVideo.maxBitrate, maxFramerate: screenVideo.maxFramerate }
          : undefined,
        simulcast: false,  // Screen share: full quality, no simulcast layers
      })
    }
    const videoTrack = stream.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.onended = () => {
        const currentRoom = roomRef.current
        if (!currentRoom) return
        currentRoom.localParticipant.trackPublications.forEach((pub) => {
          if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) {
            if (pub.track) currentRoom.localParticipant.unpublishTrack(pub.track)
          }
        })
        localScreenTracksRef.current.forEach((t) => t.stop())
        localScreenTracksRef.current = []
        refreshLocalStreams()
        const localControl = useAppStore.getState().voiceControls[userId ?? '']
        send('SetVoiceControl', {
          muted: !!localControl?.muted,
          deafened: !!localControl?.deafened,
          screen_sharing: false,
          camera_on: !!localControl?.cameraOn,
        })
      }
    }
    refreshLocalStreams()
    const control = useAppStore.getState().voiceControls[userId ?? '']
    send('SetVoiceControl', { muted: !!control?.muted, deafened: !!control?.deafened, screen_sharing: true, camera_on: !!control?.cameraOn })
  }, [getScreenShareEncoding, getScreenStream, refreshLocalStreams, send, stopScreenShare, userId])

  const startCamera = useCallback(async () => {
    const room = roomRef.current
    if (!room) throw new Error('Join a voice channel before turning on camera')
    if (cameraStream) return
    const stream = await getCameraStream()
    const track = stream.getVideoTracks()[0]
    if (!track) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('No camera video track available')
    }
    localCameraTrackRef.current = track
    if ('contentHint' in track) {
      try { track.contentHint = 'motion' } catch { /* ignore */ }
    }
    try {
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.Camera,
        videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
      })
    } catch (err) {
      track.stop()
      throw err
    }
    refreshLocalStreams()
    if (userId) {
      useAppStore.getState().setVoiceCamera(userId, true)
      const c = useAppStore.getState().voiceControls[userId]
      send('SetVoiceControl', { muted: !!c?.muted, deafened: !!c?.deafened, screen_sharing: !!c?.screenSharing, camera_on: true })
    }
  }, [cameraStream, getCameraStream, refreshLocalStreams, send, userId])

  const stopCamera = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    const pubs = room.localParticipant.trackPublications
    pubs.forEach((pub) => {
      if (pub.source === Track.Source.Camera) {
        if (pub.track) room.localParticipant.unpublishTrack(pub.track)
      }
    })
    localCameraTrackRef.current?.stop()
    localCameraTrackRef.current = null
    refreshLocalStreams()
    if (userId) {
      useAppStore.getState().setVoiceCamera(userId, false)
      const c = useAppStore.getState().voiceControls[userId]
      send('SetVoiceControl', { muted: !!c?.muted, deafened: !!c?.deafened, screen_sharing: !!c?.screenSharing, camera_on: false })
    }
  }, [refreshLocalStreams, send, userId])

  const setVoiceControls = useCallback(async (muted: boolean, deafened: boolean, screenSharing: boolean, cameraOn?: boolean) => {
    const store = useAppStore.getState()
    const camera = cameraOn ?? store.voiceControls[userId ?? '']?.cameraOn ?? false
    send('SetVoiceControl', { muted, deafened, screen_sharing: screenSharing, camera_on: camera })
    await setLocalMicMuted(muted || deafened)
  }, [send, setLocalMicMuted, userId])

  const setMemberVoiceControls = useCallback(
    (targetUserId: string, next: { muted?: boolean; deafened?: boolean }) => {
      const store = useAppStore.getState()
      const current = store.voiceControls[targetUserId] ?? {
        muted: false,
        deafened: false,
        serverMuted: false,
        serverDeafened: false,
        screenSharing: false,
        cameraOn: false,
      }
      send('SetVoiceControl', {
        target_user_id: targetUserId,
        muted: next.muted ?? current.serverMuted,
        deafened: next.deafened ?? current.serverDeafened,
        screen_sharing: !!current.screenSharing,
        camera_on: !!current.cameraOn,
      })
    },
    [send],
  )

  // Track the last known noise suppression setting so we only react to actual changes.
  const lastNsEnabledRef = useRef<boolean>(
    localStorage.getItem('voxpery-settings-noise-suppression') !== '0'
  )

  useEffect(() => {
    const onSettingsChanged = () => {
      const rawTrack = rawMicTrackRef.current
      void applyLocalMicSettings(rawTrack)
      const gainNode = inputGainNodeRef.current
      if (gainNode) {
        gainNode.gain.value = getInputVolumeFactor()
      }

      const nextInputDeviceId = getStoredVoiceInputDeviceId()
      if (nextInputDeviceId !== activeInputDeviceIdRef.current && joinedChannelIdRef.current) {
        void switchMicrophoneDevice()
      }

      // ── Live RNNoise hot-swap ──
      const track = localAudioTrackRef.current
      if (!track || !joinedChannelIdRef.current) return

      const nowEnabled = localStorage.getItem('voxpery-settings-noise-suppression') !== '0'
      const wasEnabled = lastNsEnabledRef.current
      if (nowEnabled === wasEnabled) return
      lastNsEnabledRef.current = nowEnabled

      setRnnoiseEnabled(nowEnabled)
    }
    window.addEventListener(VOICE_SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(VOICE_SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [applyLocalMicSettings, getInputVolumeFactor, setRnnoiseEnabled, switchMicrophoneDevice])

  useEffect(() => {
    return () => {
      destroyRnnoise()
      disconnectAudioContext()
    }
  }, [destroyRnnoise, disconnectAudioContext])

  // F5/Reload handling: If we are in a voice channel, aggressively tell the backend we are leaving
  // before the websocket is destroyed. This prevents ghost users from lingering in the UI.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const channelId = joinedChannelIdRef.current
      if (channelId) {
        send('LeaveVoice', null)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [send])

  useEffect(() => {
    if (userId) return
    leaveVoice()
  }, [leaveVoice, userId])

  // ── WS reconnect → re-sync voice state with backend ──
  // When the WebSocket drops and reconnects, the backend clears our voice_sessions
  // entry (disconnect cleanup). The LiveKit Room may still be alive. We must
  // re-send JoinVoice + SetVoiceControl so other users see us again.
  useEffect(() => {
    const unsub = onReconnect(() => {
      const channelId = joinedChannelIdRef.current
      const room = roomRef.current
      if (!channelId || !room || room.state === 'disconnected') return

      send('JoinVoice', { channel_id: channelId })

      // Re-send current control state
      const control = userId ? useAppStore.getState().voiceControls[userId] : null
      send('SetVoiceControl', {
        muted: !!control?.muted,
        deafened: !!control?.deafened,
        screen_sharing: !!control?.screenSharing,
        camera_on: !!control?.cameraOn,
      })
    })
    return unsub
  }, [onReconnect, send, userId])

  const state: UseLiveKitVoiceState = {
    joinedChannelId,
    isJoining,
    localStream,
    screenStream,
    isScreenSharing: !!screenStream,
    cameraStream,
    remoteStreams,
    remoteScreenTrackIds,
    pingMs,
    lastError,
    livekit: {
      roomState,
      participants: participantCount,
      remoteStreams: remoteStreams.size,
    },
    diagnostics: {
      enabled: true,
      voiceMode,
      wsPingMs,
      rtcPingMs,
      packetLossPct,
      jitterMs,
      pingJitterMs,
    },
  }

  return {
    state,
    joinVoice,
    leaveVoice,
    startScreenShare,
    stopScreenShare,
    startCamera,
    stopCamera,
    setVoiceControls,
    setMemberVoiceControls,
    playVoiceCue,
  }
}
