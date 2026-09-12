import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// VesselAPI's free tier (150 requests/month, no card required) -- plenty
// for a business that adds a handful of new vessels a month, unlike
// Datalastic's cheapest real plan (~$200+/mo) for the same lookup.
// https://vesselapi.com/docs/vessels
const SEARCH_URL = 'https://api.vesselapi.com/v1/search/vessels'

// Settings > Vessels calls this the moment a dispatcher tabs off the
// "Vessel name" field with no MMSI typed yet -- this is what makes that
// automatic instead of asking Claude to look it up by hand every time.
// A common name (this business's own MAHO is a real example) can match
// several real ships worldwide, so this returns candidates for the
// dispatcher to pick from rather than silently guessing the wrong one.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const name = (payload.name || '').trim()
  if (!name) return json(400, { error: 'Vessel name is required.' })

  const apiKey = process.env.VESSELAPI_KEY
  if (!apiKey) return json(200, { matches: [], configured: false })

  let res, data
  try {
    const url = `${SEARCH_URL}?${new URLSearchParams({ 'filter.name': name })}`
    res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    data = await res.json()
  } catch (e) {
    return json(502, { error: 'Could not reach VesselAPI: ' + (e.message || e) })
  }
  if (!res.ok) return json(502, { error: 'VesselAPI error', detail: data })

  const matches = (data.vessels || [])
    .filter((v) => v.mmsi)
    .slice(0, 8)
    .map((v) => ({ name: v.name || name, mmsi: String(v.mmsi), imo: v.imo || null, flag: v.flag || v.country_iso || null }))

  return json(200, { matches, configured: true })
}
