import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MAPBOX_TOKEN } from '../lib/mapbox'
import { logQuote, fetchOrgPricingAdjustment } from '../lib/supabase'

async function mapboxGeocodeOne(address) {
  if (!MAPBOX_TOKEN || !address?.trim()) return null
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=false&country=us&types=address,place&limit=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const feature = data.features?.[0]
  if (!feature) return null
  const regionContext = feature.context?.find((c) => c.id?.startsWith('region'))
  const regionCode = regionContext?.short_code?.replace(/^US-/, '') || null // e.g. "CA"
  return { center: feature.center, regionCode } // center is [lng, lat]
}

async function mapboxDrivingMiles(from, to) {
  if (!MAPBOX_TOKEN || !from || !to) return null
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from[0]},${from[1]};${to[0]},${to[1]}?access_token=${MAPBOX_TOKEN}&overview=false`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const meters = data.routes?.[0]?.distance
  return typeof meters === 'number' ? meters / 1609.344 : null
}

// Maps the VIN-decoded vehicle_type (sedan/suv/truck/van/coupe/small -- see
// vin-decode's mapBodyClassToVehicleType) to the formula's vehicle_type
// param below. There's no automatic Luxury/Exotic signal from a VIN decode
// yet, so those stay a manual override in the UI (the OVERRIDE select) --
// auto-detection only ever lands on Sedan/SUV/Truck.
function toFormulaVehicleType(vinVehicleType) {
  if (vinVehicleType === 'suv') return 'SUV'
  if (vinVehicleType === 'truck') return 'Truck'
  return 'Sedan'
}

function seasonFor(date) {
  const m = date.getMonth() // 0 = Jan
  if (m >= 2 && m <= 4) return 'spring'  // Mar-May
  if (m >= 5 && m <= 7) return 'summer'  // Jun-Aug
  return 'other'
}

const RURAL_FEES = { none: 0, minor: 100, remote: 225 }

// LOCKED pricing formula (2026-08-22, revised 2026-08-27) -- Val's exact
// breakdown for what gets charged on every vehicle-dispatch job, ported 1:1
// from the Python he provided. Do not adjust the brackets/modifiers/
// multipliers without him signing off again; only the surrounding
// integration (how vehicleType/season/ruralLevel/transportMode get fed in)
// is ours to figure out. Used to add a 15% system markup plus a flat $150/
// $250 broker fee on top, offering the customer a choice of two prices --
// dropped on Val & Shawn's call (2026-08-27): the carrier-rate brackets
// already carry the broker's margin, so the extra layers just pushed the
// customer price too high. The driver's payout IS the customer quote now,
// one number, no markup stacked on top.
function calculateCrmQuoteMatrix({ miles, vehicleType = 'Sedan', season = 'other', ruralLevel = 'none', transportMode = 'open' }) {
  // 1. Base carrier cost by distance bracket (origin: SoCal)
  let base
  if (miles <= 100) base = Math.max(380, miles * 3.75)
  else if (miles <= 300) base = Math.max(700, miles * 2.65)
  else if (miles <= 900) base = miles * 1.30
  else if (miles <= 1800) base = miles * 0.90
  else base = miles * 0.68

  // 2. Vehicle footprint modifier
  if (vehicleType === 'SUV' || vehicleType === 'Truck') base += 150
  else if (vehicleType === 'Luxury' || vehicleType === 'Exotic') base += 350

  // 3. Seasonal peak multiplier (spring & summer demand surge)
  if (season === 'spring' || season === 'summer') base *= 1.15

  // 4. Rural destination surcharge
  base += RURAL_FEES[ruralLevel] ?? 0

  // 5. Enclosed trailer multiplier
  if (transportMode === 'enclosed') base *= 1.45

  const round2 = (n) => Math.round(n * 100) / 100
  return { targetDriverPayout: round2(base), quote: round2(base) }
}

// LOCKED enclosed Luxury/Exotic formula (2026-08-22, revised 2026-08-27) --
// Val's separate breakdown for Luxury/Exotic vehicles specifically. These
// always ship enclosed (its own, higher per-mile rate table -- not the
// general formula's base rate with the ×1.45 enclosed multiplier stacked on
// top), have no SUV/Truck-style flat vehicle modifier (Exotic gets its own
// +$300 instead), and use a different rural fee scale ($150/$300, not
// $100/$225). There's no Open/Enclosed choice here -- it's enclosed-only by
// definition. Same 2026-08-27 change as the general formula above: no more
// 15% markup + $150/$250 fee stacked on top -- the driver's payout is the
// customer quote.
function calculateLuxuryExoticQuote({ miles, vehicleCategory = 'Luxury', season = 'other', ruralLevel = 'none' }) {
  // 1. Enclosed base carrier target (higher per-mile cost for specialized trailers)
  let base
  if (miles <= 100) base = Math.max(600, miles * 5.50)
  else if (miles <= 300) base = Math.max(950, miles * 3.80)
  else if (miles <= 900) base = miles * 1.85
  else if (miles <= 1800) base = miles * 1.30
  else base = miles * 0.95

  // 2. Exotic tier surcharge (liftgate/high-value insurance handling)
  if (vehicleCategory === 'Exotic') base += 300

  // 3. Seasonal peak surge (spring & summer demand)
  if (season === 'spring' || season === 'summer') base *= 1.15

  // 4. Rural destination surcharge (Luxury/Exotic's own scale)
  const ruralFees = { none: 0, minor: 150, remote: 300 }
  base += ruralFees[ruralLevel] ?? 0

  const round2 = (n) => Math.round(n * 100) / 100
  return { requiredTransport: 'Enclosed Trailer', targetDriverPayout: round2(base), quote: round2(base) }
}

// CA local-run flat brackets (2026-08-24) -- Val's separate rate for a run
// that both starts at the Long Beach/Wilmington port AND stays inside
// California. Deliberately simpler than the general formula: no vehicle/
// season/rural/enclosed adjustments, just miles -> a flat Low/High pair.
// 300+ mi falls through to the general locked formula instead -- there's no
// "target driver payout" baseline defined for this scheme, only the two
// customer-facing numbers.
const CA_PORT_RE = /long beach|wilmington/i
function calculateCaPortBracket(miles) {
  if (miles <= 75) return { quoteLow: 275, quoteHigh: 475 }
  if (miles <= 100) return { quoteLow: 475, quoteHigh: 575 }
  if (miles <= 300) return { quoteLow: 600, quoteHigh: 725 }
  return null
}

const EMPTY_AUTO = { loading: false, error: '', miles: null, quote: null, dropoffRegion: null, pickupRegion: null }

// Staff-only quote helper: the landing page/funnel form only ever collects
// a plain pickup/dropoff address, nobody outside the org ever sees a rate.
// Auto-geocodes the run and drives the LOCKED formula above off real
// driving distance + the VIN-decoded vehicle type; rural level and
// transport mode need a human judgment call so those stay manual selects.
// Shows both quote options -- never fills Amount on its own, same
// "AI suggests, dispatcher confirms" rule as everywhere else -- the
// dispatcher picks Low or High and clicks Confirm.
export default function PriceEstimator({ pickup, dropoff, vehicleType, scheduledAt, onUseAmount, orgId, opportunityId, onMilesKnown }) {
  // Editable in Settings > Pricing -- outbound (CA -> elsewhere) tends to
  // run higher than inbound in this lane, per Shawn's call 2026-08-27.
  // Zero by default, so this is a no-op for any org that hasn't set one.
  const { data: outboundAdjustment } = useQuery({
    queryKey: ['orgPricingAdjustment', orgId], queryFn: () => fetchOrgPricingAdjustment(orgId), enabled: !!orgId,
  })
  const [vehicleOverride, setVehicleOverride] = useState('auto')
  const [ruralLevel, setRuralLevel] = useState('none')
  const [transportMode, setTransportMode] = useState('open')
  const [milesOverride, setMilesOverride] = useState('')
  const [auto, setAuto] = useState(EMPTY_AUTO)
  const [confirmedAmount, setConfirmedAmount] = useState(null)
  const stop = (e) => e.stopPropagation()

  const effectiveVehicleType = vehicleOverride === 'auto' ? toFormulaVehicleType(vehicleType) : vehicleOverride
  const isLuxuryExotic = effectiveVehicleType === 'Luxury' || effectiveVehicleType === 'Exotic'
  const season = seasonFor(scheduledAt ? new Date(scheduledAt) : new Date())

  useEffect(() => {
    if (milesOverride !== '') return
    if (!pickup?.trim() || !dropoff?.trim()) { setAuto(EMPTY_AUTO); return }
    let cancelled = false
    setAuto((a) => ({ ...a, loading: true, error: '' }))
    const timer = setTimeout(async () => {
      try {
        const [from, to] = await Promise.all([mapboxGeocodeOne(pickup), mapboxGeocodeOne(dropoff)])
        if (cancelled) return
        if (!from || !to) { setAuto({ ...EMPTY_AUTO, error: 'Could not locate one of those addresses.' }); return }
        const miles = await mapboxDrivingMiles(from.center, to.center)
        if (cancelled) return
        if (miles == null) { setAuto({ ...EMPTY_AUTO, error: 'Could not calculate driving distance.' }); return }
        setAuto({ loading: false, error: '', miles, quote: null, dropoffRegion: to.regionCode, pickupRegion: from.regionCode })
      } catch {
        if (!cancelled) setAuto({ ...EMPTY_AUTO, error: 'Automatic mileage lookup failed — enter miles manually below.' })
      }
    }, 700)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [pickup, dropoff, milesOverride])

  const miles = milesOverride !== '' ? Number(milesOverride) : auto.miles

  useEffect(() => {
    onMilesKnown?.(miles > 0 ? miles : null)
  }, [miles, onMilesKnown])
  // CA local-run brackets only apply off a fresh auto-geocoded distance --
  // a manually typed mile count means there's no confirmed drop-off state,
  // so that case always falls through to the general locked formula.
  const isCaPortLocal = milesOverride === '' && CA_PORT_RE.test(pickup || '') && auto.dropoffRegion === 'CA' && miles > 0 && miles <= 300
  const caBracket = isCaPortLocal ? calculateCaPortBracket(miles) : null
  const rawQuote = caBracket || (miles > 0
    ? (isLuxuryExotic
        ? calculateLuxuryExoticQuote({ miles, vehicleCategory: effectiveVehicleType, season, ruralLevel })
        : calculateCrmQuoteMatrix({ miles, vehicleType: effectiveVehicleType, season, ruralLevel, transportMode }))
    : null)

  // Outbound-from-CA adjustment applies to the customer-facing number only
  // (never targetDriverPayout, which is what the carrier actually gets) --
  // and never to the CA-port-local bracket, which is already its own
  // separate inbound-only rate table.
  const isOutboundFromCa = milesOverride === '' && auto.pickupRegion === 'CA' && auto.dropoffRegion && auto.dropoffRegion !== 'CA'
  const adjustment = isOutboundFromCa ? Number(outboundAdjustment || 0) : 0
  const quote = rawQuote && adjustment
    ? { ...rawQuote, quote: rawQuote.quote != null ? rawQuote.quote + adjustment : rawQuote.quote }
    : rawQuote

  // Reference log only -- every confirmed quote gets recorded (route, date,
  // vehicle, both numbers, which one was picked) so it can be looked back
  // on later. Never read back to override a fresh calculation: the locked
  // formula is already deterministic, so this is purely a history trail.
  // Best-effort -- a logging failure never blocks confirming the price.
  const confirm = (amount) => {
    onUseAmount(amount)
    setConfirmedAmount(amount)
    if (orgId) {
      logQuote({
        org_id: orgId,
        opportunity_id: opportunityId || null,
        pickup_address: pickup || null,
        dropoff_address: dropoff || null,
        miles: miles || null,
        vehicle_type: effectiveVehicleType,
        season: isCaPortLocal ? null : season,
        rural_level: isCaPortLocal ? null : ruralLevel,
        transport_mode: isCaPortLocal || isLuxuryExotic ? null : transportMode,
        formula_used: isCaPortLocal ? 'ca_port_bracket' : isLuxuryExotic ? 'luxury_exotic' : 'general',
        quote_low: quote.quoteLow ?? null,
        quote_high: quote.quoteHigh ?? null,
        target_driver_payout: quote.targetDriverPayout ?? null,
        confirmed_amount: amount,
      }).catch(() => {})
    }
  }

  return (
    <div onClick={stop} className="space-y-1.5 rounded border border-line bg-canvas/50 p-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Price estimator (staff only)</h4>

      {isCaPortLocal ? (
        <p className="rounded border border-accent/40 bg-accent/8 px-2 py-1 text-[11px] text-ink">
          California local rate — port pickup, in-state drop-off, under 300 mi. Vehicle/season/rural don't apply to this rate.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          <select value={vehicleOverride} onChange={(e) => setVehicleOverride(e.target.value)} className="w-full rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-ink outline-none focus:border-accent">
            <option value="auto">Vehicle: auto ({toFormulaVehicleType(vehicleType)})</option>
            <option value="Sedan">Sedan</option>
            <option value="SUV">SUV</option>
            <option value="Truck">Truck</option>
            <option value="Luxury">Luxury</option>
            <option value="Exotic">Exotic</option>
          </select>
          <select value={ruralLevel} onChange={(e) => setRuralLevel(e.target.value)} className="w-full rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-ink outline-none focus:border-accent">
            <option value="none">Rural: none</option>
            <option value="minor">{`Rural: minor (+$${isLuxuryExotic ? 150 : 100})`}</option>
            <option value="remote">{`Rural: remote (+$${isLuxuryExotic ? 300 : 225})`}</option>
          </select>
          {isLuxuryExotic ? (
            <div className="flex items-center justify-center rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-muted" title="Luxury/Exotic always ships enclosed">
              Enclosed (required)
            </div>
          ) : (
            <select value={transportMode} onChange={(e) => setTransportMode(e.target.value)} className="w-full rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-ink outline-none focus:border-accent">
              <option value="open">Open</option>
              <option value="enclosed">Enclosed (×1.45)</option>
            </select>
          )}
        </div>
      )}

      {!pickup?.trim() || !dropoff?.trim() ? (
        <p className="text-[11px] text-muted">Enter a pickup and drop-off address to get an automatic mileage estimate, or type miles below.</p>
      ) : auto.loading && milesOverride === '' ? (
        <p className="text-[11px] text-muted">Calculating driving distance…</p>
      ) : auto.error && milesOverride === '' ? (
        <p className="text-[11px] text-port">{auto.error}</p>
      ) : null}

      <div className="flex items-center gap-1.5">
        <label className="text-[10px] text-muted">Miles</label>
        <input
          type="number" min="0" step="1"
          value={milesOverride !== '' ? milesOverride : (auto.miles != null ? Math.round(auto.miles) : '')}
          onChange={(e) => setMilesOverride(e.target.value)}
          placeholder="auto"
          className="w-20 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-ink outline-none focus:border-accent"
        />
        {milesOverride !== '' && (
          <button type="button" onClick={() => setMilesOverride('')} className="text-[10px] text-muted underline hover:text-ink">
            use auto
          </button>
        )}
      </div>

      {quote && (
        <div className="space-y-1">
          {/* CA port local rate keeps its own separate flat Low/High
              brackets -- untouched by the 2026-08-27 single-quote change,
              which only removed the markup+fee stacked on Val's general and
              luxury/exotic per-mile formulas below. */}
          {quote.quoteLow != null ? (
            <>
              <div className="flex items-center justify-between rounded bg-accent/10 px-2 py-1.5">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">Quote — Low</p>
                  <span className="text-xs font-semibold text-ink">${quote.quoteLow.toLocaleString()}</span>
                </div>
                <button
                  type="button"
                  onClick={() => confirm(quote.quoteLow)}
                  disabled={confirmedAmount === quote.quoteLow}
                  className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
                >
                  {confirmedAmount === quote.quoteLow ? 'Confirmed ✓' : 'Confirm'}
                </button>
              </div>
              <div className="flex items-center justify-between rounded bg-accent/10 px-2 py-1.5">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">Quote — High</p>
                  <span className="text-xs font-semibold text-ink">${quote.quoteHigh.toLocaleString()}</span>
                </div>
                <button
                  type="button"
                  onClick={() => confirm(quote.quoteHigh)}
                  disabled={confirmedAmount === quote.quoteHigh}
                  className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
                >
                  {confirmedAmount === quote.quoteHigh ? 'Confirmed ✓' : 'Confirm'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between rounded bg-accent/10 px-2 py-1.5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">Quote</p>
                <span className="text-xs font-semibold text-ink">${quote.quote.toLocaleString()}</span>
              </div>
              <button
                type="button"
                onClick={() => confirm(quote.quote)}
                disabled={confirmedAmount === quote.quote}
                className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
              >
                {confirmedAmount === quote.quote ? 'Confirmed ✓' : 'Confirm'}
              </button>
            </div>
          )}
          <p className="text-[9px] text-muted">
            {isCaPortLocal ? 'CA local rate' : season} · {miles ? Math.round(miles) : 0} mi
            {quote.requiredTransport ? ` · ${quote.requiredTransport} required` : ''}
            {adjustment ? ` · includes +$${adjustment.toLocaleString()} outbound-CA adjustment` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
