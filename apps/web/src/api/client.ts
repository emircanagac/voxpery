import { isTauri } from '../secureStorage'

// Prefer localhost so cookie is sent after Google OAuth when frontend is at localhost:5173 (same host).
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
export const LEGAL_CONSENT_REQUIRED_EVENT = 'voxpery-legal-consent-required'

function isLoopbackHostname(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function isLoopbackApiBase(apiBase: string = effectiveApiBase()): boolean {
    try {
        const apiUrl = new URL(apiBase)
        return isLoopbackHostname(apiUrl.hostname)
    } catch {
        return false
    }
}

export function shouldUseTauriHttpPluginForApiBase(isDesktop: boolean, apiBase: string): boolean {
    return isDesktop && !isLoopbackApiBase(apiBase)
}

function shouldUseTauriHttpPlugin(): boolean {
    return shouldUseTauriHttpPluginForApiBase(isTauri(), effectiveApiBase())
}

/** In browser, if page is on localhost but API_BASE uses 127.0.0.1, return API base with localhost so the auth cookie is sent. */
export function effectiveApiBase(): string {
    if (typeof window === 'undefined') return API_BASE
    if (window.location.hostname === 'localhost' && API_BASE.includes('127.0.0.1')) {
        return API_BASE.replace(/127\.0\.0\.1/g, 'localhost')
    }
    return API_BASE
}

/** Exposed so UI can show which API the app is using (e.g. in connection errors). */
export function getApiBase(): string {
    return effectiveApiBase()
}

/** Ping backend /health endpoint. Returns true if server is reachable and healthy. */
export async function checkHealth(): Promise<boolean> {
    try {
        const url = `${effectiveApiBase()}/health`
        const deadline = requestDeadline(5000)
        try {
            const request = shouldUseTauriHttpPlugin()
                ? (await import('@tauri-apps/plugin-http')).fetch
                : fetch
            const res = await request(url, { method: 'GET', signal: deadline.signal })
            return res.ok
        } finally {
            deadline.clear()
        }
    } catch {
        return false
    }
}

/** True when page origin differs from API origin (e.g. localhost:5173 → api.voxpery.com). Cookie auth won't work; use Bearer token. */
export function isCrossOrigin(): boolean {
    if (typeof window === 'undefined') return false
    try {
        const apiOrigin = new URL(getApiBase()).origin
        return window.location.origin !== apiOrigin
    } catch {
        return false
    }
}


/** Token is optional: web uses httpOnly cookie when null. */
interface FetchOptions {
    method?: string
    body?: unknown
    token?: string | null
    /** Total deadline including the response body; defaults to API_REQUEST_TIMEOUT_MS. */
    timeoutMs?: number
}

const API_REQUEST_TIMEOUT_MS = 30_000
const API_TRANSFER_TIMEOUT_MS = 60_000
const REQUEST_TIMEOUT_MESSAGE = 'CONNECTION_ERROR:The server did not respond in time. Check the connection and try again.'

/**
 * Abort a request (including its body) after `ms`. The Tauri HTTP plugin has no total
 * timeout option, but both it and browser fetch honor an AbortSignal.
 */
function requestDeadline(ms: number) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

export interface DownloadResult {
    blob: Blob
    filename: string | null
}

let authFailureHandler: (() => void) | null = null

export function setAuthFailureHandler(handler: (() => void) | null) {
    authFailureHandler = handler
}

function shouldBroadcastAuthFailure(path: string): boolean {
    // Bootstrap owns its request generation; a late 401 must not clear a newer login.
    return !(
        path === '/api/auth/session' ||
        path === '/api/auth/logout' ||
        path === '/api/auth/login' ||
        path === '/api/auth/register' ||
        path === '/api/auth/forgot-password' ||
        path === '/api/auth/reset-password'
    )
}

function isNetworkError(err: unknown): boolean {
    if (err instanceof TypeError && err.message === 'Failed to fetch') return true
    if (err instanceof Error) {
        const msg = err.message.toLowerCase()
        const name = (err as { name?: string }).name ?? ''
        if (msg.includes('networkerror') || msg.includes('failed to fetch') || name === 'TypeError') return true
    }
    return false
}

/** True if error indicates auth failure (401); used to avoid logout on network/server errors. */
export function isAuthError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err)
    return (
        msg.includes('Authentication required') ||
        msg.includes('Invalid credentials') ||
        msg.includes('Unauthorized')
    )
}

/** Parses API errors so login/register can show a user-friendly message and error code. */
export function getAuthErrorMessage(err: unknown): { message: string; code?: string } {
    const msg = err instanceof Error ? err.message : String(err)
    const match = msg.match(/^([A-Z_]+):(.+)$/s)
    if (match) {
        const [, code, rest] = match
        let message = rest.trim()
        if (code === 'CONNECTION_ERROR') {
            const fallback = 'Cannot connect to the server. Check your connection.'
            message = message || fallback
            // In desktop always show API URL so user can see if build had wrong VITE_API_URL
            if (isTauri()) {
                const base = getApiBase()
                if (!message.includes('API:') && !message.includes(base)) {
                    message = `${message} — API: ${base}`
                }
            }
            return { code, message }
        }
        return { code: code ?? undefined, message }
    }
    // No code prefix (e.g. raw "Failed to fetch" from plugin) — in desktop treat as connection error and show API URL
    let message = msg
    if (isTauri()) {
        const lower = String(msg).toLowerCase()
        if (lower.includes('fetch') || lower.includes('network') || lower.includes('connection')) {
            message = `${msg} — API: ${getApiBase()}`
            return { code: 'CONNECTION_ERROR', message }
        }
    }
    return { message }
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const deadline = requestDeadline(options.timeoutMs ?? API_REQUEST_TIMEOUT_MS)
    try {
        return await apiFetchWithin<T>(path, options, deadline.signal)
    } finally {
        deadline.clear()
    }
}

async function apiFetchWithin<T>(path: string, options: FetchOptions, signal: AbortSignal): Promise<T> {
    const { method = 'GET', body, token } = options

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`
    }

    const url = `${effectiveApiBase()}${path}`
    const fetchOptions: RequestInit = {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: isTauri() ? 'omit' : 'include', // desktop: no cookies; web: httpOnly cookie
        signal,
    }

    let res: Response
    try {
        if (shouldUseTauriHttpPlugin()) {
            let tauriFetch: typeof fetch
            try {
                const mod = await import('@tauri-apps/plugin-http')
                tauriFetch = mod.fetch
            } catch (importErr) {
                const msg = importErr instanceof Error ? importErr.message : String(importErr)
                throw new Error(`CONNECTION_ERROR:Desktop plugin could not load. ${msg}`, { cause: importErr })
            }
            res = await tauriFetch(url, fetchOptions)
        } else {
            res = await fetch(url, fetchOptions)
        }
    } catch (err) {
        if (signal.aborted) throw new Error(REQUEST_TIMEOUT_MESSAGE, { cause: err })
        const detail = err instanceof Error ? err.message : String(err)
        const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : (err as { cause?: unknown })?.cause != null ? String((err as { cause: unknown }).cause) : ''
        const fullDetail = cause ? `${detail}. ${cause}` : detail
        if (isNetworkError(err) || isTauri()) {
            if (isTauri()) {
                console.error('[Voxpery] Connection failed. URL:', url, 'Error:', detail, cause || '')
                // Show API base in error so user can see if build had wrong VITE_API_URL
                const apiHint = ` (API: ${getApiBase()})`
                throw new Error(`CONNECTION_ERROR:Cannot connect to the server.${apiHint} ${fullDetail}`, { cause: err })
            }
            throw new Error(`CONNECTION_ERROR:Cannot connect to the server. ${fullDetail}`, { cause: err })
        }
        throw err
    }

    if (!res.ok) {
        if (res.status === 401 && shouldBroadcastAuthFailure(path)) {
            authFailureHandler?.()
        }
        if (res.status === 428 && typeof window !== 'undefined') {
            window.dispatchEvent(new Event(LEGAL_CONSENT_REQUIRED_EVENT))
        }
        const text = await res.text()
        const message = apiErrorMessageFromText(text, res.status)
        throw new Error(message)
    }

    return res.json()
}

export async function apiDownload(path: string, options: FetchOptions = {}): Promise<DownloadResult> {
    const deadline = requestDeadline(options.timeoutMs ?? API_TRANSFER_TIMEOUT_MS)
    try {
        return await apiDownloadWithin(path, options, deadline.signal)
    } catch (err) {
        if (deadline.signal.aborted) throw new Error(REQUEST_TIMEOUT_MESSAGE, { cause: err })
        throw err
    } finally {
        deadline.clear()
    }
}

async function apiDownloadWithin(path: string, options: FetchOptions, signal: AbortSignal): Promise<DownloadResult> {
    const { method = 'POST', body, token } = options
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const url = `${effectiveApiBase()}${path}`
    const request: RequestInit = {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: isTauri() ? 'omit' : 'include',
        signal,
    }

    let response: Response
    if (shouldUseTauriHttpPlugin()) {
        const mod = await import('@tauri-apps/plugin-http')
        response = await mod.fetch(url, request)
    } else {
        response = await fetch(url, request)
    }
    if (!response.ok) {
        if (response.status === 428 && typeof window !== 'undefined') {
            window.dispatchEvent(new Event(LEGAL_CONSENT_REQUIRED_EVENT))
        }
        const text = await response.text()
        throw new Error(apiErrorMessageFromText(text, response.status))
    }
    const disposition = response.headers.get('content-disposition')
    const filename = disposition?.match(/filename="([^"]+)"/i)?.[1] ?? null
    return { blob: await response.blob(), filename }
}

export async function apiMultipartFetch<T>(path: string, formData: FormData, token?: string | null): Promise<T> {
    const deadline = requestDeadline(API_TRANSFER_TIMEOUT_MS)
    try {
        return await apiMultipartFetchWithin<T>(path, formData, token, deadline.signal)
    } catch (err) {
        if (deadline.signal.aborted) throw new Error(REQUEST_TIMEOUT_MESSAGE, { cause: err })
        throw err
    } finally {
        deadline.clear()
    }
}

async function apiMultipartFetchWithin<T>(path: string, formData: FormData, token: string | null | undefined, signal: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const url = `${effectiveApiBase()}${path}`
    let res: Response
    try {
        if (shouldUseTauriHttpPlugin()) {
            const mod = await import('@tauri-apps/plugin-http')
            res = await mod.fetch(url, {
                method: 'POST',
                headers,
                body: formData,
                credentials: 'omit',
                signal,
            })
        } else {
            res = await fetch(url, {
                method: 'POST',
                headers,
                body: formData,
                credentials: 'include',
                signal,
            })
        }
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        if (isNetworkError(err) || isTauri()) {
            if (isTauri()) {
                const apiHint = ` (API: ${getApiBase()})`
                throw new Error(`CONNECTION_ERROR:Cannot connect to the server.${apiHint} ${detail}`, { cause: err })
            }
            throw new Error(`CONNECTION_ERROR:Cannot connect to the server. ${detail}`, { cause: err })
        }
        throw err
    }

    if (!res.ok) {
        if (res.status === 401 && shouldBroadcastAuthFailure(path)) {
            authFailureHandler?.()
        }
        if (res.status === 428 && typeof window !== 'undefined') {
            window.dispatchEvent(new Event(LEGAL_CONSENT_REQUIRED_EVENT))
        }
        const text = await res.text()
        const message = apiErrorMessageFromText(text, res.status)
        throw new Error(message)
    }

    return res.json()
}

interface ApiErrorPayload {
    error?: string
    code?: string
}

function apiErrorMessageFromText(text: string, status: number): string {
    try {
        const json = JSON.parse(text) as ApiErrorPayload
        const message = json.error || text || `HTTP ${status}`
        return json.code ? `${json.code}:${message}` : message
    } catch {
        return text || `HTTP ${status}`
    }
}
