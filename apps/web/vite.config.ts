import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  envDir: '../../',
  plugins: [react()],
  build: {
    // Strip console in production to avoid leaking room/user IDs (e.g. from LiveKit SDK) and other debug output
    minify: 'esbuild',
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : [],
    },
    rollupOptions: {
      output: {
        // Emit worklet as .js so servers don't serve it as video/mp2t (MIME for .ts)
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? ''
          if (name.endsWith('.ts')) return 'assets/[name]-[hash].js'
          return 'assets/[name]-[hash][extname]'
        },
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) return 'lucide'
            if (id.includes('@tauri-apps')) return 'tauri'
            if (id.includes('react-dom') || id.includes('react/') || id.includes('zustand')) return 'react'
            if (id.includes('react-router')) return 'router'
            if (id.includes('livekit-client')) return 'livekit'
            if (id.includes('rnnoise-wasm')) return 'rnnoise'
            if (id.includes('@tanstack')) return 'tanstack'
            return 'vendor'
          }
        },
      },
    },
    // rnnoise-wasm chunk ~4.8 MB (embedded WASM); warn above 5 MB
    chunkSizeWarningLimit: 5120,
  },
}))
