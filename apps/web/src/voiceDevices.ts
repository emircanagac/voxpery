export const VOICE_SETTINGS_CHANGED_EVENT = 'voxpery-voice-settings-changed'
export const VOICE_DEVICE_PREFERENCES_CHANGED_EVENT = 'voxpery-voice-device-preferences-changed'
export const VOICE_INPUT_DEVICE_KEY = 'voxpery-settings-input-device-id'
export const VOICE_OUTPUT_DEVICE_KEY = 'voxpery-settings-output-device-id'
export const DEFAULT_INPUT_DEVICE_LABEL = 'Windows Default'
export const DEFAULT_OUTPUT_DEVICE_LABEL = 'Windows Default'
const NOISE_SUPPRESSION_KEY = 'voxpery-settings-noise-suppression'

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

function clearStoredDeviceId(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // The current capture/playback fallback still succeeds for this session.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(VOICE_DEVICE_PREFERENCES_CHANGED_EVENT))
  }
}

function isUnavailableDeviceError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const typedError = error as {
    name?: unknown
    constraint?: unknown
    constraintName?: unknown
  }
  const name = String(typedError.name ?? '')
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return true
  if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError') return false
  const constraint = String(typedError.constraint ?? typedError.constraintName ?? '')
  return constraint === '' || constraint === 'deviceId'
}

export function isStoredNoiseSuppressionEnabled(): boolean {
  try {
    return localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0'
  } catch {
    return true
  }
}

export function buildMicProcessingConstraints(
  noiseSuppressionEnabled: boolean,
): MediaTrackConstraints {
  return {
    noiseSuppression: noiseSuppressionEnabled,
    echoCancellation: true,
    autoGainControl: !noiseSuppressionEnabled,
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
  const noiseSuppressionEnabled = isStoredNoiseSuppressionEnabled()
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    ...buildMicProcessingConstraints(noiseSuppressionEnabled),
  }
}

export async function getPreferredMicrophoneStream(
  overrides: MediaTrackConstraints = {},
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported in this browser')
  }

  const preferredDeviceId = getStoredVoiceInputDeviceId()
  const preferredConstraints = {
    ...buildPreferredMicrophoneConstraints(),
    ...overrides,
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: preferredConstraints,
      video: false,
    })
  } catch (error) {
    if (!preferredDeviceId || !isUnavailableDeviceError(error)) throw error

    clearStoredDeviceId(VOICE_INPUT_DEVICE_KEY)
    return navigator.mediaDevices.getUserMedia({
      audio: {
        ...buildPreferredMicrophoneConstraints(),
        ...overrides,
        deviceId: undefined,
      },
      video: false,
    })
  }
}

export async function applyMicTrackProcessingConstraints(
  audioTrack: MediaStreamTrack | null,
  noiseSuppressionEnabled: boolean,
): Promise<void> {
  if (!audioTrack || typeof audioTrack.applyConstraints !== 'function') return
  try {
    await audioTrack.applyConstraints(buildMicProcessingConstraints(noiseSuppressionEnabled))
  } catch {
    // ignore unsupported constraints
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
  const defaultFullLabel = kind === 'audioinput' ? 'Windows default microphone' : 'Windows default speaker'
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
      inputs: [{ id: '', label: DEFAULT_INPUT_DEVICE_LABEL, fullLabel: 'Windows default microphone' }],
      outputs: [{ id: '', label: DEFAULT_OUTPUT_DEVICE_LABEL, fullLabel: 'Windows default speaker' }],
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
    const noiseSuppressionEnabled = isStoredNoiseSuppressionEnabled()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...buildMicProcessingConstraints(noiseSuppressionEnabled),
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

type OutputDeviceAssignment = {
  targetId: string
  promise: Promise<boolean>
}

const outputDeviceAssignments = new WeakMap<HTMLAudioElement, OutputDeviceAssignment>()

export async function applyPreferredAudioOutputDevice(element: HTMLAudioElement): Promise<boolean> {
  if (!supportsAudioOutputSelection()) return false
  const sinkElement = element as SinkSelectableAudioElement
  if (typeof sinkElement.setSinkId !== 'function') return false

  const preferredSinkId = getStoredVoiceOutputDeviceId() || 'default'

  const currentAssignment = outputDeviceAssignments.get(element)
  if (currentAssignment?.targetId === preferredSinkId) return currentAssignment.promise

  const assign = async (): Promise<boolean> => {
    try {
      if (sinkElement.sinkId !== preferredSinkId) {
        await sinkElement.setSinkId(preferredSinkId)
      }
      return true
    } catch (error) {
      if (preferredSinkId !== 'default' && isUnavailableDeviceError(error)) {
        clearStoredDeviceId(VOICE_OUTPUT_DEVICE_KEY)
        try {
          await sinkElement.setSinkId('default')
          return true
        } catch {
          // ignore fallback failures
        }
      }
      return false
    }
  }

  const promise = currentAssignment
    ? currentAssignment.promise.catch(() => false).then(assign)
    : assign()
  outputDeviceAssignments.set(element, { targetId: preferredSinkId, promise })
  const clearAssignment = () => {
    if (outputDeviceAssignments.get(element)?.promise === promise) {
      outputDeviceAssignments.delete(element)
    }
  }
  void promise.then(clearAssignment, clearAssignment)
  return promise
}
