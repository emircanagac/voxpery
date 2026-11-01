export interface RuntimeConfig {
  apiUrl?: string
  turnstileSiteKey?: string
  giphyApiKey?: string
}

declare global {
  interface Window {
    /** Written by /runtime-config.js, which loads before the app. */
    __VOXPERY_RUNTIME_CONFIG__?: RuntimeConfig
  }
}

/** Addresses of this deployment; they take the place of the values chosen at build time. */
export function runtimeConfig(): RuntimeConfig {
  return (typeof window === 'undefined' ? undefined : window.__VOXPERY_RUNTIME_CONFIG__) ?? {}
}
