import { useAppStore } from '../src/stores/app'
import { useSocketStore } from '../src/stores/socket'

// Drive the existing application socket listener without a real RTC session.
export function publishActivity(serverId: string, channelId: string, ids: string[], sharing = false) {
  const socket = useSocketStore.getState().socket
  if (!socket?.onmessage) throw new Error('Application socket is not ready')
  for (const userId of ids) {
    for (const event of [
      { type: 'VoiceStateUpdate', data: { user_id: userId, channel_id: channelId, server_id: serverId } },
      { type: 'VoiceControlUpdate', data: { user_id: userId, muted: false, deafened: false, screen_sharing: sharing, camera_on: false } },
    ]) socket.onmessage.call(socket, new MessageEvent('message', { data: JSON.stringify(event) }))
  }
}

export function installNavigationProbe(currentChannelId: string | null) {
  useAppStore.setState({ joinedVoiceChannelId: currentChannelId })
  const actions: string[] = []
  Reflect.set(window, '__activityJoinCalls', actions)
  Reflect.set(window, '__voxperyJoinVoice', async (channelId: string) => { actions.push(channelId) })
}

export function readActivityNavigation() {
  const state = useAppStore.getState()
  return { joined: state.joinedVoiceChannelId, server: state.activeServerId, channel: state.activeChannelId }
}

export function setVoiceStartedAt(channelId: string, startedAt: number) {
  useAppStore.setState(state => ({ voiceChannelActiveSince: { ...state.voiceChannelActiveSince, [channelId]: startedAt } }))
}

export function publishControls(userId: string, flags: Record<string, boolean>) {
  const socket = useSocketStore.getState().socket
  if (!socket?.onmessage) throw new Error('Application socket is not ready')
  socket.onmessage.call(socket, new MessageEvent('message', { data: JSON.stringify({ type: 'VoiceControlUpdate',
    data: { user_id: userId, muted: false, deafened: false, screen_sharing: false, camera_on: false, ...flags } }) }))
}

export function setActivityConnection(connected: boolean, freshConnection = false) {
  if (!connected) useSocketStore.getState().disconnect()
  else if (freshConnection) useSocketStore.getState().connect(null)
  else useSocketStore.setState({ isConnected: true })
}
