import { admin } from './_shared/supabaseAdmin.js'

// A real, always-current sitemap for the landing pages built in Settings >
// Landing Pages (the /pages/:slug ones) -- these had NO sitemap entry
// anywhere and nothing on the public site links to them, so Google had no
// way to discover them at all ("URL is unknown to Google" in Search
// Console). Scoped to ORG_ID specifically: this site's Search Console
// property (sc-domain:ship2shorebooking.com) covers every subdomain, so a
// sitemap served from here is valid for Google to use, but it should only
// ever list this org's own pages, not another org's on a shared codebase.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;')

export const handler = async (event) => {
  const host = event.headers.host
  const proto = event.headers['x-forwarded-proto'] || 'https'
  const origin = `${proto}://${host}`

  const { data: pages, error } = await admin
    .from('landing_pages')
    .select('slug, updated_at')
    .eq('org_id', process.env.ORG_ID)
    .eq('published', true)
    .order('updated_at', { ascending: false })

  if (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Could not build sitemap: ' + error.message }
  }

  const urls = (pages || []).map((p) => `  <url>
    <loc>${esc(origin)}/pages/${esc(p.slug)}</loc>
    <lastmod>${new Date(p.updated_at).toISOString().slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
  </url>`).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`

  return { statusCode: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8' }, body: xml }
}
