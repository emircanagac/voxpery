import { create } from 'zustand'
import { systemApi, type SystemFeatures } from '../api'

interface FeatureState {
    features: SystemFeatures | null
    loading: boolean
    error: string | null
    loadFeatures: () => Promise<void>
}

const FEATURE_RETRY_DELAYS_MS = [300, 1_000]

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export const useFeatureStore = create<FeatureState>((set, get) => ({
    features: null,
    loading: false,
    error: null,
    loadFeatures: async () => {
        const current = get()
        if (current.loading || current.features) return

        set({ loading: true, error: null })
        let lastError: unknown
        for (let attempt = 0; attempt <= FEATURE_RETRY_DELAYS_MS.length; attempt += 1) {
            try {
                const features = await systemApi.getFeatures()
                set({ features, loading: false, error: null })
                return
            } catch (err) {
                lastError = err
                const delay = FEATURE_RETRY_DELAYS_MS[attempt]
                if (delay !== undefined) await wait(delay)
            }
        }

        const message = lastError instanceof Error ? lastError.message : String(lastError ?? '')
        set({ loading: false, error: message || 'Could not load server features' })
    },
}))
