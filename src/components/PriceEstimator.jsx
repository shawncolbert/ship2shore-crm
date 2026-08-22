import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPricingZones, fetchPricingSurcharges, matchPricingZone } from '../lib/supabase'
import { MAPBOX_TOKEN } from '../lib/mapbox'

async function mapboxGeocodeOne(address) {
  if (!MAPBOX_TOKEN || !address?.trim()) return null
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=false&country=us&types=address,place&limit=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  return data.features?.[0]?.center || null // [lng, lat]
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

const VEHICLE_TYPES = [
  { value: 'sedan', label: 'Sedan / car' },
  { value: 'suv', label: 'SUV / crossover (+$200)' },
  { value: 'truck', label: 'Truck (no adjustment)' },
  { value: 'enclosed', label: 'Enclosed trailer (no adjustment)' },
]
const INTERSTATE_MIN_MI = 250

// Maps the VIN-decoded vehicle_type (sedan/suv/truck/van/coupe/small -- see
// vin-decode's mapBodyClassToVehicleType) down to this estimator's simpler
// pricing categories. Vans and trucks share the "no adjustment" tier; coupe
// and small ride with sedan.
function toEstimatorVehicleType(vinVehicleType) {
  if (vinVehicleType === 'suv') return 'suv'
  if (vinVehicleType === 'truck' || vinVehicleType === 'van') return 'truck'
  return 'sedan'
}

// Locked pricing structure (2026-08-20, retiered twice same day) --
// distance-tiered per-mile rate with a June-August peak-summer bump, a flat
// $150 dispatch fee on every load, and a $200 SUV/crossover adjustment.
// Returns one number, not a range. An earlier version of this table's
// separate $0.90/mi "absolute floor" was for a high-volume backhaul deal
// type that doesn't exist in the pipeline yet -- still not applied here.
function interstateQuote({ miles, vehicleType, when = new Date() }) {
  const dispatchFee = 150
  const weightAdjustment = vehicleType === 'suv' ? 200 : 0
  const isPeakSummer = when.getMonth() >= 5 && when.getMonth() <= 7 // Jun-Aug

  let base, peak
  if (miles <= 500) { base = 1.75; peak = 2.25 }        // Short Haul
  else if (miles <= 1200) { base = 0.95; peak = 1.25 }  // Mid Haul
  else { base = 0.55; peak = 0.75 }                     // Long Haul
  const rate = isPeakSummer ? peak : base

  const transportCost = miles * rate
  return Math.round((transportCost + weightAdjustment + dispatchFee) * 100) / 100
}

function InterstateEstimator({ pickup, dropoff, vehicleType, onVehicleType, onUseAmount }) {
  const [miles, setMiles] = useState(null)
  const [milesLoading, setMilesLoading] = useState(false)
  const [milesErr, setMilesErr] = useState('')

  const calcMileage = async () => {
    setMilesLoading(true); setMilesErr(''); setMiles(null)
    try {
      const [from, to] = await Promise.all([mapboxGeocodeOne(pickup), mapboxGeocodeOne(dropoff)])
      if (!from || !to) { setMilesErr('Could not locate one of those addresses.'); return }
      const m = await mapboxDrivingMiles(from, to)
      if (m == null) { setMilesErr('Could not calculate driving distance.'); return }
      setMiles(m)
    } catch {
      setMilesErr('Mileage lookup failed.')
    } finally {
      setMilesLoading(false)
    }
  }

  const isPeakSummer = new Date().getMonth() >= 5 && new Date().getMonth() <= 7
  const quote = miles != null ? interstateQuote({ miles, vehicleType }) : null

  return (
    <div className="space-y-1.5">
      <select
        value={vehicleType}
        onChange={(e) => onVehicleType(e.target.value)}
        className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent"
      >
        {VEHICLE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
      </select>
      <button
        type="button"
        onClick={calcMileage}
        disabled={milesLoading || !pickup || !dropoff}
        className="w-full rounded border border-line bg-canvas px-2 py-1 text-[11px] font-semibold text-ink hover:bg-canvas/50 disabled:opacity-50"
      >
        {milesLoading ? 'Calculating…' : miles != null ? `${Math.round(miles)} mi — recalculate` : 'Calculate driving distance'}
      </button>
      {milesErr && <p className="text-[10px] text-port">{milesErr}</p>}
      {miles != null && miles <= INTERSTATE_MIN_MI && (
        <p className="text-[10px] text-muted">Under {INTERSTATE_MIN_MI} mi — the Zone tab may fit this better.</p>
      )}
      {quote != null && isPeakSummer && (
        <p className="text-[10px] text-muted">Peak summer rate applied (Jun–Aug).</p>
      )}
      {quote != null && (
        <div className="flex items-center justify-between rounded bg-accent/10 px-2 py-1.5">
          <span className="text-xs font-semibold text-ink">${quote.toLocaleString()}</span>
          <button
            type="button"
            onClick={() => onUseAmount(quote)}
            className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-ink hover:bg-accent-600"
          >
            Use as Amount
          </button>
        </div>
      )}
    </div>
  )
}

// Zones/surcharges come from pricing_zones/pricing_surcharges (Settings'
// rate catalog, same pattern as `services`) so the list can grow without a
// code change. Matches the range whaleyinc.net's own public calculator
// would quote for a local CA run.
function ZoneEstimator({ zones, surcharges, onUseAmount }) {
  const [zoneId, setZoneId] = useState('')
  const [vehicleCount, setVehicleCount] = useState(1)
  const [checkedSurcharges, setCheckedSurcharges] = useState(() => new Set())
  const stop = (e) => e.stopPropagation()

  const zone = (zones || []).find((z) => z.id === zoneId)
  const count = Math.max(1, Number(vehicleCount) || 1)

  const toggleSurcharge = (id) => {
    setCheckedSurcharges((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  let estimateMin = null, estimateMax = null
  if (zone) {
    const applied = (surcharges || []).filter((s) => checkedSurcharges.has(s.id))
    const sMin = applied.reduce((sum, s) => sum + Number(s.amount_min), 0)
    const sMax = applied.reduce((sum, s) => sum + Number(s.amount_max), 0)
    estimateMin = (Number(zone.rate_min) + sMin) * count
    estimateMax = (Number(zone.rate_max) + sMax) * count
  }

  return (
    <div onClick={stop} className="space-y-1.5">
      <select
        value={zoneId}
        onChange={(e) => setZoneId(e.target.value)}
        className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent"
      >
        <option value="">Match to a zone…</option>
        {(zones || []).map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}{z.note ? ` (${z.note})` : ''} — ${Number(z.rate_min)}–${Number(z.rate_max)}
          </option>
        ))}
      </select>
      {zone && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted">Vehicles</label>
            <input
              type="number" min="1" max="20" value={vehicleCount}
              onChange={(e) => setVehicleCount(e.target.value)}
              className="w-14 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-ink outline-none focus:border-accent"
            />
          </div>
          {(surcharges || []).length > 0 && (
            <div className="space-y-0.5">
              {surcharges.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-[11px] text-ink">
                  <input type="checkbox" checked={checkedSurcharges.has(s.id)} onChange={() => toggleSurcharge(s.id)} />
                  {s.name}
                  <span className="text-muted">
                    (+${Number(s.amount_min)}{Number(s.amount_min) !== Number(s.amount_max) ? `–$${Number(s.amount_max)}` : ''}/car)
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between rounded bg-accent/10 px-2 py-1.5">
            <span className="text-xs font-semibold text-ink">
              ${estimateMin.toLocaleString()}{estimateMin !== estimateMax ? `–$${estimateMax.toLocaleString()}` : ''}
            </span>
            <button
              type="button"
              onClick={() => onUseAmount(Math.round((estimateMin + estimateMax) / 2))}
              className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-ink hover:bg-accent-600"
            >
              Use as Amount
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const EMPTY_AUTO = { loading: false, error: '', mode: null, miles: null, zoneName: null, amount: null }

// Staff-only quote helper: the landing page/funnel form only ever collects
// a plain pickup/dropoff address, nobody outside the org ever sees a rate.
// As soon as pickup + drop-off + a decoded vehicle type are all known, this
// auto-geocodes the run, auto-matches it to a named CA zone (via Claude --
// see match-pricing-zone.js, since zones are named regions with no defined
// boundaries) or falls back to the mileage-tiered Interstate table, and
// shows the result as a Suggested price. It never fills Amount on its own --
// same "AI suggests, dispatcher confirms" rule as vehicle pricing -- the
// dispatcher still has to click Confirm. "Adjust manually" drops back to the
// original zone-pick/mileage-calc controls for a one-off override.
export default function PriceEstimator({ pickup, dropoff, vehicleType, onUseAmount }) {
  const { data: zones } = useQuery({ queryKey: ['pricingZones'], queryFn: fetchPricingZones })
  const { data: surcharges } = useQuery({ queryKey: ['pricingSurcharges'], queryFn: fetchPricingSurcharges })
  const [manualOverride, setManualOverride] = useState(false)
  const [manualMode, setManualMode] = useState('zone')
  const [manualVehicleType, setManualVehicleType] = useState('sedan')
  const [auto, setAuto] = useState(EMPTY_AUTO)
  const [confirmedAmount, setConfirmedAmount] = useState(null)
  const stop = (e) => e.stopPropagation()

  const estimatorVehicleType = toEstimatorVehicleType(vehicleType)

  useEffect(() => {
    if (manualOverride) return
    if (!pickup?.trim() || !dropoff?.trim()) { setAuto(EMPTY_AUTO); return }
    let cancelled = false
    setAuto((a) => ({ ...a, loading: true, error: '' }))
    const timer = setTimeout(async () => {
      try {
        const [from, to] = await Promise.all([mapboxGeocodeOne(pickup), mapboxGeocodeOne(dropoff)])
        if (cancelled) return
        if (!from || !to) { setAuto({ ...EMPTY_AUTO, error: 'Could not locate one of those addresses.' }); return }
        const miles = await mapboxDrivingMiles(from, to)
        if (cancelled) return
        if (miles == null) { setAuto({ ...EMPTY_AUTO, error: 'Could not calculate driving distance.' }); return }

        let zoneId = null
        if (miles <= INTERSTATE_MIN_MI && (zones || []).length) {
          try { zoneId = await matchPricingZone(dropoff, zones) } catch { /* fall through to interstate */ }
        }

        if (cancelled) return
        if (zoneId) {
          const zone = (zones || []).find((z) => z.id === zoneId)
          const amount = zone ? Math.round((Number(zone.rate_min) + Number(zone.rate_max)) / 2) : null
          setAuto({ loading: false, error: '', mode: 'zone', miles, zoneName: zone?.name || null, amount })
        } else {
          const amount = interstateQuote({ miles, vehicleType: estimatorVehicleType })
          setAuto({ loading: false, error: '', mode: 'interstate', miles, zoneName: null, amount })
        }
      } catch {
        if (!cancelled) setAuto({ ...EMPTY_AUTO, error: 'Automatic pricing failed — try Adjust manually.' })
      }
    }, 700)
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup, dropoff, estimatorVehicleType, manualOverride, zones])

  const confirmAuto = () => {
    if (auto.amount == null) return
    onUseAmount(auto.amount)
    setConfirmedAmount(auto.amount)
  }

  return (
    <div onClick={stop} className="space-y-1.5 rounded border border-line bg-canvas/50 p-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Price estimator (staff only)</h4>
        <button
          type="button"
          onClick={() => setManualOverride((v) => !v)}
          className="text-[10px] font-semibold text-muted underline hover:text-ink"
        >
          {manualOverride ? 'Back to automatic' : 'Adjust manually'}
        </button>
      </div>

      {!manualOverride && (
        <>
          {!pickup?.trim() || !dropoff?.trim() ? (
            <p className="text-[11px] text-muted">Enter a pickup and drop-off address to get an automatic suggested price.</p>
          ) : auto.loading ? (
            <p className="text-[11px] text-muted">Calculating…</p>
          ) : auto.error ? (
            <p className="text-[11px] text-port">{auto.error}</p>
          ) : auto.amount != null ? (
            <div className="space-y-1">
              <p className="text-[10px] text-muted">
                {auto.mode === 'zone' ? `Matched to ${auto.zoneName}` : `Interstate — ${Math.round(auto.miles)} mi, ${estimatorVehicleType}`}
              </p>
              <div className="flex items-center justify-between rounded bg-accent/10 px-2 py-1.5">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">Suggested price</p>
                  <span className="text-xs font-semibold text-ink">${auto.amount.toLocaleString()}</span>
                </div>
                <button
                  type="button"
                  onClick={confirmAuto}
                  disabled={confirmedAmount === auto.amount}
                  className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
                >
                  {confirmedAmount === auto.amount ? 'Confirmed ✓' : 'Confirm price'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted">Waiting on an address…</p>
          )}
        </>
      )}

      {manualOverride && (
        <>
          <div className="flex overflow-hidden rounded border border-line text-[10px] font-semibold">
            <button type="button" onClick={() => setManualMode('zone')}
              className={`flex-1 px-2 py-0.5 ${manualMode === 'zone' ? 'bg-accent text-ink' : 'bg-canvas text-muted'}`}>Zone</button>
            <button type="button" onClick={() => setManualMode('interstate')}
              className={`flex-1 px-2 py-0.5 ${manualMode === 'interstate' ? 'bg-accent text-ink' : 'bg-canvas text-muted'}`}>Interstate</button>
          </div>
          {manualMode === 'zone'
            ? <ZoneEstimator zones={zones} surcharges={surcharges} onUseAmount={onUseAmount} />
            : <InterstateEstimator pickup={pickup} dropoff={dropoff} vehicleType={manualVehicleType} onVehicleType={setManualVehicleType} onUseAmount={onUseAmount} />}
        </>
      )}
    </div>
  )
}
