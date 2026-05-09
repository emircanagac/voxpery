export const APP_BASE_PATH = '/'

export const ROUTES = {
  landing: APP_BASE_PATH,
  about: '/about' as const,
  home: '/social' as const,
  servers: '/servers' as const,
  dm: '/social/dm' as const,
  login: '/login' as const,
  register: '/register' as const,
  forgotPassword: '/forgot-password' as const,
  resetPassword: '/reset-password' as const,
  verifyEmail: '/verify-email' as const,
  invite: (code: string = ':code') => `/invite/${code}`,
} as const

