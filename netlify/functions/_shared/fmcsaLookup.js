// Extracted from fmcsa-insurance.js so agent-controller.js's lookup_carrier
// tool can reuse the exact same, already-verified-live logic instead of a
// second, possibly-drifting copy. No behavior change from the original --
// see fmcsa-insurance.js's own comments for how each field was confirmed
// against a real production response.
//
// Confirmed live, by hand: motus.dot.gov's GET /api/carriers/{dot} is
// public, no login or API key needed, keyed by DOT number specifically --
// an MC (docket) number is a different identifier FMCSA tracks separately
// and this endpoint does not accept one directly.
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

const NAME_KEYS = ['insuranceCompanyName', 'companyName', 'insurerName', 'filerName', 'legalName', 'entityName', 'name']

function pickName(o) {
  for (const k of NAME_KEYS) {
    if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim()
  }
  return ''
}

function resolveNameById(raw, id) {
  if (!id) return ''
  for (const o of findAll(raw, (o) => o.entityId === id || o.id === id || o.companyId === id)) {
    const name = pickName(o)
    if (name) return name
  }
  return ''
}

function mapInsuranceFilings(raw) {
  return findAll(raw, (o) => 'policyNumber' in o && o.policyNumber)
    .map((f) => ({
      policyNumber: f.policyNumber,
      insurerName: pickName(f) || resolveNameById(raw, f.insuranceEntityId),
      coverageAmount: money(f.maxCovAmount),
      receivedDate: dateOnly(f.receivedDate),
      effectiveDate: dateOnly(f.effectiveDate),
      cancellationDate: dateOnly(f.cancellationDate),
    }))
}

function mapProcessAgents(raw) {
  return findAll(raw, (o) => 'blanketFilingsId' in o)
    .map((b) => ({
      name: pickName(b) || resolveNameById(raw, b.blanketEntityId),
      receivedDate: dateOnly(b.receivedDate),
      cancellationDate: dateOnly(b.cancellationDate),
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
    processAgents: mapProcessAgents(c),
  }
}

export async function lookupCarrierByDot(dotNumber) {
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
  return mapCarrier(data)
}
