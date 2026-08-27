// Server-side port of Val's LOCKED pricing formula (2026-08-22, revised
// 2026-08-27 -- see src/components/PriceEstimator.jsx for the full history
// and the customer-facing UI version of this same math). Kept as a
// deliberate duplicate rather than a shared import: PriceEstimator.jsx runs
// in the browser bundle and this runs in a Netlify function, and keeping
// them physically separate means a client-only change (like the manual
// vehicle-type override UI) can't accidentally touch what a webhook quotes
// a customer. Any change to the actual brackets/modifiers/multipliers must
// be made in BOTH files, with Val's sign-off, same as always.
//
// This module only computes a quote -- it has no vehicle-type detection and
// no rural/enclosed judgment call, since those need a human. Callers that
// want a fully automatic best-effort number (e.g. a brand-new lead with no
// dispatcher input yet) should pass ruralLevel: 'none', transportMode:
// 'open' -- the common case -- and let a dispatcher correct it before
// anything is actually sent to the customer.

const RURAL_FEES = { none: 0, minor: 100, remote: 225 }
const round2 = (n) => Math.round(n * 100) / 100

export function seasonFor(date) {
  const m = date.getMonth()
  if (m >= 2 && m <= 4) return 'spring'
  if (m >= 5 && m <= 7) return 'summer'
  return 'other'
}

export function calculateGeneralQuote({ miles, vehicleType = 'Sedan', season = 'other', ruralLevel = 'none', transportMode = 'open' }) {
  let base
  if (miles <= 100) base = Math.max(380, miles * 3.75)
  else if (miles <= 300) base = Math.max(700, miles * 2.65)
  else if (miles <= 900) base = miles * 1.30
  else if (miles <= 1800) base = miles * 0.90
  else base = miles * 0.68

  if (vehicleType === 'SUV' || vehicleType === 'Truck') base += 150
  else if (vehicleType === 'Luxury' || vehicleType === 'Exotic') base += 350

  if (season === 'spring' || season === 'summer') base *= 1.15
  base += RURAL_FEES[ruralLevel] ?? 0
  if (transportMode === 'enclosed') base *= 1.45

  return round2(base)
}

const CA_PORT_RE = /long beach|wilmington/i
export function caPortBracket(miles) {
  if (miles <= 75) return { quoteLow: 275, quoteHigh: 475 }
  if (miles <= 100) return { quoteLow: 475, quoteHigh: 575 }
  if (miles <= 300) return { quoteLow: 600, quoteHigh: 725 }
  return null
}
export function isCaPortRoute(pickupAddress) {
  return CA_PORT_RE.test(pickupAddress || '')
}
