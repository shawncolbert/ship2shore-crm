import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// Finds a company's own website and social media presence from just its
// name, via Firecrawl's search endpoint -- fills the gap FMCSA leaves
// (their data has no website/email/social fields at all). Feeds straight
// into lead-audit.js: once a website turns up here, the existing "Audit &
// draft pitch" step reads that URL for emails and a personalized pitch.
//
// NOTE: the /v1/search request/response shape below is Firecrawl's
// documented API from training knowledge, not confirmed against a live
// call -- same caveat as the FMCSA integrations, and for the same reason
// (this sandbox can't reach docs.firecrawl.dev or api.firecrawl.dev to
// verify). If this comes back with an unexpected error or consistently
// empty results even for a company with an obvious web presence, check
// the actual response shape against Firecrawl's current docs and adjust
// the `data` unwrapping / field names below.
const SEARCH_URL = 'https://api.firecrawl.dev/v1/search'

// Domains that routinely outrank a small trucking company's own site for a
// plain name search, but aren't the company itself -- filtered out of the
// "official website" guess so it doesn't come back as, say, their BBB
// listing. Social platforms are excluded here too since those are handled
// as their own separate, targeted searches below.
const EXCLUDED_WEBSITE_DOMAINS = [
  'facebook.com', 'instagram.com', 'tiktok.com', 'linkedin.com', 'twitter.com', 'x.com',
  'yelp.com', 'bbb.org', 'dnb.com', 'mapquest.com', 'yellowpages.com', 'manta.com',
  'buzzfile.com', 'dat.com', 'fmcsa.dot.gov', 'safersys.org', 'saferwatch.com', 'carrier411.com',
  'glassdoor.com', 'indeed.com', 'bloomberg.com', 'zoominfo.com', 'google.com', 'bing.com',
  'wikipedia.org', 'youtube.com',
]

async function firecrawlSearch(query, limit) {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY not configured')
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, limit }),
  })
  const data = await res.json().catch(() => null)
  if (res.status === 429) {
    throw new Error("Firecrawl's rate limit was hit. Wait a bit before trying again, or raise your limit at firecrawl.dev (Dashboard → Settings → Plan).")
  }
  if (!res.ok) throw new Error('Firecrawl search error: ' + JSON.stringify(data))
  return Array.isArray(data?.data) ? data.data : []
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function firstOwnSite(results) {
  for (const r of results) {
    const host = hostnameOf(r.url)
    if (host && !EXCLUDED_WEBSITE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return r.url
  }
  return null
}

function firstFromDomain(results, domain) {
  for (const r of results) {
    const host = hostnameOf(r.url)
    if (host === domain || host.endsWith(`.${domain}`)) return r.url
  }
  return null
}

const SOCIAL_DOMAINS = { facebook: 'facebook.com', instagram: 'instagram.com', tiktok: 'tiktok.com', linkedin: 'linkedin.com' }

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { companyName, city, state } = payload
  if (!companyName?.trim()) return json(400, { error: 'A company name is required.' })

  const location = [city, state].filter(Boolean).join(' ')
  const named = `"${companyName.trim()}"${location ? ` ${location}` : ''}`

  let websiteResults, socialResults
  try {
    // Two searches, not five -- one for the company's own site, and ONE
    // combined query for all four social platforms at once (OR'd site:
    // filters), instead of a separate call per platform. That was burning
    // 5 Firecrawl calls per click and hitting free-tier rate limits after
    // just a couple of lookups; this cuts it to 2.
    [websiteResults, socialResults] = await Promise.all([
      firecrawlSearch(`${named} trucking company official website`, 5),
      firecrawlSearch(`${named} (site:facebook.com OR site:instagram.com OR site:tiktok.com OR site:linkedin.com)`, 10),
    ])
  } catch (e) {
    return json(502, { error: e.message || 'Could not search for this company.' })
  }

  const social = {}
  for (const [key, domain] of Object.entries(SOCIAL_DOMAINS)) {
    social[key] = firstFromDomain(socialResults, domain)
  }

  return json(200, {
    website: firstOwnSite(websiteResults),
    social,
  })
}
