import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

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

export default function PublicBooking() {
  const { orgSlug } = useParams()
  const [searchParams] = useSearchParams()
  const ref = searchParams.get('ref')
  const [roundTheClock, setRoundTheClock] = useState(false)
  const days = useMemo(() => upcomingDays(roundTheClock), [roundTheClock])
  const [services, setServices] = useState(null)
  const [orgName, setOrgName] = useState('us')
  const [serviceCode, setServiceCode] = useState('')
  const [dateKey, setDateKey] = useState(days[0]?.key || '')
  const [slots, setSlots] = useState(null)
  const [slot, setSlot] = useState('')
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', notes: '' })
  const [status, setStatus] = useState('idle') // idle | submitting | done | error
  const [err, setErr] = useState('')

  useEffect(() => {
    callBooking('services', orgSlug, ref).then((r) => {
      setServices(r.services || [])
      setServiceCode(r.services?.[0]?.code || '')
      setOrgName(r.orgName || 'us')
      setRoundTheClock(!!r.roundTheClock)
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

  async function submit(e) {
    e.preventDefault()
    if (!serviceCode || !slot || !form.full_name.trim() || !form.email.trim()) return
    setStatus('submitting'); setErr('')
    try {
      await callBooking('book', orgSlug, ref, {
        service_code: serviceCode, start_at: slot,
        full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
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
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas p-4 sm:p-8">
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
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
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Notes (optional)</label>
              <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
            </div>
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
