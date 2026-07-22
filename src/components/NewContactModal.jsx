import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContactWithBooking, fetchServices } from '../lib/supabase'

const SEGMENTS = [
  { value: '', label: '—' },
  { value: 'broker', label: 'Broker' },
  { value: 'dispatcher', label: 'Dispatcher' },
  { value: 'military', label: 'Military' },
  { value: 'transporter', label: 'Transporter' },
  { value: 'private', label: 'Private' },
  { value: 'other', label: 'Other' },
]

const PORTS = [
  { value: '', label: '—' },
  { value: 'long_beach', label: 'Long Beach' },
  { value: 'wilmington', label: 'Wilmington' },
  { value: 'matson', label: 'Matson' },
  { value: 'other', label: 'Other' },
]

const empty = {
  full_name: '',
  company: '',
  phone: '',
  email: '',
  segment: '',
}

const emptyBooking = {
  title: '',
  service_code: '',
  port: '',
  value: '',
}

export default function NewContactModal({ open, onClose }) {
  const qc = useQueryClient()
  const [form, setForm] = useState(empty)
  const [addBooking, setAddBooking] = useState(false)
  const [booking, setBooking] = useState(emptyBooking)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: fetchServices,
    enabled: open,
  })

  // Reset the form each time the modal is opened, and support Esc to close.
  useEffect(() => {
    if (open) {
      setForm(empty)
      setAddBooking(false)
      setBooking(emptyBooking)
      setError('')
      setBusy(false)
    }
    const onKey = (e) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setB = (k) => (e) => setBooking((b) => ({ ...b, [k]: e.target.value }))

  // When a service is picked, prefill the value with its default rate.
  const onService = (e) => {
    const code = e.target.value
    const svc = services.find((s) => s.code === code)
    setBooking((b) => ({
      ...b,
      service_code: code,
      value: b.value || (svc ? String(svc.default_rate) : ''),
    }))
  }

  const canSubmit =
    (form.full_name.trim() || form.company.trim() || form.phone.trim()) && !busy

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await createContactWithBooking({
        contact: form,
        booking: addBooking ? booking : null,
      })
      // Refresh anything that shows contacts or pipeline data.
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    } catch (err) {
      setError(err?.message || 'Could not save. Please try again.')
      setBusy(false)
    }
  }

  const field =
    'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add contact"
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-ink">
            New contact
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-ink">Name</span>
              <input
                value={form.full_name}
                onChange={set('full_name')}
                placeholder="Jane Doe"
                autoFocus
                className={field}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-ink">Phone</span>
              <input
                value={form.phone}
                onChange={set('phone')}
                placeholder="+13105551234"
                inputMode="tel"
                className={field}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-ink">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={set('email')}
                placeholder="jane@example.com"
                className={field}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-ink">Company</span>
              <input
                value={form.company}
                onChange={set('company')}
                placeholder="Acme Logistics"
                className={field}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-ink">Segment</span>
              <select value={form.segment} onChange={set('segment')} className={field}>
                {SEGMENTS.map((s) => (
                  <option key={s.label} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Optional booking */}
          <label className="mt-5 flex items-center gap-2">
            <input
              type="checkbox"
              checked={addBooking}
              onChange={(e) => setAddBooking(e.target.checked)}
              className="h-4 w-4 rounded border-line text-accent focus:ring-accent"
            />
            <span className="text-sm font-medium text-ink">
              Also add a booking to the pipeline
            </span>
          </label>

          {addBooking && (
            <div className="mt-3 grid gap-4 rounded-xl border border-line bg-canvas/60 p-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-ink">Job title</span>
                <input
                  value={booking.title}
                  onChange={setB('title')}
                  placeholder="TWIC escort — Long Beach"
                  className={field}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-ink">Service</span>
                <select value={booking.service_code} onChange={onService} className={field}>
                  <option value="">—</option>
                  {services.map((s) => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-ink">Port</span>
                <select value={booking.port} onChange={setB('port')} className={field}>
                  {PORTS.map((p) => (
                    <option key={p.label} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-ink">Value (USD)</span>
                <input
                  value={booking.value}
                  onChange={setB('value')}
                  placeholder="0"
                  inputMode="decimal"
                  className={field}
                />
              </label>

              <p className="text-xs text-muted sm:col-span-2">
                The card lands in your first pipeline stage (New Booking).
              </p>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">{error}</p>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-muted hover:bg-canvas hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : addBooking ? 'Add contact + booking' : 'Add contact'}
          </button>
        </div>
      </div>
    </div>
  )
}
