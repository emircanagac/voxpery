import { effectiveApiBase } from './client'

export function createWebSocket(token: string | null): WebSocket {
    const wsBase = effectiveApiBase().replace(/^http/, 'ws')
    const url = `${wsBase}/ws`
    if (token) {
        return new WebSocket(url, ['voxpery.auth', token])
    }
    return new WebSocket(url)
}
