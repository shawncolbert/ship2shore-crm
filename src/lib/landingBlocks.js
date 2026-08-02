// Shared block-type metadata + helpers for the landing page canvas editor
// (LandingPageEditor.jsx) and the public renderer (LandingPagePublic.jsx),
// so a video URL is converted to an embeddable link identically in both
// places -- what you see while editing is what actually ships.

export const BLOCK_TYPES = [
  { value: 'hero', label: 'Hero', icon: '🏔' },
  { value: 'heading', label: 'Heading', icon: 'H' },
  { value: 'paragraph', label: 'Paragraph', icon: '¶' },
  { value: 'features', label: 'Services', icon: '▦' },
  { value: 'stats', label: 'Stats', icon: '★' },
  { value: 'testimonial', label: 'Quote', icon: '❝' },
  { value: 'image', label: 'Image', icon: '🖼' },
  { value: 'video', label: 'Video', icon: '▶' },
  { value: 'cta', label: 'Button', icon: '⬚' },
  { value: 'contact', label: 'Contact bar', icon: '☎' },
  { value: 'divider', label: 'Divider', icon: '—' },
  { value: 'spacer', label: 'Spacer', icon: '↕' },
]

// Blocks that span the full width of the page rather than sitting in the
// centred prose column. The renderer keys off this, so adding a full-bleed
// block type in future is a one-line change here.
export const FULL_BLEED = new Set(['hero', 'stats', 'contact', 'testimonial'])

export function newBlock(type) {
  const id = crypto.randomUUID()
  switch (type) {
    case 'hero':
      return { id, type, image: '', heading: '', subheading: '', ctaLabel: 'Get a Free Quote', ctaTarget: 'lead_form', eyebrow: '' }
    case 'heading': return { id, type, text: '' }
    case 'paragraph': return { id, type, text: '' }
    case 'features':
      return { id, type, title: '', items: [
        { icon: '✅', title: '', text: '' },
        { icon: '✅', title: '', text: '' },
        { icon: '✅', title: '', text: '' },
      ] }
    case 'stats':
      return { id, type, items: [
        { value: '', label: '' },
        { value: '', label: '' },
        { value: '', label: '' },
      ] }
    case 'testimonial': return { id, type, quote: '', author: '', role: '' }
    case 'image': return { id, type, url: '', alt: '' }
    case 'video': return { id, type, url: '' }
    case 'cta': return { id, type, label: 'Book Now', target: 'booking' }
    case 'contact': return { id, type, business: '', phone: '', email: '', area: '' }
    case 'divider': return { id, type }
    case 'spacer': return { id, type, size: 'md' }
    default: return { id, type: 'paragraph', text: '' }
  }
}

// Accepts a normal YouTube/Vimeo watch/share URL and returns an embeddable
// iframe src, so the user just pastes the link they'd naturally copy.
export function toEmbedUrl(raw) {
  const url = String(raw || '').trim()
  if (!url) return null
  try {
    const u = new URL(url)
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get('v')) {
      return `https://www.youtube.com/embed/${u.searchParams.get('v')}`
    }
    if (u.hostname === 'youtu.be') {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`
    }
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.pathname.startsWith('/embed/')) {
      return url
    }
    if (/(^|\.)vimeo\.com$/.test(u.hostname)) {
      const id = u.pathname.split('/').filter(Boolean).pop()
      return id ? `https://player.vimeo.com/video/${id}` : null
    }
  } catch {
    return null
  }
  return null
}

export const SPACER_SIZES = { sm: 16, md: 40, lg: 80 }
