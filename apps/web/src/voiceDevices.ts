export const VOICE_SETTINGS_CHANGED_EVENT = 'voxpery-voice-settings-changed'
export const VOICE_INPUT_DEVICE_KEY = 'voxpery-settings-input-device-id'
export const VOICE_OUTPUT_DEVICE_KEY = 'voxpery-settings-output-device-id'
export const DEFAULT_INPUT_DEVICE_LABEL = 'System Default'
export const DEFAULT_OUTPUT_DEVICE_LABEL = 'System Default'

export type VoiceDeviceOption = {
  id: string
  label: string
  fullLabel: string
}

export type EnumeratedVoiceDevices = {
  inputs: VoiceDeviceOption[]
  outputs: VoiceDeviceOption[]
  canSelectOutput: boolean
  labelsUnlocked: boolean
}

export type MicrophonePermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported'

function readStoredDeviceId(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function getStoredVoiceInputDeviceId(): string {
  return readStoredDeviceId(VOICE_INPUT_DEVICE_KEY)
}

export function getStoredVoiceOutputDeviceId(): string {
  return readStoredDeviceId(VOICE_OUTPUT_DEVICE_KEY)
}

export function buildPreferredMicrophoneConstraints(): MediaTrackConstraints {
  const deviceId = getStoredVoiceInputDeviceId()
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    noiseSuppression: false,
    echoCancellation: true,
    autoGainControl: true,
  }
}

export function supportsAudioOutputSelection(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
}

function fallbackDeviceLabel(kind: 'audioinput' | 'audiooutput', index: number): string {
  return kind === 'audioinput' ? `Microphone ${index}` : `Speaker ${index}`
}

function createVoiceDeviceOptions(
  devices: MediaDeviceInfo[],
  kind: 'audioinput' | 'audiooutput',
): VoiceDeviceOption[] {
  const filtered = devices.filter((device) => device.kind === kind && device.deviceId !== 'default')
  const options = filtered.map((device, index) => {
    const fullLabel = device.label?.trim() || fallbackDeviceLabel(kind, index + 1)
    return {
      id: device.deviceId,
      label: fullLabel,
      fullLabel,
    }
  })
  const defaultLabel = kind === 'audioinput' ? DEFAULT_INPUT_DEVICE_LABEL : DEFAULT_OUTPUT_DEVICE_LABEL
  const defaultFullLabel = kind === 'audioinput' ? 'System default microphone' : 'System default speaker'
  return [{ id: '', label: defaultLabel, fullLabel: defaultFullLabel }, ...options]
}

export async function enumerateVoiceDevices(): Promise<{
  inputs: VoiceDeviceOption[]
  outputs: VoiceDeviceOption[]
  canSelectOutput: boolean
  labelsUnlocked: boolean
}> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return {
      inputs: [{ id: '', label: DEFAULT_INPUT_DEVICE_LABEL, fullLabel: 'System default microphone' }],
      outputs: [{ id: '', label: DEFAULT_OUTPUT_DEVICE_LABEL, fullLabel: 'System default speaker' }],
      canSelectOutput: false,
      labelsUnlocked: false,
    }
  }

  const devices = await navigator.mediaDevices.enumerateDevices()
  const inputs = createVoiceDeviceOptions(devices, 'audioinput')
  const outputs = createVoiceDeviceOptions(devices, 'audiooutput')
  const labelsUnlocked = devices.some(
    (device) => (device.kind === 'audioinput' || device.kind === 'audiooutput')
      && device.deviceId !== 'default'
      && device.label.trim().length > 0,
  )

  return {
    inputs,
    outputs,
    canSelectOutput: supportsAudioOutputSelection() && outputs.some((device) => device.id !== ''),
    labelsUnlocked,
  }
}

export async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported'
  if (!navigator.permissions?.query) return 'unsupported'
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state
    }
    return 'unsupported'
  } catch {
    return 'unsupported'
  }
}

export async function requestVoiceDeviceAccess(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: false,
        echoCancellation: true,
        autoGainControl: true,
      },
      video: false,
    })
    stream.getTracks().forEach((track) => track.stop())
    return true
  } catch {
    return false
  }
}

type SinkSelectableAudioElement = HTMLAudioElement & {
  sinkId?: string
  setSinkId?: (sinkId: string) => Promise<void>
}

export async function applyPreferredAudioOutputDevice(element: HTMLAudioElement): Promise<boolean> {
  if (!supportsAudioOutputSelection()) return false
  const sinkElement = element as SinkSelectableAudioElement
  if (typeof sinkElement.setSinkId !== 'function') return false

  const preferredSinkId = getStoredVoiceOutputDeviceId() || 'default'

  try {
    if (sinkElement.sinkId !== preferredSinkId) {
      await sinkElement.setSinkId(preferredSinkId)
    }
    return true
  } catch {
    if (preferredSinkId !== 'default') {
      try {
        await sinkElement.setSinkId('default')
      } catch {
        // ignore fallback failures
      }
    }
    return false
  }
}
