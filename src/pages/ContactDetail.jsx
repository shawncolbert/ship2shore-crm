import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import {
  fetchContact, fetchMyOrgId, fetchAttachments, uploadDeliveryOrder,
  signedAttachmentUrl, deleteAttachment, createUploadLink,
} from '../lib/supabase'
import { calendlyPrefillUrl, mailtoUrl } from '../lib/config'
import Badge from '../components/Badge'
import EmailComposer from '../components/EmailComposer'

const money = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—')

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const card = 'rounded-xl border border-line bg-surface p-5'
const h2 = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted'

export default function ContactDetail() {
  const { id } = useParams()
  const [emailOpen, setEmailOpen] = useState(false)
  const { data, isLoading, error } = useQuery({ queryKey: ['contact', id], queryFn: () => fetchContact(id) })

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading…</div>
  if (error) return <div className="p-8 text-sm text-port">Couldn’t load this contact.</div>

  const { contact, jobs, appointments, activities } = data

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Link to="/contacts" className="text-sm text-muted hover:text-ink">‹ Contacts</Link>

      <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
              {contact.full_name || 'Unnamed contact'}
            </h1>
            <Badge segment={contact.segment} />
          </div>
          <p className="text-sm text-muted">{contact.company}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {contact.email && (
            <button className={btn} onClick={() => setEmailOpen(true)}>✉️ Email</button>
          )}
          <a className={btnAccent} href={calendlyPrefillUrl(contact)} target="_blank" rel="noreferrer">📅 Book</a>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: details */}
        <section className={card}>
          <h2 className={h2}>Details</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Phone" value={contact.phone
              ? <a className="text-accent hover:underline" href={`tel:${contact.phone}`}>{contact.phone}</a> : null} />
            <Row label="Email" value={contact.email
              ? <a className="text-accent hover:underline" href={mailtoUrl(contact)}>{contact.email}</a> : null} />
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

        {/* Middle: jobs + appointments + timeline */}
        <section className="space-y-6 lg:col-span-2">
          <div className={card}>
            <h2 className={h2}>Jobs</h2>
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

          <div className={card}>
            <h2 className={h2}>Appointments</h2>
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

          <div className={card}>
            <h2 className={h2}>Timeline</h2>
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

      {/* Delivery orders / files */}
      <div className="mt-6">
        <DeliveryOrders contact={contact} jobs={jobs} />
      </div>

      {/* Live Calendly booking, prefilled */}
      <div className={`mt-6 ${card}`}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className={h2}>Schedule appointment</h2>
          <a className="text-sm text-accent hover:underline" href={calendlyPrefillUrl(contact)} target="_blank" rel="noreferrer">Open in new tab ↗</a>
        </div>
        <p className="mb-3 text-sm text-muted">
          Prefilled with {contact.full_name || 'this contact'}{contact.email ? ` · ${contact.email}` : ''}. Pick a time to book.
        </p>
        <iframe
          title="Book on Calendly"
          src={calendlyPrefillUrl(contact, { embed: true })}
          className="w-full rounded-lg border border-line"
          style={{ height: 640 }}
          loading="lazy"
        />
      </div>

      {emailOpen && <EmailComposer contact={contact} onClose={() => setEmailOpen(false)} />}
    </div>
  )
}

function DeliveryOrders({ contact, jobs }) {
  const qc = useQueryClient()
  const inputRef = useRef(null)
  const [jobId, setJobId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  const { data: orgId } = useQuery({ queryKey: ['myOrgId'], queryFn: fetchMyOrgId })
  const { data: files } = useQuery({ queryKey: ['attachments', contact.id], queryFn: () => fetchAttachments(contact.id) })

  async function onPick(e) {
    const chosen = Array.from(e.target.files || [])
    if (!chosen.length || !orgId) return
    setBusy(true); setErr(''); setInfo('')
    try {
      for (const file of chosen) {
        await uploadDeliveryOrder({ orgId, contactId: contact.id, opportunityId: jobId || null, file })
      }
      qc.invalidateQueries({ queryKey: ['attachments', contact.id] })
    } catch (e2) {
      setErr('Upload failed: ' + (e2.message || e2))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function download(f) {
    try { window.open(await signedAttachmentUrl(f.file_path), '_blank', 'noopener') }
    catch (e) { setErr(e.message) }
  }

  async function remove(f) {
    if (!confirm(`Delete ${f.file_name}?`)) return
    try { await deleteAttachment({ id: f.id, filePath: f.file_path }); qc.invalidateQueries({ queryKey: ['attachments', contact.id] }) }
    catch (e) { setErr(e.message) }
  }

  async function requestLink() {
    if (!orgId) return
    setBusy(true); setErr(''); setInfo('')
    try {
      const url = await createUploadLink({ orgId, contactId: contact.id, opportunityId: jobId || null, label: contact.full_name })
      try { await navigator.clipboard.writeText(url) } catch { /* clipboard may be blocked */ }
      setInfo(`Customer upload link (copied · valid 30 days): ${url}`)
    } catch (e) {
      setErr('Could not create link: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  const kb = (n) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '')

  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className={h2 + ' mb-0'}>Delivery Orders &amp; Files{files ? ` (${files.length})` : ''}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {jobs.length > 0 && (
            <select value={jobId} onChange={(e) => setJobId(e.target.value)}
              className="rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:border-accent">
              <option value="">No job link</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title || j.service_code || 'Job'}</option>)}
            </select>
          )}
          <button className={btn} disabled={busy} onClick={requestLink}>🔗 Request from customer</button>
          <button className={btnAccent} disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Working…' : '⬆️ Upload'}
          </button>
          <input ref={inputRef} type="file" multiple hidden onChange={onPick}
            accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx,.xls,.xlsx" />
        </div>
      </div>

      {err && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
      {info && <p className="mb-3 break-all rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">🔗 {info}</p>}

      {!files ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted">No delivery orders yet. Upload a PDF or photo, or send the customer an upload link.</p>
      ) : (
        <ul className="divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <button onClick={() => download(f)} className="flex min-w-0 items-center gap-2 text-left">
                <span>📄</span>
                <span className="min-w-0">
                  <span className="block truncate text-ink">{f.file_name}</span>
                  <span className="block text-xs text-muted">{kb(f.size_bytes)}{f.opportunities?.title ? ` · ${f.opportunities.title}` : ''}</span>
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-1">
                <button onClick={() => download(f)} className="rounded px-2 py-1 text-xs text-muted hover:bg-canvas hover:text-ink">Download</button>
                <button onClick={() => remove(f)} className="rounded px-2 py-1 text-xs text-muted hover:bg-canvas hover:text-port">🗑️</button>
              </span>
            </li>
          ))}
        </ul>
      )}
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
