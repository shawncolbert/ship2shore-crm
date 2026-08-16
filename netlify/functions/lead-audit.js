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

// Firecrawl handles JS-heavy/protected sites much better than a plain fetch,
// but it's optional -- FIRECRAWL_API_KEY unset just falls back to fetching
// the raw HTML and stripping tags, which is enough for most small trucking
// company sites (plain server-rendered pages, no client-side framework).
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
    if (!res.ok) throw new Error('Firecrawl error: ' + JSON.stringify(data))
    return (data?.data?.markdown || '').slice(0, 8000)
  }

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadFinderBot/1.0)' } })
  if (!res.ok) throw new Error(`Could not fetch ${url} (status ${res.status})`)
  const html = await res.text()
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000)
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

  let pageText
  try {
    pageText = await scrapeSite(url)
  } catch (e) {
    return json(502, { error: 'Could not read that website: ' + (e.message || e) })
  }
  if (!pageText) return json(502, { error: 'That page came back empty -- nothing to analyze.' })

  let raw
  try {
    raw = await askClaude({
      system: SYSTEM_PROMPT,
      prompt: `Company: ${companyName || 'Unknown'}\nWebsite: ${url}\n\nPage text:\n${pageText}`,
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
  })
}
