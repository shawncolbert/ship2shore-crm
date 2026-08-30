import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

// Public, no-login page for "Ask driver for quote" (Pipeline.jsx /
// create-carrier-quote.js) -- works for any driver, not just a saved
// contact, since all it needs is the link. Deliberately never shows the
// system's own mileage-based estimate; that's compared server-side (see
// carrier-quote.js's notifyOwnerOfQuote) so the driver's number stays
// independent instead of anchored to ours.
function post(body) {
  return fetch('/.netlify/functions/carrier-quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
    return j
  })
}

function mapsLink(pickup, dropoff) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dropoff)}&waypoints=${encodeURIComponent(pickup)}`
}

export default function CarrierQuotePublic() {
  const { token } = useParams()
  const [request, setRequest] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    post({ action: 'get', token }).then((r) => { setRequest(r); if (r.status === 'quoted') setDone(true) }).catch((e) => setLoadError(e.message))
  }, [token])

  const submit = async (e) => {
    e.preventDefault()
    const num = Number(amount)
    if (!name.trim()) { setError('Your name is required.'); return }
    if (!Number.isFinite(num) || num <= 0) { setError('Enter a valid price.'); return }
    setSending(true)
    setError('')
    try {
      await post({ action: 'submit', token, driver_name: name.trim(), driver_phone: phone.trim() || null, quoted_amount: num })
      setDone(true)
    } catch (e2) {
      setError(e2.message || 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-sm text-muted">{loadError === 'Quote request not found.' ? 'This link is no longer valid.' : loadError}</p>
        </div>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
          <div className="text-3xl">✅</div>
          <p className="mt-3 text-sm font-semibold text-ink">Thanks — your quote's been sent.</p>
          <p className="mt-1 text-xs text-muted">{request.orgName} will reach out if it's a fit.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-ink">🚚 What would you charge for this run?</h1>
        <p className="mt-1 text-sm text-muted">{request.orgName} wants a quote for this route.</p>

        <div className="mt-5 space-y-2 rounded-lg border border-line bg-canvas/50 p-4">
          <p className="text-sm text-ink">📍 <span className="font-semibold">Pickup:</span> {request.pickupAddress}</p>
          <p className="text-sm text-ink">🏁 <span className="font-semibold">Drop-off:</span> {request.dropoffAddress}</p>
          {request.miles && <p className="text-sm text-ink">🛣️ <span className="font-semibold">{Math.round(request.miles)} miles</span></p>}
          <a href={mapsLink(request.pickupAddress, request.dropoffAddress)} target="_blank" rel="noreferrer" className="inline-block text-xs text-accent hover:underline">
            🗺️ Open route in Maps
          </a>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-3">
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Phone (optional)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">💵 Your price for this run</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="1" placeholder="$"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
          </div>
          <button type="submit" disabled={sending}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-ink hover:bg-accent-600 disabled:opacity-50">
            {sending ? 'Sending…' : 'Send my quote'}
          </button>
        </form>
      </div>
    </div>
  )
}
