// Per-org CRM dashboard appearance -- dark/light mode plus one of 6 accent
// presets, set on <html data-mode data-preset> so index.css's attribute
// selectors take over the --color-* tokens app-wide. Independent of the
// landing-page/funnel template system (that's a separate feature).

export const THEME_MODES = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
]

// `swatch` is the accent color shown in the picker; `label`/`description`
// help an org pick something that fits their business, per Shawn's ask.
export const THEME_PRESETS = [
  { key: 'classic', label: 'Classic Amber', swatch: '#e8a317', description: "Ship2Shore's original look." },
  { key: 'ocean', label: 'Ocean Blue', swatch: '#2f8fd6', description: 'Trusted, corporate -- freight, logistics.' },
  { key: 'crimson', label: 'Crimson', swatch: '#c1440e', description: 'Bold, urgent -- dispatch, emergency services.' },
  { key: 'forest', label: 'Forest Teal', swatch: '#0f8b8d', description: 'Calm, grounded -- marine, environmental.' },
  { key: 'aurora', label: 'Aurora', swatch: '#b23a9e', description: 'Bold, creative -- photography, events.' },
  { key: 'slate', label: 'Slate', swatch: '#4b5b66', description: 'Minimal, neutral -- consulting, admin.' },
]

const CACHE_KEY = 's2s_theme'

// Sets <html data-mode data-preset>, which index.css's attribute selectors
// key off of. Called both from the synchronous pre-render bootstrap (cached
// value, avoids a flash of the wrong theme on load) and after the org's
// real row loads (in case the cache was stale or this is a new device).
export function applyTheme(mode, preset) {
  const root = document.documentElement
  if (mode === 'dark') root.setAttribute('data-mode', 'dark')
  else root.removeAttribute('data-mode')

  if (preset && preset !== 'classic') root.setAttribute('data-preset', preset)
  else root.removeAttribute('data-preset')
}

// Read once, synchronously, before React mounts -- keeps a returning user's
// dashboard from flashing light-classic for a frame while the org loads.
export function bootstrapTheme() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (cached) applyTheme(cached.mode, cached.preset)
  } catch {
    // Corrupt cache -- ignore, default (light/classic) is already correct.
  }
}

export function cacheTheme(mode, preset) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ mode, preset }))
  } catch {
    // Storage unavailable (private mode, quota) -- theme still applies,
    // just re-fetched from the org row on next load instead of cached.
  }
}
