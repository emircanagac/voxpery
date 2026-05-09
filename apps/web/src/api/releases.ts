import { apiFetch } from './client'
import type { LatestReleaseResponse } from './contracts'

export const releaseApi = {
    getLatest: () =>
        apiFetch<LatestReleaseResponse>('/api/releases/latest'),
}
