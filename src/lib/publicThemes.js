// Accent theme for public-facing pages (landing pages, funnels) -- separate
// from src/lib/theme.js, which skins the internal CRM dashboard. Public
// pages have no session and no <html data-mode/data-preset>, so they carry
// their own self-contained palette rather than reading the app's :root
// tokens. Same 6 keys as the CRM presets for a consistent naming family,
// but nothing else ties the two systems together.
//
// `accentText` is picked per-color for contrast: amber is light enough to
// pair with dark navy text, the rest are saturated enough to need white.

export const PUBLIC_THEMES = [
  { key: 'classic', label: 'Classic Amber', accent: '#e8a317', accentText: '#0c2231' },
  { key: 'ocean', label: 'Ocean Blue', accent: '#2f8fd6', accentText: '#ffffff' },
  { key: 'crimson', label: 'Crimson', accent: '#c1440e', accentText: '#ffffff' },
  { key: 'forest', label: 'Forest Teal', accent: '#0f8b8d', accentText: '#ffffff' },
  { key: 'aurora', label: 'Aurora', accent: '#b23a9e', accentText: '#ffffff' },
  { key: 'slate', label: 'Slate', accent: '#4b5b66', accentText: '#ffffff' },
]

// The dark navy used for hero gradients, stats bands, and footers -- stays
// fixed across every preset (brand chrome), only the accent color changes.
// Same value as the CRM's --color-brand, kept as a literal here since these
// pages don't load the CRM's CSS tokens.
export const PUBLIC_INK = '#0c2231'

export function getPublicTheme(key) {
  return PUBLIC_THEMES.find((t) => t.key === key) || PUBLIC_THEMES[0]
}

// A ~13% tint of the accent, for soft backgrounds (e.g. a "message sent"
// confirmation box) that need to read as "this theme's color" without a
// solid fill. Hex + 2-digit alpha suffix works in every modern browser.
export function accentTint(hex) {
  return `${hex}22`
}
