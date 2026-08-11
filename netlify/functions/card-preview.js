import { admin } from './_shared/supabaseAdmin.js'

// Link-preview generators (iMessage, SMS apps, WhatsApp, etc.) fetch the raw
// HTML for a shared URL and read its <head> meta tags -- they never run the
// app's JavaScript. Since this is a client-rendered SPA, every route was
// serving the same static index.html ("Ship2Shore Dispatch", no image), so
// every driver's card looked identical (and generic) in a text-message
// preview. This intercepts /card/:slug, fetches that card's real info, and
// serves the site's actual built HTML shell with per-card <title>/OG tags
// spliced in -- real browsers still get the full interactive React app
// once it loads, this only changes what a preview-only fetch sees.

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const handler = async (event) => {
  const host = event.headers.host
  const proto = event.headers['x-forwarded-proto'] || 'https'
  const origin = `${proto}://${host}`
  const slug = event.queryStringParameters?.slug || event.path.split('/card/')[1]?.split('?')[0] || ''

  let shell
  try {
    const shellRes = await fetch(`${origin}/index.html`)
    shell = await shellRes.text()
  } catch {
    // If the self-fetch ever fails, fail open to a bare redirect rather
    // than a broken response -- the SPA still loads fine, just without
    // the injected preview tags for this one request.
    return { statusCode: 302, headers: { Location: `/card/${slug}` } }
  }

  const { data: card } = await admin
    .from('business_cards')
    .select('full_name, title, company_line, brand_name, brand_logo_url, primary_bg, is_published')
    .eq('slug', String(slug).trim())
    .maybeSingle()

  if (!card || !card.is_published) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: shell }
  }

  const pageTitle = card.full_name || card.brand_name || 'Digital Business Card'
  const description = [card.title, card.company_line].filter(Boolean).join(' · ') || 'View my digital business card'
  const url = `${origin}/card/${slug}`

  const metaTags = [
    `<meta property="og:title" content="${esc(pageTitle)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:type" content="profile" />`,
    card.brand_logo_url ? `<meta property="og:image" content="${esc(card.brand_logo_url)}" />` : '',
    `<meta name="twitter:card" content="${card.brand_logo_url ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="theme-color" content="${esc(card.primary_bg || '#0c1a24')}" />`,
  ].filter(Boolean).join('\n    ')

  shell = shell
    .replace(/<title>.*?<\/title>/, `<title>${esc(pageTitle)}</title>`)
    .replace('</head>', `    ${metaTags}\n  </head>`)

  return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: shell }
}
