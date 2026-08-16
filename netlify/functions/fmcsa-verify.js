import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// FMCSA's official QCMobile API -- built for exactly this (single-company
// DOT/MC lookups with live operating-authority status), unlike the bulk
// census file fmcsa-search.js uses for state-wide lead searches. That file
// is a plain open-data mirror with no distinction between "has no MC
// number" and "MC number isn't in this dataset" -- QCMobile is FMCSA's own
// system of record for operating authority, so it actually knows the
// difference.
//
// NOTE: endpoint paths and response field names below are FMCSA's
// documented QCMobile shape from training knowledge, not confirmed against
// a live response -- same caveat as fmcsa-search.js, for the same reason
// (this environment can't reach mobile.fmcsa.dot.gov to verify). If a
// lookup 404s unexpectedly or a field comes back undefined that clearly
// exists in FMCSA's own Company Snapshot for that DOT #, this is the file
// to fix.
const BASE = 'https://mobile.fmcsa.dot.gov/qc/services'

async function fmcsaGet(path) {
  const webKey = process.env.FMCSA_WEBKEY
  if (!webKey) throw new Error('FMCSA_WEBKEY not configured')
  const res = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}webKey=${encodeURIComponent(webKey)}`)
  if (res.status === 404) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`FMCSA API error (${res.status}): ${JSON.stringify(data)}`)
  return data
}

function mapCarrier(c) {
  if (!c) return null
  return {
    dotNumber: c.dotNumber != null ? String(c.dotNumber) : '',
    legalName: c.legalName || '',
    dbaName: c.dbaName || '',
    phone: c.telephone || '',
    city: c.phyCity || '',
    state: c.phyState || '',
    powerUnits: c.totalPowerUnits != null ? Number(c.totalPowerUnits) : null,
    drivers: c.totalDrivers != null ? Number(c.totalDrivers) : null,
    allowedToOperate: c.allowedToOperate === 'Y',
    commonAuthority: c.commonAuthorityStatus || '',
    contractAuthority: c.contractAuthorityStatus || '',
    brokerAuthority: c.brokerAuthorityStatus || '',
  }
}

// The docket-numbers sub-resource is the part with the least-certain field
// names -- tries several plausible keys per entry rather than committing to
// one guess.
function extractMcNumbers(entries) {
  if (!Array.isArray(entries)) return []
  return entries
    .map((e) => e.mcMxFfNumber || e.docketNumber || e.mcNumber || (e.prefix && e.docketNum ? `${e.prefix}${e.docketNum}` : null))
    .filter(Boolean)
}

async function lookupByDot(dotNumber) {
  const detail = await fmcsaGet(`/carriers/${encodeURIComponent(dotNumber)}`)
  const carrier = mapCarrier(detail?.content?.carrier || detail?.content)
  if (!carrier) return null
  let mcNumbers = []
  try {
    const dockets = await fmcsaGet(`/carriers/${encodeURIComponent(dotNumber)}/docket-numbers`)
    mcNumbers = extractMcNumbers(dockets?.content)
  } catch {
    // best-effort only -- a carrier can legitimately have zero MC numbers
    // (private carriers, some exempt-commodity haulers don't need for-hire
    // operating authority), and a failed sub-lookup shouldn't sink the
    // whole result.
  }
  return { ...carrier, mcNumbers }
}

async function lookupByMc(mcNumber) {
  const clean = String(mcNumber).trim().replace(/^mc-?/i, '')
  const result = await fmcsaGet(`/carriers/docket-number/${encodeURIComponent(clean)}`)
  const entries = Array.isArray(result?.content) ? result.content : (result?.content ? [result.content] : [])
  const first = entries[0]?.carrier || entries[0]
  if (!first?.dotNumber) return null
  // Re-fetch by DOT for the fullest, most reliable field set (this
  // endpoint's carrier object may be a thinner projection than /carriers/{dot}).
  return lookupByDot(first.dotNumber)
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { dotNumber, mcNumber } = payload
  if (!dotNumber && !mcNumber) return json(400, { error: 'Enter a DOT number or an MC number.' })

  let carrier
  try {
    carrier = dotNumber ? await lookupByDot(dotNumber) : await lookupByMc(mcNumber)
  } catch (e) {
    return json(502, { error: e.message || 'Could not reach the FMCSA lookup service.' })
  }
  if (!carrier) return json(200, { carrier: null })

  // If both numbers were given, note whether the MC number actually shows
  // up among this DOT's registered docket numbers -- that's the stricter
  // cross-check, not just "each one independently resolves to something."
  let mcMatchesDot = null
  if (dotNumber && mcNumber) {
    const clean = String(mcNumber).trim().replace(/^mc-?/i, '')
    mcMatchesDot = carrier.mcNumbers.some((n) => String(n).replace(/^mc-?/i, '') === clean)
  }

  return json(200, { carrier, mcMatchesDot })
}
