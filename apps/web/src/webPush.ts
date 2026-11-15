import { apiFetch } from './api/client'
import type { AuthToken } from './api/contracts'
import { isTauri } from './secureStorage'

/**
 * Web Push: lets the server notify this browser about direct messages and mentions while no
 * Voxpery tab is open. The subscription belongs to this browser; the server keeps it for the
 * signed-in account until sign-out or until the setting is turned off.
 */

export const pushApi = {
    subscribe: (subscription: PushSubscriptionJSON, token: AuthToken) =>
        apiFetch<void>('/api/push/subscriptions', { method: 'POST', body: subscription, token }),
    unsubscribe: (endpoint: string, token: AuthToken) =>
        apiFetch<void>('/api/push/subscriptions', { method: 'DELETE', body: { endpoint }, token }),
}

/** Push needs a service worker, which only production web builds register (not the desktop app). */
export function webPushSupported(): boolean {
    if (typeof window === 'undefined' || isTauri()) return false
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (!webPushSupported()) return null
    try {
        const registration = await navigator.serviceWorker.getRegistration()
        return registration?.active ? registration : null
    } catch {
        return null
    }
}

export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
    const current = subscription.options?.applicationServerKey
    if (!current) return false
    const bytes = new Uint8Array(current)
    return bytes.length === key.length && bytes.every((byte, index) => byte === key[index])
}

/** Whether this browser currently receives pushes from this server. */
export async function browserPushEnabled(publicKey: string): Promise<boolean> {
    const registration = await activeRegistration()
    if (!registration) return false
    try {
        const subscription = await registration.pushManager.getSubscription()
        return !!subscription && sameKey(subscription, applicationServerKey(publicKey))
    } catch {
        return false
    }
}

/** Subscribes this browser and registers it with the server. Throws with a readable message. */
export async function enableBrowserPush(publicKey: string, token: AuthToken): Promise<void> {
    const registration = await activeRegistration()
    if (!registration) throw new Error('Notifications when Voxpery is closed are not available in this browser.')
    if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') throw new Error('Allow notifications for Voxpery in your browser first.')
    }
    const key = applicationServerKey(publicKey)
    let subscription = await registration.pushManager.getSubscription()
    // A subscription made for another server key (the server's keys changed) cannot be used.
    if (subscription && !sameKey(subscription, key)) {
        await subscription.unsubscribe()
        subscription = null
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await pushApi.subscribe(subscription.toJSON(), token)
}

/**
 * Stops pushes to this browser: tells the server first (while still signed in), then drops the
 * browser subscription. Never throws; used on sign-out too.
 */
export async function disableBrowserPush(token: AuthToken): Promise<void> {
    const registration = await activeRegistration()
    if (!registration) return
    try {
        const subscription = await registration.pushManager.getSubscription()
        if (!subscription) return
        await pushApi.unsubscribe(subscription.endpoint, token).catch(() => {
            // The push service reports the dropped subscription on the next push and the
            // server forgets it then.
        })
        await subscription.unsubscribe()
    } catch {
        // Nothing more to do in this browser.
    }
}
