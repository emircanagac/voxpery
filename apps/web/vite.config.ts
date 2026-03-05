import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  envDir: '../../',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
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
})
