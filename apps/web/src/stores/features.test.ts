import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getFeatures } = vi.hoisted(() => ({
  getFeatures: vi.fn(),
}))

vi.mock('../api', () => ({
  systemApi: { getFeatures },
}))

import { useFeatureStore } from './features'

const enabledFeatures = {
  google_oauth_enabled: true,
  email_delivery_enabled: true,
  email_verification_enabled: true,
  email_verification_required: false,
  password_reset_enabled: true,
  observability_enabled: false,
}

describe('feature store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getFeatures.mockReset()
    useFeatureStore.setState({ features: null, loading: false, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('recovers from a transient feature endpoint failure without hiding auth options', async () => {
    getFeatures
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(enabledFeatures)

    const loading = useFeatureStore.getState().loadFeatures()
    await vi.runAllTimersAsync()
    await loading

    expect(getFeatures).toHaveBeenCalledTimes(2)
    expect(useFeatureStore.getState()).toMatchObject({
      features: enabledFeatures,
      loading: false,
      error: null,
    })
  })

  it('exposes a retryable error only after bounded retries are exhausted', async () => {
    getFeatures.mockRejectedValue(new Error('feature endpoint unavailable'))

    const loading = useFeatureStore.getState().loadFeatures()
    await vi.runAllTimersAsync()
    await loading

    expect(getFeatures).toHaveBeenCalledTimes(3)
    expect(useFeatureStore.getState()).toMatchObject({
      features: null,
      loading: false,
      error: 'feature endpoint unavailable',
    })
  })
})
