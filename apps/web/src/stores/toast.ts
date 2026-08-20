import { create } from 'zustand'
import { createSecureId } from '../secureId'

export type ToastLevel = 'info' | 'error'

export interface ToastItem {
  id: string
  title: string
  message: string
  level: ToastLevel
}

interface ToastState {
  toasts: ToastItem[]
  pushToast: (toast: Omit<ToastItem, 'id'>, ttlMs?: number) => void
  dismissToast: (id: string) => void
}

const toastTimers = new Map<string, number>()

function toastMatches(first: Omit<ToastItem, 'id'>, second: ToastItem): boolean {
  return first.level === second.level
    && first.title === second.title
    && first.message === second.message
}

function scheduleDismiss(id: string, ttlMs: number, dismiss: (toastId: string) => void): void {
  const current = toastTimers.get(id)
  if (current != null) window.clearTimeout(current)
  const timer = window.setTimeout(() => dismiss(id), ttlMs)
  toastTimers.set(id, timer)
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  pushToast: (toast, ttlMs = 5000) => {
    const duplicate = get().toasts.find((current) => toastMatches(toast, current))
    if (duplicate) {
      scheduleDismiss(duplicate.id, ttlMs, get().dismissToast)
      return
    }
    const id = createSecureId()
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    scheduleDismiss(id, ttlMs, get().dismissToast)
  },
  dismissToast: (id) => {
    const timer = toastTimers.get(id)
    if (timer != null) window.clearTimeout(timer)
    toastTimers.delete(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

