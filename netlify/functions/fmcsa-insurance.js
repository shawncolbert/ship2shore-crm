import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// FMCSA's newer Motus registration system (motus.dot.gov) -- confirmed
// live, by hand, against the real site (not from training knowledge like
// the other FMCSA integrations in this codebase): GET /api/carriers/{dot}
// is public, requires no login and no API key, and returns the carrier's
// full record -- business info, officers, addresses, phone numbers, and an
// `entityRegistrations` array that (per the Insurance Details tab on the
// live site, which fires no network call of its own beyond this one) holds
// the operating-authority + insurance-filing data too.
//
// UPDATE: the nested insurance/authority field names below (policyNumber,
// maxCovAmount, docketNumber, operatingAuthorityStatusName, etc.) are now
// confirmed against a real live response -- read directly off a
// production test run, not guessed. They live somewhere inside
// entityRegistrations -> entityRegistrationOperatingAuthorities, nested a
// couple of levels deep in a shape that wasn't fully pinned down from the
// screenshots (some sibling/nesting ambiguity). Rather than hard-code an
// exact path that might be subtly wrong, findAll() below walks the whole
// response looking for objects that carry a given field -- e.g. any object
// with a `policyNumber` is treated as one insurance filing, regardless of
// exactly how deep it's nested. That's robust to the path being slightly
// off; it's only wrong if FMCSA reuses those exact field names for
// something unrelated elsewhere in the payload, which hasn't shown up.
const BASE = 'https://motus.dot.gov/api/carriers'

function findAll(root, predicate) {
  const out = []
  const seen = new Set()
  function walk(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (!Array.isArray(node) && predicate(node)) out.push(node)
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') walk(v)
    }
  }
  walk(root)
  return out
}

function money(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function dateOnly(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US')
}

function mapInsuranceFilings(raw) {
  return findAll(raw, (o) => 'policyNumber' in o && o.policyNumber)
    .map((f) => ({
      policyNumber: f.policyNumber,
      coverageAmount: money(f.maxCovAmount),
      receivedDate: dateOnly(f.receivedDate),
      effectiveDate: dateOnly(f.effectiveDate),
      cancellationDate: dateOnly(f.cancellationDate),
    }))
}

function mapOperatingAuthorities(raw) {
  return findAll(raw, (o) => o.operatingAuthorityStatusName != null || o.docketNumber != null || o.dockNumber != null)
    .map((a) => ({
      docketNumber: a.docketNumber || a.dockNumber || '',
      status: a.operatingAuthorityStatusName || '',
      type: typeof a.operatingAuthorityType === 'string' ? a.operatingAuthorityType : (a.operatingAuthorityType?.operatingAuthorityType || ''),
    }))
    .filter((a) => a.docketNumber || a.status)
}

async function fetchCarrier(dotNumber) {
  const res = await fetch(`${BASE}/${encodeURIComponent(dotNumber)}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; Ship2ShoreLeadFinder/1.0)',
    },
  })
  if (res.status === 404) return null
  if (res.status === 401 || res.status === 403) {
    throw new Error("Motus rejected this as unauthorized -- it works with no login in a browser, so a server-side call needing something extra (a session token) would be new. Worth a look.")
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`Motus API error (${res.status}): ${JSON.stringify(data)}`)
  return data
}

function fullName(o) {
  return [o.firstName, o.middleName, o.lastName, o.suffix].filter(Boolean).join(' ')
}

function mapCarrier(c) {
  if (!c) return null
  const primaryAddress = (c.locations || []).find((l) => l.primaryAddressFlag) || c.locations?.[0] || null
  return {
    dotNumber: c.entityDotNumber != null ? String(c.entityDotNumber) : '',
    legalName: c.entityName || '',
    outOfService: !!c.outOfService,
    officers: (c.entityOfficers || []).map((o) => ({
      name: fullName(o),
      title: o.title || '',
      phone: o.phoneNumber || '',
      email: o.email || '',
    })),
    phones: (c.phoneNumbers || []).map((p) => p.phoneNumber).filter(Boolean),
    emails: (c.emailAddresses || []).map((e) => e.email || e.emailAddress).filter(Boolean),
    address: primaryAddress ? {
      line1: primaryAddress.addressLine1 || '',
      line2: primaryAddress.addressLine2 || '',
      city: primaryAddress.city || '',
      state: primaryAddress.state || '',
      zip: [primaryAddress.zipCode, primaryAddress.zipPlus4].filter(Boolean).join('-'),
    } : null,
    operatingAuthorities: mapOperatingAuthorities(c),
    insuranceFilings: mapInsuranceFilings(c),
  }
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
  const { dotNumber } = payload
  if (!dotNumber?.toString().trim()) return json(400, { error: 'A DOT number is required.' })

  let raw
  try {
    raw = await fetchCarrier(dotNumber.toString().trim())
  } catch (e) {
    return json(502, { error: e.message || 'Could not reach the Motus registration system.' })
  }
  if (!raw) return json(200, { carrier: null })

  return json(200, { carrier: mapCarrier(raw) })
}
