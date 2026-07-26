import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app calls the backend at an absolute URL (see src/config.js), so there is
// no dev proxy here. Point at a local backend with:
//   VITE_BACKEND_URL=http://localhost:8000 npm run dev
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
