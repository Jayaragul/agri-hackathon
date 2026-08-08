import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { geminiDevApiPlugin } from './server/geminiDevApiPlugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
  plugins: [
    react(),
    geminiDevApiPlugin({
      apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
      model: env.GEMINI_MODEL,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['thulir-logo.png', 'thulir-logo-192.png', 'thulir-logo-512.png'],
      manifest: {
        name: 'Thulir',
        short_name: 'Thulir',
        description: 'AI Farm Decision Support for Indian Farmers',
        theme_color: '#4285F4',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/thulir-logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/thulir-logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
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
  server: { port: 5173 }
  }
})
