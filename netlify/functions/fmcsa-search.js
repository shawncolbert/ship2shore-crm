import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// FMCSA's public "Motor Carrier, Broker & Freight Forwarder" census data,
// mirrored on Socrata (data.transportation.gov). Free, no API key required
// -- SOCRATA_APP_TOKEN is optional and only raises the anonymous rate limit
// if pulls start getting throttled.
const SOCRATA_URL = 'https://data.transportation.gov/resource/az4n-8mr2.json'

// NOTE: these are FMCSA's documented census field names, but this function
// was written without live access to the dataset to confirm them against a
// real response (this environment's network is locked to an allowlist that
// doesn't include data.transportation.gov). The state filter (phy_state) is
// the one field virtually guaranteed correct. If a search errors with a
// Socrata "invalid column" message, or entity/cargo filtering silently
// returns nothing, that's the signal to open the URL below yourself and
// correct the field names here:
//   https://data.transportation.gov/resource/az4n-8mr2.json?$limit=3
const FIELDS = {
  dotNumber: 'dot_number',
  legalName: 'legal_name',
  dbaName: 'dba_name',
  phone: 'telephone',
  city: 'phy_city',
  state: 'phy_state',
  powerUnits: 'power_units',
  drivers: 'drivers',
  cargoClassification: 'cargo_carried',
}

// "Car haulers" aren't a distinct FMCSA entity type -- they're carriers who
// self-report "Motor Vehicles" as what they haul. Broker vs carrier isn't
// filtered here for the same reason: it's not confirmed which field (if any)
// distinguishes them in this specific resource, so entityType is applied as
// a soft label on the results (from whatever the row itself indicates)
// rather than a query filter that could silently zero out real results.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { state, companyName, cargoKeyword, limit = 50, offset = 0 } = payload
  if (!state && !companyName) return json(400, { error: 'Enter a state or a company name.' })

  const esc = (s) => String(s).replace(/'/g, "''")
  const where = []
  if (state) where.push(`upper(${FIELDS.state}) = upper('${esc(state)}')`)
  if (companyName) {
    where.push(`(upper(${FIELDS.legalName}) like upper('%${esc(companyName)}%') or upper(${FIELDS.dbaName}) like upper('%${esc(companyName)}%'))`)
  }
  if (cargoKeyword) {
    where.push(`${FIELDS.cargoClassification} like '%${esc(cargoKeyword)}%'`)
  }

  const pageSize = Math.min(Number(limit) || 50, 200)
  const params = new URLSearchParams({
    $where: where.join(' AND '),
    // One extra row requested so "did this page fill up" (== there's
    // probably a next page) can be read off the response length instead of
    // a separate $select=count(*) round trip.
    $limit: String(pageSize + 1),
    $offset: String(Math.max(Number(offset) || 0, 0)),
  })

  const headers = {}
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN

  let res, rows
  try {
    res = await fetch(`${SOCRATA_URL}?${params.toString()}`, { headers })
    rows = await res.json()
  } catch (e) {
    return json(502, { error: 'Could not reach the FMCSA data service: ' + (e.message || e) })
  }
  if (!res.ok) {
    // Socrata's error body usually names the bad column/value directly --
    // surfaced as-is since that's exactly what's needed to fix FIELDS above.
    return json(502, { error: 'FMCSA data service error', detail: rows })
  }

  const rawRows = Array.isArray(rows) ? rows : []
  const hasMore = rawRows.length > pageSize
  const leads = rawRows.slice(0, pageSize).map((r) => ({
    dotNumber: r[FIELDS.dotNumber] || '',
    legalName: r[FIELDS.legalName] || '',
    dbaName: r[FIELDS.dbaName] || '',
    phone: r[FIELDS.phone] || '',
    city: r[FIELDS.city] || '',
    state: r[FIELDS.state] || '',
    powerUnits: r[FIELDS.powerUnits] ? Number(r[FIELDS.powerUnits]) : null,
    drivers: r[FIELDS.drivers] ? Number(r[FIELDS.drivers]) : null,
    cargoClassification: r[FIELDS.cargoClassification] || '',
  })).filter((l) => l.dotNumber)

  return json(200, { leads, hasMore })
}
