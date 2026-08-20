import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createContactWithBooking } from '../lib/supabase'
import AddressAutocompleteField from '../components/AddressAutocompleteField'
import PriceEstimator from '../components/PriceEstimator'
import { parsePastedText } from '../components/NewContactModal'

const empty = { full_name: '', phone: '', email: '' }
const emptyBooking = { pickup_address: '', dropoff_address: '', vehicle: '', value: '' }

// One-tap mobile entry point, deliberately outside <Layout> (no sidebar, no
// dashboard chrome) so a Home Screen shortcut lands directly on the whole
// screen being the form -- built after the ?new=1-triggers-a-modal approach
// on Pipeline.jsx proved unreliable for that use case, and because "get a
// quote form real quick" means an actual price, not just contact capture.
// Paste-parsing and address/price-estimator logic are the same shared
// pieces the full New contact modal uses -- this page just puts them all on
// one screen with nothing else to tap through first.
export default function QuickQuote() {
  const navigate = useNavigate()
  const [pasteText, setPasteText] = useState('')
  const [form, setForm] = useState(empty)
  const [booking, setBooking] = useState(emptyBooking)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setB = (k) => (e) => setBooking((b) => ({ ...b, [k]: e.target.value }))

  const onPasteText = (e) => {
    const text = e.target.value
    setPasteText(text)
    const parsed = parsePastedText(text)
    setForm((f) => ({ ...f, full_name: parsed.name || f.full_name, phone: parsed.phone || f.phone, email: parsed.email || f.email }))
    setBooking((b) => ({
      ...b,
      pickup_address: parsed.pickup || b.pickup_address,
      dropoff_address: parsed.dropoff || b.dropoff_address,
      vehicle: parsed.vehicle || b.vehicle,
    }))
  }

  const reset = () => {
    setPasteText('')
    setForm(empty)
    setBooking(emptyBooking)
    setError('')
    setDone(false)
  }

  const canSubmit = (form.full_name.trim() || form.phone.trim()) && !busy

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await createContactWithBooking({
        contact: form,
        booking: { ...booking, title: booking.vehicle || 'Quick quote', source_board: 'direct' },
      })
      setDone(true)
    } catch (err) {
      setError(err?.message || 'Could not save. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const field =
    'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-brand p-6 text-center">
        <div className="text-2xl">✅</div>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-white">Booking created</h1>
        <p className="max-w-xs text-sm text-white/70">
          {form.full_name || 'The contact'} is now in your pipeline{booking.value ? ` at $${Number(booking.value).toLocaleString()}` : ''}.
        </p>
        <button
          onClick={reset}
          className="mt-2 w-full max-w-xs rounded-md bg-accent px-4 py-3 text-base font-semibold text-ink hover:bg-accent-600"
        >
          Another quote
        </button>
        <button
          onClick={() => navigate('/pipeline')}
          className="w-full max-w-xs rounded-md border border-white/30 px-4 py-3 text-sm font-medium text-white hover:bg-white/10"
        >
          Open pipeline
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand pb-10">
      <div className="mx-auto max-w-md px-4 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="font-[family-name:var(--font-display)] text-xl font-bold text-white">Quick Quote</div>
            <div className="text-xs uppercase tracking-[0.2em] text-accent">Ship2Shore Dispatch</div>
          </div>
          <Link to="/dashboard" className="text-xs font-medium text-white/60 hover:text-white">Full CRM</Link>
        </div>

        <form onSubmit={submit} className="rounded-2xl bg-surface p-4 shadow-xl">
          <label className="mb-4 block rounded-xl border border-dashed border-line bg-canvas/60 p-3">
            <span className="text-sm font-medium text-ink">Paste customer's text</span>
            <textarea
              value={pasteText}
              onChange={onPasteText}
              placeholder={'e.g.\nJane Doe\n(310) 555-1234\nPickup: 123 Main St, Long Beach CA\nDrop-off: 456 Oak Ave, Phoenix AZ\nVehicle: 2022 Toyota Tacoma'}
              rows={4}
              autoFocus
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <span className="mt-1 block text-xs text-muted">Fills in everything below — check it over, all of it stays editable.</span>
          </label>

          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-ink">Name</span>
              <input value={form.full_name} onChange={set('full_name')} placeholder="Jane Doe" className={field} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-ink">Phone</span>
                <input value={form.phone} onChange={set('phone')} placeholder="(310) 555-1234" inputMode="tel" className={field} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Email</span>
                <input type="email" value={form.email} onChange={set('email')} placeholder="jane@example.com" className={field} />
              </label>
            </div>

            <AddressAutocompleteField label="Pickup" value={booking.pickup_address} onChange={(v) => setBooking((b) => ({ ...b, pickup_address: v }))} />
            <AddressAutocompleteField label="Drop-off" value={booking.dropoff_address} onChange={(v) => setBooking((b) => ({ ...b, dropoff_address: v }))} />

            <label className="block">
              <span className="text-sm font-medium text-ink">Vehicle</span>
              <input value={booking.vehicle} onChange={setB('vehicle')} placeholder="2022 Toyota Tacoma" className={field} />
            </label>

            <PriceEstimator
              pickup={booking.pickup_address}
              dropoff={booking.dropoff_address}
              onUseAmount={(v) => setBooking((b) => ({ ...b, value: String(v) }))}
            />

            <label className="block">
              <span className="text-sm font-medium text-ink">Quoted amount (USD)</span>
              <input value={booking.value} onChange={setB('value')} placeholder="0" inputMode="decimal" className={field} />
            </label>
          </div>

          {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-5 w-full rounded-md bg-accent px-4 py-3 text-base font-semibold text-ink transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Create booking'}
          </button>
        </form>
      </div>
    </div>
  )
}
