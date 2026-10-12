import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// App icons for the home screen, generated from public/pwa-source.svg (npm run icons).
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.1, resizeOptions: { background: '#0a0a0a' } },
    apple: { ...minimal2023Preset.apple, padding: 0.04, resizeOptions: { background: '#0a0a0a' } },
  },
  images: ['public/pwa-source.svg'],
})
