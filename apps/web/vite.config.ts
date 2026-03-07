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
        // Worklet and other JS chunks must be .js (default). Production server must serve
        // /assets/* as static files only — do not serve index.html for /assets/* (no SPA fallback),
        // or addModule() will get HTML and throw "unexpected token: keyword 'class'".
        chunkFileNames: 'assets/[name]-[hash].js',
        // Emit worklet as .js so servers don't serve it as video/mp2t (MIME for .ts)
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? ''
          if (name.endsWith('.ts')) return 'assets/[name]-[hash].js'
          return 'assets/[name]-[hash][extname]'
        },
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Keep rnnoise-wasm inside the worklet chunk (return undefined). Else it goes to vendor
            // and the worklet's second request can 404→index.html → "unexpected token: keyword 'class'".
            if (id.includes('rnnoise-wasm')) return undefined
            if (id.includes('lucide-react')) return 'lucide'
            if (id.includes('@tauri-apps')) return 'tauri'
            if (id.includes('react-dom') || id.includes('react/') || id.includes('zustand')) return 'react'
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
