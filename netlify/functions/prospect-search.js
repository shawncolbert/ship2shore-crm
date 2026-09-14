import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

const MAX_RESULTS = 20

// Best-effort split of Places' one-line formattedAddress ("123 Main St,
// Long Beach, CA 90802, USA") into city/state, to match prospects' own
// separate columns. Falls through to nulls rather than guessing wrong --
// the full address stays in `audit_score` either way for reference.
function splitCityState(formattedAddress) {
  const m = String(formattedAddress || '').match(/,\s*([^,]+?),\s*([A-Z]{2})\s+\d{5}/)
  return m ? { city: m[1].trim(), state: m[2] } : { city: null, state: null }
}

// Phase 2 of Prospecting & Outreach: finds real local businesses by
// industry + location via Google's Places API (New), scored only on
// public signals (has a website? rating? review count?) -- never scrapes
// a personal profile or social account. Deliberately does NOT return
// email addresses -- Places doesn't expose them, by design, so a human
// still has to look one up before a prospect can be enrolled in an email
// sequence. One platform-wide GOOGLE_PLACES_API_KEY (not per-org) since
// this is metered, billed API usage Shawn is covering himself, same as
// any other platform-level cost.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return json(500, { error: 'Business search isn’t set up yet -- ask your platform admin to add a Google Places API key.' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { industry, location } = payload
  if (!industry?.trim() || !location?.trim()) return json(400, { error: 'Missing industry or location' })

  const textQuery = `${industry.trim()} in ${location.trim()}`

  let res
  try {
    res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.displayName', 'places.formattedAddress', 'places.websiteUri',
          'places.nationalPhoneNumber', 'places.rating', 'places.userRatingCount',
        ].join(','),
      },
      body: JSON.stringify({ textQuery, maxResultCount: MAX_RESULTS }),
    })
  } catch (e) {
    return json(502, { error: 'Could not reach Google Places: ' + e.message })
  }
  if (!res.ok) return json(502, { error: 'Places search failed: ' + (await res.text().catch(() => res.statusText)) })

  const data = await res.json()
  const results = (data.places || []).map((p) => {
    const { city, state } = splitCityState(p.formattedAddress)
    return {
      business_name: p.displayName?.text || 'Unnamed business',
      address: p.formattedAddress || null,
      city, state,
      website: p.websiteUri || null,
      phone: p.nationalPhoneNumber || null,
      rating: p.rating ?? null,
      review_count: p.userRatingCount ?? 0,
      audit_score: {
        has_website: !!p.websiteUri,
        rating: p.rating ?? null,
        review_count: p.userRatingCount ?? 0,
        formatted_address: p.formattedAddress || null,
        checked_at: new Date().toISOString(),
      },
    }
  })

  return json(200, { results })
}
