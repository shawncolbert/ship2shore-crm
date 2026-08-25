import { admin } from './_shared/supabaseAdmin.js'

// Same fix as card-preview.js, for landing pages -- when a landing page
// slug (e.g. /pages/transport) gets posted on social or texted out, link
// previews were reading the raw static shell ("Ship2Shore Dispatch", no
// description) since this is a client-rendered SPA. Splices in the real
// page title and a marketing description before serving.

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const handler = async (event) => {
  const host = event.headers.host
  const proto = event.headers['x-forwarded-proto'] || 'https'
  const origin = `${proto}://${host}`
  const slug = event.queryStringParameters?.slug || event.path.split('/pages/')[1]?.split('?')[0] || ''

  let shell
  try {
    const shellRes = await fetch(`${origin}/index.html`)
    shell = await shellRes.text()
  } catch {
    return { statusCode: 302, headers: { Location: `/pages/${slug}` } }
  }

  const { data: page } = await admin
    .from('landing_pages')
    .select('title, meta_description, schema_json, published')
    .eq('slug', String(slug).trim())
    .maybeSingle()

  if (!page || !page.published) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: shell }
  }

  const pageTitle = page.title || 'Get a Transport Quote'
  const description = page.meta_description || 'Get an instant vehicle transport quote — pickup and delivery across California and the lower 48.'
  const url = `${origin}/pages/${slug}`

  const metaTags = [
    `<meta name="description" content="${esc(description)}" />`,
    `<meta property="og:title" content="${esc(pageTitle)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="theme-color" content="#0c1a24" />`,
  ]
  // Structured data has to be in the raw HTML a crawler's first fetch sees --
  // this route is served straight from this function (see public/_redirects),
  // so a script tag rendered client-side by the React blocks would arrive too
  // late for a crawler that doesn't run JS. page.schema_json is trusted
  // (org-authored, same as the rest of the page), so it's inlined as-is.
  if (page.schema_json) {
    metaTags.push(`<script type="application/ld+json">${page.schema_json}</script>`)
  }

  shell = shell
    .replace(/<title>.*?<\/title>/, `<title>${esc(pageTitle)}</title>`)
    .replace('</head>', `    ${metaTags.join('\n    ')}\n  </head>`)

  return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: shell }
}
