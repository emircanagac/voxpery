import { create } from 'zustand'
import { systemApi, type SystemFeatures } from '../api'

interface FeatureState {
    features: SystemFeatures | null
    loading: boolean
    error: string | null
    loadFeatures: () => Promise<void>
}

export const useFeatureStore = create<FeatureState>((set, get) => ({
    features: null,
    loading: false,
    error: null,
    loadFeatures: async () => {
        const current = get()
        if (current.loading || current.features) return

        set({ loading: true, error: null })
        try {
            const features = await systemApi.getFeatures()
            set({ features, loading: false, error: null })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            set({ loading: false, error: message || 'Could not load server features' })
        }
    },
}))
