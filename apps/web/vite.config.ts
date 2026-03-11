import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In production, remove worklet path so main bundle has no dependency on it (no extra 5 kB chunk).
function rnnoiseProdStripPlugin() {
  return {
    name: 'rnnoise-prod-strip',
    transform(code: string, id: string) {
      const normId = id.replace(/\\/g, '/')
      if (!normId.includes('webrtc/rnnoise.ts') || normId.includes('worklet')) return null
      if (!code.includes('rnnoise-worklet-processor')) return null
      const newCode = code.replace(
        /new URL\s*\(\s*['"]\.\/rnnoise-worklet-processor\.ts['"]\s*,\s*import\.meta\.url\s*\)\.href/g,
        '__RNNOISE_PROCESSOR_URL__'
      )
      if (newCode === code) return null
      return { code: newCode, map: null }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  envDir: '../../',
  plugins: [react(), mode === 'production' ? rnnoiseProdStripPlugin() : null].filter(Boolean),
  define: mode === 'production' ? { __RNNOISE_PROCESSOR_URL__: JSON.stringify('/assets/rnnoise-worklet.js') } : {},
  build: {
    // Strip console in production to avoid leaking room/user IDs (e.g. from LiveKit SDK) and other debug output
    minify: 'esbuild',
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : [],
    },
    rollupOptions: {
      // Worklet as separate entry → one self-contained file. Main app uses fixed URL (no ?url = no extra chunk).
      input: {
        main: 'index.html',
        worklet: 'src/webrtc/rnnoise-worklet-processor.ts',
      },
      output: {
        entryFileNames: (entryInfo) =>
          entryInfo.name === 'worklet' ? 'assets/rnnoise-worklet.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? ''
          if (name.endsWith('.ts')) return 'assets/[name]-[hash].js'
          return 'assets/[name]-[hash][extname]'
        },
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Keep in worklet entry chunk (do not split into vendor)
            if (id.includes('rnnoise-wasm')) return undefined
            if (id.includes('lucide-react')) return 'lucide'
            if (id.includes('@tauri-apps')) return 'tauri'
            // Precise matching for core React libraries to avoid circular dependencies
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/scheduler/') ||
              id.includes('/node_modules/zustand/')
            ) {
              return 'react'
            }
            if (id.includes('react-router')) return 'router'
            if (id.includes('livekit-client')) return 'livekit'
            if (id.includes('@tanstack')) return 'tanstack'
            return 'vendor'
          }
        },
      },
    },
    // Worklet chunk embeds rnnoise-wasm (~4.8 MB); warn above 5 MB
    chunkSizeWarningLimit: 5120,
  },
}))
