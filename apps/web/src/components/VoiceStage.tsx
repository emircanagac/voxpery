import type { UseLiveKitVoiceState } from '../webrtc/useLiveKitVoice'
import { attachRemoteVideoElement } from '../webrtc/livekitVideoAttachment'
import type { User } from '../types'
import type { MemberInfo } from '../api/contracts'
import type { RemoteMediaKind } from '../webrtc/remoteMediaControls'
import { useEffect, useRef, type CSSProperties, type Dispatch, type JSX, type MouseEvent as ReactMouseEvent, type SetStateAction } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, Volume2, VolumeX, Maximize2, Minimize2, LayoutGrid, PanelsTopLeft, SwitchCamera as SwitchCameraIcon, Users } from 'lucide-react'
import VoiceMediaPreview from './VoiceMediaPreview'
import { resolveAvatarUrl } from '../api'
import { DEFAULT_REMOTE_PLAYBACK_VOLUME, getRemotePlaybackVolume, normalizeRemoteScreenPlaybackVolume, readRemotePlaybackVolumes, readPreviousScreenPlaybackVolume, remotePlaybackVolumeKey, REMOTE_PLAYBACK_VOLUME_CHANGED_EVENT, writePreviousScreenPlaybackVolume, writeRemotePlaybackVolumes } from '../webrtc/remotePlaybackVolume'

export type RemoteMediaPlaceholder = {
  key: string
  peerId: string
  kind: RemoteMediaKind
  label: string
}

/** Double-clicking the focused stream toggles fullscreen, like the fullscreen button. */
function toggleTileFullscreen(event: ReactMouseEvent<HTMLElement>) {
  if ((event.target as HTMLElement).closest('button, input')) return
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => { })
  else void event.currentTarget.requestFullscreen?.().catch(() => { })
}

export function RemoteVideoTrack({ track }: { track: MediaStreamTrack }) {
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

interface VoiceStageProps {
  attachCameraPreviewElement: (video: HTMLVideoElement | null) => void
  attachScreenPreviewElement: (video: HTMLVideoElement | null) => void
  avatarParticipants: MemberInfo[]
  channelParticipants: MemberInfo[]
  deafened: boolean
  effectiveDeafened: boolean
  fullscreenTileKey: string | null
  getScreenShareViewerIds: (publisherId: string) => string[]
  handleSwitchCamera: () => Promise<void>
  handleTileMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => void
  handleTileMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void
  hasTheaterFocus: boolean
  isMobileViewport: boolean
  isRemoteMediaHidden: (peerId: string, kind: RemoteMediaKind) => boolean
  isScreenPreviewPaused: boolean
  isSwitchingCamera: boolean
  localFallbackTileCount: 0 | 1
  localInitial: string
  localParticipantMissing: boolean
  mediaOwnerAvatar: (peerId: string | null, compact?: boolean) => JSX.Element
  members: MemberInfo[]
  muted: boolean
  peerVolumeByUserId: Record<string, number>
  remoteMediaPlaceholdersToRender: RemoteMediaPlaceholder[]
  remoteScreenSharePlaceholders: string[]
  remoteShareOwner: (peerId: string) => string
  remoteVideoTrackEntries: { peerId: string; track: MediaStreamTrack; label: string; kind: RemoteMediaKind; }[]
  resolvePeerVolumeKey: (peerId: string) => string
  screenTileFrameStyle: (key: string) => CSSProperties | undefined
  serverDeafened: boolean
  serverMuted: boolean
  setPausedPreviewStream: Dispatch<SetStateAction<MediaStream | null>>
  setPeerVolumeByUserId: Dispatch<SetStateAction<Record<string, number>>>
  setRemoteMediaHidden: (peerId: string, kind: RemoteMediaKind, hidden: boolean, label?: string) => void
  setRemoteMediaSubscribed: (peerId: string, kind: RemoteMediaKind, subscribed: boolean) => void
  setStageElement: Dispatch<SetStateAction<HTMLDivElement | null>>
  setTheaterStreamKey: Dispatch<SetStateAction<string | null>>
  setTheaterStripVisible: Dispatch<SetStateAction<boolean>>
  showLocalFallbackTile: boolean
  showTheaterStrip: boolean
  showVoiceStage: boolean
  stageColumns: number
  stageDensity: "dense" | "crowded" | "standard"
  stageStyle: CSSProperties | undefined
  state: UseLiveKitVoiceState
  stripHiddenCount: number
  theaterStreamKey: string | null
  theaterStripVisible: boolean
  toggleTheaterStream: (streamKey: string) => void
  totalStageTiles: number
  user: User | null
  voiceControls: Record<string, { muted: boolean; deafened: boolean; serverMuted: boolean; serverDeafened: boolean; screenSharing: boolean; cameraOn: boolean; }>
  voiceLocalSpeaking: boolean
  voiceSpeakingUserIds: string[]
  watchedRemoteScreenPeerIds: Set<string>
}

export default function VoiceStage({
  attachCameraPreviewElement,
  attachScreenPreviewElement,
  avatarParticipants,
  channelParticipants,
  deafened,
  effectiveDeafened,
  fullscreenTileKey,
  getScreenShareViewerIds,
  handleSwitchCamera,
  handleTileMouseLeave,
  handleTileMouseMove,
  hasTheaterFocus,
  isMobileViewport,
  isRemoteMediaHidden,
  isScreenPreviewPaused,
  isSwitchingCamera,
  localFallbackTileCount,
  localInitial,
  localParticipantMissing,
  mediaOwnerAvatar,
  members,
  muted,
  peerVolumeByUserId,
  remoteMediaPlaceholdersToRender,
  remoteScreenSharePlaceholders,
  remoteShareOwner,
  remoteVideoTrackEntries,
  resolvePeerVolumeKey,
  screenTileFrameStyle,
  serverDeafened,
  serverMuted,
  setPausedPreviewStream,
  setPeerVolumeByUserId,
  setRemoteMediaHidden,
  setRemoteMediaSubscribed,
  setStageElement,
  setTheaterStreamKey,
  setTheaterStripVisible,
  showLocalFallbackTile,
  showTheaterStrip,
  showVoiceStage,
  stageColumns,
  stageDensity,
  stageStyle,
  state,
  stripHiddenCount,
  theaterStreamKey,
  theaterStripVisible,
  toggleTheaterStream,
  totalStageTiles,
  user,
  voiceControls,
  voiceLocalSpeaking,
  voiceSpeakingUserIds,
  watchedRemoteScreenPeerIds,
}: VoiceStageProps) {
  return (
    <>
      {showVoiceStage && (
        <div
          ref={setStageElement}
          className={`screen-share-stage${hasTheaterFocus ? ' screen-share-stage--theater' : ''}${showTheaterStrip ? ' screen-share-stage--strip' : ''}`}
          data-stage-density={stageDensity}
          data-stage-columns={stageColumns}
          data-participant-count={channelParticipants.length + (localParticipantMissing ? 1 : 0)}
          data-media-tile-count={totalStageTiles - avatarParticipants.length - localFallbackTileCount}
          data-theater-mode={hasTheaterFocus ? 'true' : undefined}
          style={stageStyle}
        >
          {avatarParticipants.map((p) => {
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
                <div className={`voice-stage-name${pSpeaking ? ' is-speaking' : ''}`} title={p.username}>{p.username}</div>
                <div className="voice-stage-sub"><Users size={12} />In voice</div>
              </div>
            )
          })}
          {showLocalFallbackTile && (
            <div key="participant-local-fallback" className="voice-stage-tile">
              <div className={`voice-stage-avatar${voiceLocalSpeaking && !(muted || deafened || serverMuted || serverDeafened) ? ' is-speaking' : ''}`}>
                {user?.avatar_url ? <img src={resolveAvatarUrl(user.avatar_url) ?? ''} alt="" /> : localInitial}
              </div>
              <div className={`voice-stage-name${voiceLocalSpeaking && !(muted || deafened || serverMuted || serverDeafened) ? ' is-speaking' : ''}`} title={user?.username ?? 'You'}>{user?.username ?? 'You'}</div>
              <div className="voice-stage-sub"><Users size={12} />In voice</div>
            </div>
          )}
          {state.cameraStream && (
            <VoiceMediaPreview
              kind="camera"
              className={`voice-stage-share-tile camera-preview${theaterStreamKey === 'local-camera' ? ' is-theater-focused' : ''}${voiceLocalSpeaking && !(muted || deafened || serverMuted || serverDeafened) ? ' is-speaking' : ''}`}
              data-fullscreen-key="camera"
              onMouseMove={handleTileMouseMove}
              onMouseLeave={handleTileMouseLeave}
              onDoubleClick={theaterStreamKey === 'local-camera' ? toggleTileFullscreen : undefined}
            >
              <video ref={attachCameraPreviewElement} autoPlay muted playsInline style={{ objectFit: 'cover', width: '100%', height: '100%', backgroundColor: '#000' }} />
              {showTheaterStrip && theaterStreamKey !== 'local-camera' && (
                <button type="button" className="screen-share-strip-focus" aria-label="Focus your camera" onClick={() => toggleTheaterStream('local-camera')} />
              )}
              <div className="screen-share-info-overlay">{mediaOwnerAvatar(null, true)}<span className="screen-share-info-text">Camera · You</span></div>
              <div className="screen-share-controls-bar">
                <div className="screen-share-controls-left" />
                <div className="screen-share-controls-right">
                  <button
                    type="button"
                    className="screen-share-controls-btn screen-share-focus-btn"
                    title={fullscreenTileKey ? 'Switch to focus view' : theaterStreamKey === 'local-camera' ? 'Exit focus view' : 'Focus camera'}
                    aria-label={fullscreenTileKey ? 'Switch to focus view' : theaterStreamKey === 'local-camera' ? 'Exit focus view' : 'Focus camera'}
                    onClick={() => toggleTheaterStream('local-camera')}
                  >
                    {!fullscreenTileKey && theaterStreamKey === 'local-camera' ? <LayoutGrid size={16} /> : <PanelsTopLeft size={16} />}
                  </button>
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
                  <button type="button" className="screen-share-controls-btn" title={fullscreenTileKey === 'camera' ? 'Exit fullscreen' : 'Enter fullscreen'} aria-label={fullscreenTileKey === 'camera' ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={(e) => {
                    const tile = (e.currentTarget as HTMLElement).closest('.screen-share-preview') as HTMLElement | null
                    if (!tile) return
                    if (document.fullscreenElement) void document.exitFullscreen().catch(() => { })
                    else void tile.requestFullscreen?.().catch(() => { })
                  }}>
                    {fullscreenTileKey === 'camera' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
              </div>
            </VoiceMediaPreview>
          )}
          {state.isScreenSharing && state.screenStream && (
            <VoiceMediaPreview kind="screen" className={`voice-stage-share-tile${theaterStreamKey === 'local-screen' ? ' is-theater-focused' : ''}`} data-fullscreen-key="screen" style={screenTileFrameStyle('screen')} onMouseMove={handleTileMouseMove} onMouseLeave={handleTileMouseLeave} onDoubleClick={theaterStreamKey === 'local-screen' ? toggleTileFullscreen : undefined}>
              {isScreenPreviewPaused ? (
                <div className="screen-share-preview-paused">
                  <div className="voice-stage-hidden-media-title">Your stream is still running</div>
                  <div className="voice-stage-hidden-media-sub">Viewers see it as usual. Only your preview is paused.</div>
                  <button type="button" className="voice-stage-hidden-media-show" onClick={() => setPausedPreviewStream(null)}>
                    <Eye size={14} />
                    Resume preview
                  </button>
                </div>
              ) : <video autoPlay muted playsInline ref={attachScreenPreviewElement} />}
              {showTheaterStrip && theaterStreamKey !== 'local-screen' && (
                <button type="button" className="screen-share-strip-focus" aria-label="Focus your screen share" onClick={() => toggleTheaterStream('local-screen')} />
              )}
              <div className="screen-share-info-overlay">{mediaOwnerAvatar(null, true)}<span className="screen-share-info-text">Screen share · You</span></div>
              {user?.id && <ScreenShareViewerAvatars viewerIds={getScreenShareViewerIds(user.id)} members={members} />}
              <div className="screen-share-controls-bar">
                <div className="screen-share-controls-left" />
                <div className="screen-share-controls-right">
                  {!isScreenPreviewPaused && (
                    <button
                      type="button"
                      className="screen-share-controls-btn"
                      title="Pause preview"
                      aria-label="Pause preview"
                      onClick={() => setPausedPreviewStream(state.screenStream)}
                    >
                      <EyeOff size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="screen-share-controls-btn screen-share-focus-btn"
                    title={fullscreenTileKey ? 'Switch to focus view' : theaterStreamKey === 'local-screen' ? 'Exit focus view' : 'Focus stream'}
                    aria-label={fullscreenTileKey ? 'Switch to focus view' : theaterStreamKey === 'local-screen' ? 'Exit focus view' : 'Focus stream'}
                    onClick={() => toggleTheaterStream('local-screen')}
                  >
                    {!fullscreenTileKey && theaterStreamKey === 'local-screen' ? <LayoutGrid size={16} /> : <PanelsTopLeft size={16} />}
                  </button>
                  <button type="button" className="screen-share-controls-btn" title={fullscreenTileKey === 'screen' ? 'Exit fullscreen' : 'Enter fullscreen'} aria-label={fullscreenTileKey === 'screen' ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={(e) => {
                    const tile = (e.currentTarget as HTMLElement).closest('.screen-share-preview') as HTMLElement | null
                    if (!tile) return
                    if (document.fullscreenElement) void document.exitFullscreen().catch(() => { })
                    else void tile.requestFullscreen?.().catch(() => { })
                  }}>
                    {fullscreenTileKey === 'screen' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
              </div>
            </VoiceMediaPreview>
          )}
          {remoteScreenSharePlaceholders.map((peerId) => {
            const isConnecting = watchedRemoteScreenPeerIds.has(peerId)
            return (
              <div key={`screen-available-${peerId}`} className="voice-stage-hidden-media-tile voice-stage-share-tile">
                {mediaOwnerAvatar(peerId)}
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
              {mediaOwnerAvatar(placeholder.peerId)}
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
            const theaterKey = `${kind}-${tileKey}`
            const owner = remoteShareOwner(peerId)
            const isHidden = isRemoteMediaHidden(peerId, kind)
            if (kind === 'screen' && !watchedRemoteScreenPeerIds.has(peerId)) return null
            if (kind === 'camera' && isHidden) return null
            const cameraSpeaking = kind === 'camera'
              && voiceSpeakingUserIds.includes(resolvePeerVolumeKey(peerId))
              && !effectiveDeafened
            return (
              <VoiceMediaPreview
                key={tileKey}
                kind={kind}
                className={`remote-screen-preview voice-stage-share-tile${theaterStreamKey === theaterKey ? ' is-theater-focused' : ''}${cameraSpeaking ? ' is-speaking' : ''}`}
                data-fullscreen-key={tileKey}
                style={kind === 'screen' ? screenTileFrameStyle(tileKey) : undefined}
                onMouseMove={handleTileMouseMove}
                onMouseLeave={handleTileMouseLeave}
                onDoubleClick={theaterStreamKey === theaterKey ? toggleTileFullscreen : undefined}
              >
                <RemoteVideoTrack track={track} />
                {showTheaterStrip && theaterStreamKey !== theaterKey && (
                  <button type="button" className="screen-share-strip-focus" aria-label={`Focus ${owner}'s ${kind === 'screen' ? 'screen share' : 'camera'}`} onClick={() => toggleTheaterStream(theaterKey)} />
                )}
                <div className="screen-share-info-overlay">{mediaOwnerAvatar(peerId, true)}<span className="screen-share-info-text">{label} · {owner}</span></div>
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
                    <button
                      type="button"
                      className="screen-share-controls-btn screen-share-focus-btn"
                      title={fullscreenTileKey ? 'Switch to focus view' : theaterStreamKey === theaterKey ? 'Exit focus view' : kind === 'screen' ? 'Focus stream' : 'Focus camera'}
                      aria-label={fullscreenTileKey ? 'Switch to focus view' : theaterStreamKey === theaterKey ? 'Exit focus view' : kind === 'screen' ? 'Focus stream' : 'Focus camera'}
                      onClick={() => toggleTheaterStream(theaterKey)}
                    >
                      {!fullscreenTileKey && theaterStreamKey === theaterKey ? <LayoutGrid size={16} /> : <PanelsTopLeft size={16} />}
                    </button>
                    <button type="button" className="screen-share-controls-btn" title={fullscreenTileKey === tileKey ? 'Exit fullscreen' : 'Enter fullscreen'} aria-label={fullscreenTileKey === tileKey ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={(e) => {
                      const tile = (e.currentTarget as HTMLElement).closest('.screen-share-preview') as HTMLElement | null
                      if (!tile) return
                      if (document.fullscreenElement) void document.exitFullscreen().catch(() => { })
                      else void tile.requestFullscreen?.().catch(() => { })
                    }}>
                      {fullscreenTileKey === tileKey ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                  </div>
                </div>
              </VoiceMediaPreview>
            )
          })}
          {stripHiddenCount > 0 && (
            <button
              type="button"
              className="screen-share-strip-more"
              aria-label={`Show everyone (${stripHiddenCount} more)`}
              title="Show everyone"
              onClick={() => setTheaterStreamKey(null)}
            >
              +{stripHiddenCount}
            </button>
          )}
          {hasTheaterFocus && (
            <button
              type="button"
              className="screen-share-strip-toggle"
              aria-pressed={theaterStripVisible}
              aria-label={theaterStripVisible ? 'Hide participants' : 'Show participants'}
              title={theaterStripVisible ? 'Hide participants' : 'Show participants'}
              onClick={() => setTheaterStripVisible((visible) => !visible)}
            >
              {theaterStripVisible ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
            </button>
          )}
        </div>
      )}
    </>
  )
}
