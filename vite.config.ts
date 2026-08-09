import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Belt-and-suspenders: Vite's default env-loading directory is `process.cwd()` at the time
  // the `vite` process starts, which happened to already be correct in this project's launch
  // chain — but pinning `envDir` explicitly to this config file's own directory means `.env`
  // loading can never silently break just because *something* upstream changes cwd before
  // spawning `vite` (a nested `npm --prefix`, a different launcher, a future refactor of
  // `dev:full`). Cheap to set, nothing to lose.
  //
  // NOTE: this was NOT the actual cause of a real bug hunted down in this codebase — that one
  // was `import.meta.env` access written as `const meta = import.meta; meta.env` instead of the
  // direct literal `import.meta.env.KEY` — see the comment on `resolveEnvSource` in
  // `services/ai/runtime/harnessConfig.ts` for the full story and why it silently produced an
  // "AI not configured" offline mode despite a real, correct `VITE_AI_TRANSPORT=server` in `.env`.
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Krishi Mitra',
        short_name: 'KrishiMitra',
        description: 'AI Farm Decision Support for Indian Farmers',
        theme_color: '#15803d',
        background_color: '#f0fdf4',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}']
      }
    })
  ],
  resolve: {
    alias: { '@': '/src' }
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    // Mirrors production's single-origin setup (server/ serves both the API and the built SPA)
    // so VITE_AI_TRANSPORT=server works the same in local dev as it does deployed. `npm run
    // dev:full` (root package.json) starts this AND the backend together; plain `npm run dev`
    // only starts this half, and every /api/* call resolves through the proxy below.
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        // Without this, a refused connection (backend not running) surfaces to the browser as a
        // raw 500 with no body — indistinguishable from a real server crash. Every /api/* client
        // in this app (services/voice/sarvamClient.ts, services/ai/transport/ServerProxyTransport.ts,
        // etc.) already treats a non-2xx response as "feature unavailable, degrade gracefully" —
        // this just makes "the backend process isn't running" degrade through that exact same
        // path instead of looking like an unhandled crash.
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if ('writeHead' in res && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' })
            }
            res.end(JSON.stringify({ error: 'Backend not running. Start it with: npm run dev:full (or cd server && npm run dev).' }))
          })
        },
      },
    },
  }
})
