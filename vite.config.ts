import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Where the dev server forwards API and SignalR traffic when VITE_API_URL is empty (same-origin mode).
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:5024'

  return {
    plugins: [react()],
    server: {
      // Same-origin API in development: the browser only ever talks to this server, so the app also works
      // through a single HTTPS tunnel (e.g. ngrok) with no CORS or mixed-content problems.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/hubs': { target: apiTarget, changeOrigin: true, ws: true },
      },
      // Vite rejects unknown Host headers; allow ngrok tunnel domains for testing on other devices.
      allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'],
    },
  }
})
