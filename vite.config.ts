import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A small proxy block is included for when real Steam data is wired up later.
// The Steam Web API has no CORS headers, so calls must go through a backend.
export default defineConfig({
  plugins: [react()],
  server: {
    // Honor PORT when set (e.g. the Claude preview runner assigns a free port so
    // it never collides with a dev server already on 5173); default otherwise.
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
