import { create } from 'zustand'

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

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  pushToast: (toast, ttlMs = 5000) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    window.setTimeout(() => {
      get().dismissToast(id)
    }, ttlMs)
  },
  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

