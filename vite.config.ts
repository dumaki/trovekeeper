import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A small proxy block is included for when real Steam data is wired up later.
// The Steam Web API has no CORS headers, so calls must go through a backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
