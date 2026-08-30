import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-32.png'],
      // injectManifest (a custom src/sw.js) instead of the default
      // generateSW -- generateSW builds the whole service worker for you
      // but leaves no room to add our own push/notificationclick handlers,
      // which the "ping my phone on a new/unfollowed lead" feature needs.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      manifest: {
        name: 'Ship2Shore Dispatch',
        short_name: 'Ship2Shore',
        description: 'Ship2Shore dispatch CRM — pipeline, contacts, invoices, and calendar.',
        start_url: '/',
        display: 'standalone',
        // Matches the CRM's own dark sidebar/ink background so the OS
        // splash screen doesn't flash white before the app paints.
        background_color: '#0b1526',
        theme_color: '#111f3a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
