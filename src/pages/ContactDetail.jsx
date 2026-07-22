import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { fetchContact } from '../lib/supabase'
import Badge from '../components/Badge'

const money = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))

const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—')

export default function ContactDetail() {
  const { id } = useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => fetchContact(id),
  })

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading…</div>
  if (error) return <div className="p-8 text-sm text-port">Couldn’t load this contact.</div>

  const { contact, jobs, appointments, activities } = data

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Link to="/contacts" className="text-sm text-muted hover:text-ink">‹ Contacts</Link>

      <header className="mt-3 mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
              {contact.full_name || 'Unnamed contact'}
            </h1>
            <Badge segment={contact.segment} />
          </div>
          <p className="text-sm text-muted">{contact.company}</p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: details */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Details</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Phone" value={contact.phone} />
            <Row label="Email" value={contact.email} />
            <Row label="Source" value={contact.source} />
          </dl>
          {contact.tags?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {contact.tags.map((t) => (
                <span key={t} className="rounded bg-canvas px-2 py-0.5 text-[11px] text-ink">{t}</span>
              ))}
            </div>
          )}
          {contact.notes && <p className="mt-4 text-sm text-ink/80">{contact.notes}</p>}
        </section>

        {/* Middle: jobs + appointments */}
        <section className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Jobs</h2>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted">No jobs yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {jobs.map((j) => (
                  <li key={j.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink">
                      {j.title || j.service_code || 'Job'}
                      <span className="ml-2 text-xs text-muted">{j.stages?.name}</span>
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-ink">{money(j.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Appointments</h2>
            {appointments.length === 0 ? (
              <p className="text-sm text-muted">No appointments yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {appointments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink">{a.title || a.service_code || 'Appointment'}</span>
                    <span className="text-xs text-muted">{fmtDate(a.start_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Timeline</h2>
            {activities.length === 0 ? (
              <p className="text-sm text-muted">Nothing logged yet.</p>
            ) : (
              <ul className="space-y-3">
                {activities.map((ev) => (
                  <li key={ev.id} className="text-sm">
                    <span className="text-ink">{ev.body || ev.type}</span>
                    <span className="ml-2 text-xs text-muted">{fmtDate(ev.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{value || '—'}</dd>
    </div>
  )
}
