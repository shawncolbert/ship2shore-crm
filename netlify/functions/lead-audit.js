import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { askClaude } from './_shared/anthropic.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// Blocks the obvious SSRF targets (localhost, link-local/cloud-metadata,
// private ranges) before this server-side function fetches a user-supplied
// URL. Hostname-literal check only -- doesn't resolve DNS to catch a public
// hostname rebound to a private IP, but that's an acceptable trade-off here
// since this endpoint requires an authenticated org member, not the public.
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local')) return true
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  return false
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
// Regex-shaped false positives that show up constantly in raw HTML/markdown:
// responsive image filenames (logo@2x.png), tracking/CDN boilerplate, and
// obvious placeholder addresses from a site's own template.
const JUNK_SUFFIX = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot)$/i
const JUNK_DOMAINS = ['sentry.io', 'wixpress.com', 'schema.org', 'w3.org', 'example.com', 'godaddy.com', 'sentry-cdn.com']

// Pulled from the RAW fetched content (HTML or markdown), not the
// tag-stripped text used for Claude's prompt -- a mailto: link's address
// usually only exists in the href attribute, not the visible link text, so
// extracting after stripping tags would silently lose it.
function extractEmails(raw) {
  const found = (raw.match(EMAIL_RE) || [])
    .map((e) => e.toLowerCase())
    .filter((e) => !JUNK_SUFFIX.test(e))
    .filter((e) => !JUNK_DOMAINS.some((d) => e.endsWith(`@${d}`) || e.includes(`.${d}`)))
  return [...new Set(found)].slice(0, 5)
}

// Best-effort only: a homepage often has no email at all, while a Contact
// page usually does. Plain fetch regardless of Firecrawl config -- these are
// simple static pages even on an otherwise JS-heavy site, not worth the
// extra Firecrawl call. Failures here are silent; this is a bonus pass, not
// the primary path.
async function tryContactPageEmails(baseUrl) {
  for (const p of ['/contact', '/contact-us', '/contactus', '/about']) {
    try {
      const u = new URL(p, baseUrl).toString()
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFinderBot/1.0)' } })
      if (!res.ok) continue
      const found = extractEmails(await res.text())
      if (found.length) return found
    } catch {
      // best-effort only
    }
  }
  return []
}

// Firecrawl handles JS-heavy/protected sites much better than a plain fetch,
// but it's optional -- FIRECRAWL_API_KEY unset just falls back to fetching
// the raw HTML directly, which is enough for most small trucking company
// sites (plain server-rendered pages, no client-side framework).
async function scrapeSite(url) {
  if (process.env.FIRECRAWL_API_KEY) {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({ url, formats: ['markdown'] }),
    })
    const data = await res.json()
    if (res.status === 429) {
      throw new Error("Firecrawl's rate limit was hit. Wait a bit before trying again, or raise your limit at firecrawl.dev (Dashboard → Settings → Plan).")
    }
    if (!res.ok) throw new Error('Firecrawl error: ' + JSON.stringify(data))
    const markdown = data?.data?.markdown || ''
    return { text: markdown.slice(0, 8000), emails: extractEmails(markdown) }
  }

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFinderBot/1.0)' } })
  if (!res.ok) throw new Error(`Could not fetch ${url} (status ${res.status})`)
  const html = await res.text()
  const emails = extractEmails(html)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000)
  return { text, emails }
}

const SYSTEM_PROMPT = `You are a freight operations specialist reviewing a trucking/logistics company's
website ahead of a cold outreach call. Given the page text, identify 2-4 concrete operational
weaknesses visible on the site (e.g. no online quote form, no dispatch tracking, outdated mobile
layout, no mention of port/TWIC/escort services, no clear service area). Then draft a short,
specific 3-sentence cold outreach email that references one of those weaknesses naturally, offers
a relevant service, and asks for a quick call. Do not invent facts not supported by the page text.

Respond with ONLY valid JSON, no other text, in this exact shape:
{"bottlenecks": ["...", "..."], "pitchEmail": "..."}`

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { websiteUrl, companyName } = payload
  if (!websiteUrl) return json(400, { error: 'A website URL is required.' })

  const url = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`

  let parsedUrl
  try { parsedUrl = new URL(url) } catch { return json(400, { error: 'That doesn\'t look like a valid URL.' }) }
  if (isBlockedHost(parsedUrl.hostname)) return json(400, { error: 'That host isn\'t allowed.' })

  let scraped
  try {
    scraped = await scrapeSite(url)
  } catch (e) {
    return json(502, { error: 'Could not read that website: ' + (e.message || e) })
  }
  if (!scraped.text) return json(502, { error: 'That page came back empty -- nothing to analyze.' })

  let emails = scraped.emails
  if (!emails.length) {
    emails = await tryContactPageEmails(url)
  }

  let raw
  try {
    raw = await askClaude({
      system: SYSTEM_PROMPT,
      prompt: `Company: ${companyName || 'Unknown'}\nWebsite: ${url}\n\nPage text:\n${scraped.text}`,
      maxTokens: 700,
    })
  } catch (e) {
    return json(502, { error: 'Claude request failed: ' + (e.message || e) })
  }

  let parsed
  try {
    parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''))
  } catch {
    // Claude didn't return clean JSON -- surface the raw text as the pitch
    // rather than failing outright, since it's still usable.
    parsed = { bottlenecks: [], pitchEmail: raw }
  }

  return json(200, {
    bottlenecks: Array.isArray(parsed.bottlenecks) ? parsed.bottlenecks : [],
    pitchEmail: parsed.pitchEmail || '',
    emails,
  })
}
