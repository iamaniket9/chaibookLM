import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Use Render backend in dev mode; switch to localhost for local backend
const BACKEND_URL = process.env.VITE_BACKEND_URL || 'https://chaibooklm.onrender.com'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/uploads': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    }
  }
})
