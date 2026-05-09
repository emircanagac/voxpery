import { apiFetch } from './client'
import type { SystemFeatures } from './contracts'

export const systemApi = {
    getFeatures: () => apiFetch<SystemFeatures>('/api/system/features'),
}
