import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// White-labeling, 2026-09-04: this whole app is one shared codebase built
// separately per client (a separate Netlify site per org, each with its own
// domain + these env vars set in Netlify -> Site settings -> Environment).
// Nothing here changes what the code DOES for a client -- only what the
// browser tab, "Add to Home Screen" icon, and PWA install prompt call it.
// Unset in Netlify (or running `npm run dev` locally), every value falls
// back to Ship2Shore's own -- today's production site needs zero new env
// vars to keep working exactly as it does now. Icons themselves aren't
// covered here (binary files can't come from an env var) -- swap the PNGs
// under public/icons/ before building a new client's site if they need
// their own icon; see README -> "Setting up a new client's own site".
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appName = env.VITE_APP_NAME || 'Ship2Shore Dispatch'
  const appShortName = env.VITE_APP_SHORT_NAME || 'Ship2Shore'
  const appDescription = env.VITE_APP_DESCRIPTION || 'Ship2Shore dispatch CRM — pipeline, contacts, invoices, and calendar.'
  const themeColor = env.VITE_APP_THEME_COLOR || '#111f3a'

  // Vite's built-in %ENV_NAME% HTML interpolation only fills in a
  // placeholder when that exact var is actually set -- an unset one (e.g.
  // this repo's own production site, which sets none of these) is left as
  // the literal string "%VITE_APP_NAME%" in the shipped page. Doing the
  // substitution by hand here instead means the same computed
  // fallback-or-override value above always lands in the HTML.
  const htmlBranding = {
    name: 'html-branding',
    transformIndexHtml(html) {
      return html
        .replaceAll('%VITE_APP_NAME%', appName)
        .replaceAll('%VITE_APP_SHORT_NAME%', appShortName)
        .replaceAll('%VITE_APP_THEME_COLOR%', themeColor)
    },
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      htmlBranding,
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
          name: appName,
          short_name: appShortName,
          description: appDescription,
          start_url: '/',
          display: 'standalone',
          // Matches the CRM's own dark sidebar/ink background so the OS
          // splash screen doesn't flash white before the app paints.
          background_color: '#0b1526',
          theme_color: themeColor,
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
  }
})
