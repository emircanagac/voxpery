export const APP_BASE_PATH = '/'

export const ROUTES = {
  home: APP_BASE_PATH,
  servers: '/servers' as const,
  dm: '/dm' as const,
  login: '/login' as const,
  register: '/register' as const,
  invite: (code: string = ':code') => `/invite/${code}`,
} as const

