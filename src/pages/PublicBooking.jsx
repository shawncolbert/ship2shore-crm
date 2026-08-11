import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'

async function callBooking(action, orgSlug, ref, payload = {}) {
  const res = await fetch('/.netlify/functions/public-booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, org_slug: orgSlug || undefined, ref: ref || undefined, ...payload }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)
  return j
}

function pacificToday() {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = Object.fromEntries(dtf.formatToParts(new Date()).map((p) => [p.type, p.value]))
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) }
}

// Next 21 calendar days (matching the server's booking window). Weekends are
// excluded by default (no Saturday or Sunday work), except for bookings
// referred through a driver card set up for round-the-clock availability
// (roundTheClock=true), which show every day. Each entry carries the
// YYYY-MM-DD key the API expects.
function upcomingDays(roundTheClock) {
  const { y, m, d } = pacificToday()
  const days = []
  for (let offset = 0; offset <= 21; offset++) {
    const marker = new Date(Date.UTC(y, m - 1, d + offset))
    const dow = marker.getUTCDay()
    if (!roundTheClock && (dow === 0 || dow === 6)) continue // Saturday or Sunday
    const key = `${marker.getUTCFullYear()}-${String(marker.getUTCMonth() + 1).padStart(2, '0')}-${String(marker.getUTCDate()).padStart(2, '0')}`
    const label = marker.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    days.push({ key, label })
  }
  return days
}

const fmtSlot = (iso) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })

// Netlify functions cap the request body around 6MB, and base64 inflates a
// file by ~33% -- so the actual raw-file ceiling has to stay well under
// that, not just under some round "8MB" number that sounds safe but isn't.
const MAX_PHOTO_BYTES = 4 * 1024 * 1024
// A generous ceiling on what we'll even attempt to load into a canvas for
// compression -- real phone photos are nowhere near this; it's just a
// backstop against something absurd hanging the browser.
const MAX_SELECT_BYTES = 25 * 1024 * 1024

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('Could not read that photo.'))
    reader.readAsDataURL(file)
  })
}

// Phone camera photos routinely run 3-8MB, well past what a Netlify
// function can accept in one request -- downscale + re-encode as JPEG so a
// normal photo actually makes it through instead of getting rejected.
function compressImage(file, maxDim = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not process that photo.')); return }
        resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo.')) }
    img.src = url
  })
}

// Pickup/drop-off capture, on by default for the direct Ship2Shore booking
// link (no ref) plus these driver cards. Eloy's and Tre's referral cards
// deliberately stay off -- everyone else's form is untouched.
const ADDRESS_FIELDS_REFS = new Set([
  'tillys-classics',
  'team-auto-transport-dispatch',
  'warrior-auto-transport',
])

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

async function mapboxSuggest(query, signal) {
  if (!MAPBOX_TOKEN || query.trim().length < 3) return []
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&country=us&types=address,place&limit=5`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const data = await res.json()
  return data.features || []
}

// Straight-line distance is useless for a driving quote -- calls Mapbox
// Directions (driving profile) for actual road miles between two picked
// (not just typed) points.
async function mapboxDrivingMiles(from, to) {
  if (!MAPBOX_TOKEN || !from || !to) return null
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from[0]},${from[1]};${to[0]},${to[1]}?access_token=${MAPBOX_TOKEN}&overview=false`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const meters = data.routes?.[0]?.distance
  return typeof meters === 'number' ? meters / 1609.344 : null
}

function AddressField({ label, value, onChange, onPick }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (value.trim().length < 3) { setSuggestions([]); return }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      mapboxSuggest(value, controller.signal).then(setSuggestions).catch(() => {})
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [value])

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</label>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-surface shadow-lg">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(s); setSuggestions([]); setOpen(false) }}
                className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-canvas"
              >
                {s.place_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function PublicBooking() {
  const { orgSlug } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const ref = searchParams.get('ref')
  const showAddressFields = !ref || ADDRESS_FIELDS_REFS.has(ref)
  const [pickupCoords, setPickupCoords] = useState(null)
  const [dropoffCoords, setDropoffCoords] = useState(null)
  const [distanceMiles, setDistanceMiles] = useState(null)
  const [distanceLoading, setDistanceLoading] = useState(false)
  const [roundTheClock, setRoundTheClock] = useState(false)
  const days = useMemo(() => upcomingDays(roundTheClock), [roundTheClock])
  const [services, setServices] = useState(null)
  const [orgName, setOrgName] = useState('us')
  const [serviceCode, setServiceCode] = useState('')
  const [dateKey, setDateKey] = useState(days[0]?.key || '')
  const [slots, setSlots] = useState(null)
  const [slot, setSlot] = useState('')
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', notes: '', pickup_address: '', dropoff_address: '',
    vehicle_make: '', vehicle_model: '', vehicle_year: '', vehicle_vin: '',
  })
  const [photoFile, setPhotoFile] = useState(null)
  const [driverPhone, setDriverPhone] = useState(null)
  const [status, setStatus] = useState('idle') // idle | submitting | done | error
  const [err, setErr] = useState('')

  // Vehicle-transport jobs need the car's details and a photo up front, not
  // a generic note -- keeps the same form for every service without a
  // separate page per driver.
  const isVehicleService = serviceCode === 'vehicle_transport'

  useEffect(() => {
    callBooking('services', orgSlug, ref).then((r) => {
      setServices(r.services || [])
      setServiceCode(r.services?.[0]?.code || '')
      setOrgName(r.orgName || 'us')
      setRoundTheClock(!!r.roundTheClock)
      setDriverPhone(r.driverPhone || null)
    }).catch((e) => setErr(e.message))
  }, [orgSlug, ref])

  useEffect(() => {
    if (!dateKey) return
    setSlot(''); setSlots(null); setLoadingSlots(true)
    callBooking('availability', orgSlug, ref, { date: dateKey })
      .then((r) => setSlots(r.slots || []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingSlots(false))
  }, [dateKey, orgSlug, ref])

  useEffect(() => {
    if (!pickupCoords || !dropoffCoords) { setDistanceMiles(null); return }
    let cancelled = false
    setDistanceLoading(true)
    mapboxDrivingMiles(pickupCoords, dropoffCoords)
      .then((miles) => { if (!cancelled) setDistanceMiles(miles) })
      .finally(() => { if (!cancelled) setDistanceLoading(false) })
    return () => { cancelled = true }
  }, [pickupCoords, dropoffCoords])

  async function submit(e) {
    e.preventDefault()
    if (!serviceCode || !slot || !form.full_name.trim() || !form.email.trim()) return
    setStatus('submitting'); setErr('')
    try {
      let photo
      if (photoFile) {
        let toSend = photoFile
        try {
          toSend = await compressImage(photoFile)
        } catch {
          // Compression failing (e.g. an odd file type) just means we try
          // sending the original -- the size check right below still guards
          // against that being too big for the request to actually go through.
        }
        if (toSend.size > MAX_PHOTO_BYTES) {
          setErr('That photo is too large even after compression — try a different photo.')
          setStatus('error')
          return
        }
        photo = { filename: toSend.name, contentType: toSend.type, dataBase64: await fileToBase64(toSend) }
      }
      await callBooking('book', orgSlug, ref, {
        service_code: serviceCode, start_at: slot,
        full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim() || null,
        notes: form.notes.trim() || null, photo,
        pickup_address: form.pickup_address.trim() || null, dropoff_address: form.dropoff_address.trim() || null,
        distance_miles: distanceMiles != null ? Number(distanceMiles.toFixed(1)) : null,
        vehicle_make: form.vehicle_make.trim() || null, vehicle_model: form.vehicle_model.trim() || null,
        vehicle_year: form.vehicle_year.trim() || null, vehicle_vin: form.vehicle_vin.trim() || null,
      })
      setStatus('done')
    } catch (e2) {
      setErr(e2.message); setStatus('error')
      // The slot may have just been taken — refresh the list.
      callBooking('availability', orgSlug, ref, { date: dateKey }).then((r) => setSlots(r.slots || [])).catch(() => {})
    }
  }

  const selectedService = services?.find((s) => s.code === serviceCode)

  if (status === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
          <div className="text-3xl">✅</div>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-xl font-bold text-ink">Booked!</h1>
          <p className="mt-2 text-sm text-muted">
            {selectedService?.name} on <strong className="text-ink">{fmtSlot(slot)}</strong> Pacific,{' '}
            {days.find((d) => d.key === dateKey)?.label}.
          </p>
          <p className="mt-2 text-sm text-muted">We’ll email {form.email} to confirm. Thanks for booking with {orgName}!</p>
          {ref && driverPhone && (
            <div className="mt-5 rounded-lg border border-line bg-canvas p-4 text-left">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Please call to confirm</p>
              <p className="mt-1 text-sm text-muted">
                If you don't hear back shortly, feel free to call{' '}
                <a href={`tel:${driverPhone.replace(/[^\d+]/g, '')}`} className="font-semibold text-accent hover:underline">{driverPhone}</a> directly.
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas p-4 sm:p-8">
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"
        >
          ← Back
        </button>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Book with {orgName}</h1>
        <p className="mt-1 text-sm text-muted">Pick a service and a time — we’ll take it from there.</p>

        {err && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

        <form onSubmit={submit} className="mt-6 space-y-5">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Service</label>
            {services === null ? (
              <p className="text-sm text-muted">Loading services…</p>
            ) : (
              <select value={serviceCode} onChange={(e) => setServiceCode(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent">
                {services.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.default_rate != null ? `${s.name} — $${Number(s.default_rate).toFixed(0)}` : s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Date</label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {days.map((d) => (
                <button key={d.key} type="button" onClick={() => setDateKey(d.key)}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    dateKey === d.key ? 'border-accent bg-accent text-ink' : 'border-line bg-canvas text-ink hover:bg-canvas/70'
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Time (Pacific)</label>
            {loadingSlots ? (
              <p className="text-sm text-muted">Checking availability…</p>
            ) : !slots || slots.length === 0 ? (
              <p className="text-sm text-muted">No open times that day — try another date.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <button key={s} type="button" onClick={() => setSlot(s)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      slot === s ? 'border-accent bg-accent text-ink' : 'border-line bg-canvas text-ink hover:bg-canvas/70'
                    }`}>
                    {fmtSlot(s)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Full name</label>
              <input required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Email</label>
              <input required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Phone (optional)</label>
              <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
            </div>
            {showAddressFields && (
              <>
                <AddressField
                  label="Pickup Address (optional)"
                  value={form.pickup_address}
                  onChange={(v) => { setForm((f) => ({ ...f, pickup_address: v })); setPickupCoords(null) }}
                  onPick={(s) => { setForm((f) => ({ ...f, pickup_address: s.place_name })); setPickupCoords(s.center) }}
                />
                <AddressField
                  label="Drop-off Address (optional)"
                  value={form.dropoff_address}
                  onChange={(v) => { setForm((f) => ({ ...f, dropoff_address: v })); setDropoffCoords(null) }}
                  onPick={(s) => { setForm((f) => ({ ...f, dropoff_address: s.place_name })); setDropoffCoords(s.center) }}
                />
                {(distanceLoading || distanceMiles != null) && (
                  <div className="sm:col-span-2 text-sm text-muted">
                    {distanceLoading ? 'Calculating distance…' : `Estimated distance: ${distanceMiles.toFixed(1)} miles`}
                  </div>
                )}
              </>
            )}
            {isVehicleService ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Make (optional)</label>
                  <input value={form.vehicle_make} onChange={(e) => setForm((f) => ({ ...f, vehicle_make: e.target.value }))}
                    className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Model (optional)</label>
                  <input value={form.vehicle_model} onChange={(e) => setForm((f) => ({ ...f, vehicle_model: e.target.value }))}
                    className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Year (optional)</label>
                  <input value={form.vehicle_year} onChange={(e) => setForm((f) => ({ ...f, vehicle_year: e.target.value }))}
                    className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">VIN Number (optional)</label>
                  <input value={form.vehicle_vin} onChange={(e) => setForm((f) => ({ ...f, vehicle_vin: e.target.value }))}
                    className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Notes (optional)</label>
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
              </div>
            )}
            {isVehicleService && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                  Photo of the vehicle (optional)
                </label>
                <input type="file" accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null
                    if (f && f.size > MAX_SELECT_BYTES) { setErr('That photo is too large to use — try a different one.'); e.target.value = ''; setPhotoFile(null); return }
                    setErr(''); setPhotoFile(f)
                  }}
                  className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink" />
                <p className="mt-1 text-xs text-muted">We'll resize it automatically before sending.</p>
              </div>
            )}
          </div>

          <button type="submit" disabled={status === 'submitting' || !slot || !form.full_name.trim() || !form.email.trim()}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50">
            {status === 'submitting' ? 'Booking…' : slot ? `Book ${fmtSlot(slot)}` : 'Pick a time above'}
          </button>
        </form>
      </div>
    </div>
  )
}
