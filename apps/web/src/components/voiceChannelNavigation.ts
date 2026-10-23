import { useAppStore } from '../stores/app'
import { useToastStore } from '../stores/toast'

type VoiceJoinWindow = Window & {
  __voxperyManualJoinActive?: boolean
  __voxperyJoinVoice?: (channelId: string) => Promise<void>
}

export async function joinVoiceChannelFromNavigation(channelId: string): Promise<void> {
  const store = useAppStore.getState()
  store.setActiveChannel(channelId)
  store.closeMobileSidebar()
  if (store.joinedVoiceChannelId === channelId) return
  // One join at a time: a second click while connecting is ignored instead of failing.
  if (store.joiningVoiceChannelId) return

  const voiceWindow = window as VoiceJoinWindow
  voiceWindow.__voxperyManualJoinActive = true
  store.setJoiningVoiceChannelId(channelId)
  try {
    if (!voiceWindow.__voxperyJoinVoice) {
      useToastStore.getState().pushToast({
        level: 'error', title: 'Voice Error', message: 'Voice service is not ready. Please refresh.',
      })
      return
    }
    await voiceWindow.__voxperyJoinVoice(channelId)
  } catch (error) {
    console.error('Voice join failed:', error)
  } finally {
    voiceWindow.__voxperyManualJoinActive = false
    useAppStore.getState().setJoiningVoiceChannelId(null)
  }
}
