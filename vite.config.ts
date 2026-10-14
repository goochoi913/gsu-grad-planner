import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the app from https://goochoi913.github.io/gsu-grad-planner/, so every
// asset URL needs the repo prefix. Override with BASE_PATH when hosting elsewhere.
const base = process.env.BASE_PATH ?? '/gsu-grad-planner/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    // Installable on a phone's home screen. The service worker only caches the app
    // shell so it opens fast; the plan and the record always come from Firebase.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: "Eunbee's Grad Planner",
        short_name: 'Eunbee Planner',
        description: 'GSU Computer Science degree plan, Degree Works audit, GPA, and class schedule.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Seat counts refreshed every 30 minutes — always fetched, never cached (src/lib/live-schedule.ts).
        globIgnores: ['live/**'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    outDir: 'dist',
    // No source maps: the built site is published to a public repository, and a source map
    // would carry every file in src/ with it. `npm run dev` still has full maps.
    sourcemap: false,
    // The Spring 2027 schedule and the professors' ratings ship inside the main bundle (~440 kB of JSON).
    chunkSizeWarningLimit: 1600,
  },
})
