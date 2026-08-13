import { useState, useRef, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import {
  fetchContact, fetchMyOrgId, fetchAttachments, uploadDeliveryOrder,
  signedAttachmentUrl, deleteAttachment, createUploadLink, updateContact,
  sendEmail, markAttachmentViewed, deleteAppointment,
} from '../lib/supabase'
import { calendlyPrefillUrl, mailtoUrl } from '../lib/config'
import Badge from '../components/Badge'
import EmailComposer from '../components/EmailComposer'

const money = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—')
const googleDirectionsUrl = (from, to) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`
const appleDirectionsUrl = (from, to) =>
  `https://maps.apple.com/?saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(to)}&dirflg=d`

const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const h2 = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted'

export default function ContactDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [emailOpen, setEmailOpen] = useState(false)
  const { data, isLoading, error } = useQuery({ queryKey: ['contact', id], queryFn: () => fetchContact(id) })

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading…</div>
  if (error) return <div className="p-8 text-sm text-port">Couldn’t load this contact.</div>

  const { contact, jobs, appointments, activities } = data

  const removeAppointment = async (a) => {
    if (!confirm(`Delete this appointment (${a.title || a.service_code || 'Appointment'} — ${fmtDate(a.start_at)})? This can't be undone.`)) return
    await deleteAppointment(a.id)
    qc.invalidateQueries({ queryKey: ['contact', id] })
  }

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
        <ContactDetails contact={contact} />

        {/* Middle: jobs + appointments + timeline */}
        <section className="space-y-6 lg:col-span-2">
          <div className={card}>
            <h2 className={h2}>Jobs</h2>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted">No jobs yet.</p>
            ) : (
              <JobsTable jobs={jobs} />
            )}
          </div>

          <div className={card}>
            <h2 className={h2}>Appointments</h2>
            {appointments.length === 0 ? (
              <p className="text-sm text-muted">No appointments yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {appointments.map((a) => (
                  <li key={a.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink">{a.title || a.service_code || 'Appointment'}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted">{fmtDate(a.start_at)}</span>
                        <button onClick={() => removeAppointment(a)} title="Delete this appointment"
                          className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-500">🗑️</button>
                      </span>
                    </div>
                    {(a.pickup_address || a.dropoff_address) && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span>
                          {a.pickup_address || '—'} → {a.dropoff_address || '—'}
                          {a.distance_miles != null && ` (${a.distance_miles} mi)`}
                        </span>
                        {a.pickup_address && a.dropoff_address && (
                          <>
                            <a
                              href={googleDirectionsUrl(a.pickup_address, a.dropoff_address)}
                              target="_blank" rel="noreferrer"
                              className="font-semibold text-accent hover:underline"
                            >
                              Google Maps ↗
                            </a>
                            <a
                              href={appleDirectionsUrl(a.pickup_address, a.dropoff_address)}
                              target="_blank" rel="noreferrer"
                              className="font-semibold text-accent hover:underline"
                            >
                              Apple Maps ↗
                            </a>
                          </>
                        )}
                      </div>
                    )}
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

// Presets for the "which document am I asking for" picker -- subject/body
// are just a starting point, both stay fully editable before sending.
const DOC_REQUEST_PRESETS = {
  delivery_order: {
    label: 'Delivery Order',
    subject: 'Delivery Order Needed',
    body: (firstName) => `Hi ${firstName},\n\nWe're ready to move forward and need your delivery order (POA and delivery details) to proceed.`,
  },
  doc_receipt: {
    label: 'Doc Receipt',
    subject: 'Documentation Receipt Needed',
    body: (firstName) => `Hi ${firstName},\n\nWe need the documentation receipt to pick up the container/cargo. Please send it over so we can proceed.`,
  },
  gate_pass: {
    label: 'Gate Pass',
    subject: 'Gate Pass Needed',
    body: (firstName) => `Hi ${firstName},\n\nWe need your gate pass to proceed with pickup. Please send it over when you get a chance.`,
  },
  supporting_docs: {
    label: 'Supporting Documents',
    subject: 'Supporting Documents Needed',
    body: (firstName) => `Hi ${firstName},\n\nCould you send over any supporting documents for this job (delivery order, gate pass, doc receipt, or similar)? Whatever you have is a help.`,
  },
  custom: {
    label: 'Custom',
    subject: '',
    body: () => '',
  },
}

// Compact by default -- one row per job, tap to expand for the fields that
// don't fit on a line (status, service, port, scheduled date) instead of
// spreading every job out full-height on the page all the time.
function JobsTable({ jobs }) {
  const [expanded, setExpanded] = useState(() => new Set())
  const toggle = (id) => setExpanded((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <th className="w-5 py-1.5"></th>
            <th className="py-1.5 pr-2">Job</th>
            <th className="py-1.5 pr-2">Stage</th>
            <th className="py-1.5 pr-0 text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const isOpen = expanded.has(j.id)
            return (
              <Fragment key={j.id}>
                <tr
                  onClick={() => toggle(j.id)}
                  className="cursor-pointer border-b border-line hover:bg-canvas"
                >
                  <td className="py-2 text-muted">{isOpen ? '▾' : '▸'}</td>
                  <td className="py-2 pr-2 text-ink">{j.title || j.service_code || 'Job'}</td>
                  <td className="py-2 pr-2 text-xs text-muted">{j.stages?.name || '—'}</td>
                  <td className="py-2 pr-0 text-right font-[family-name:var(--font-mono)] text-ink">{money(j.value)}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line bg-canvas/50">
                    <td />
                    <td colSpan={3} className="py-2 pr-2">
                      <div className="grid gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-2">
                        <div>Status: <span className="text-ink">{j.status || '—'}</span></div>
                        <div>Service: <span className="text-ink">{j.service_code || '—'}</span></div>
                        <div>Port: <span className="text-ink">{j.port || '—'}</span></div>
                        <div>Scheduled: <span className="text-ink">{fmtDate(j.scheduled_at)}</span></div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
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
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [docType, setDocType] = useState('delivery_order')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const firstName = (contact.full_name || '').split(/\s+/)[0] || 'there'

  function openRequestForm() {
    if (!contact.email) {
      setErr('This contact has no email on file — add one before requesting a document.')
      return
    }
    setErr(''); setInfo('')
    applyPreset('delivery_order')
    setShowRequestForm(true)
  }

  function applyPreset(key) {
    setDocType(key)
    const preset = DOC_REQUEST_PRESETS[key]
    setSubject(preset.subject)
    setBody(preset.body(firstName))
  }

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
    try {
      window.open(await signedAttachmentUrl(f.file_path), '_blank', 'noopener')
      markAttachmentViewed(f.id).catch(() => {})
    } catch (e) { setErr(e.message) }
  }

  async function remove(f) {
    if (!confirm(`Delete ${f.file_name}?`)) return
    try { await deleteAttachment({ id: f.id, filePath: f.file_path }); qc.invalidateQueries({ queryKey: ['attachments', contact.id] }) }
    catch (e) { setErr(e.message) }
  }

  async function sendRequest() {
    if (!orgId) return
    if (!subject.trim() || !body.trim()) { setErr('Subject and message are required.'); return }
    setBusy(true); setErr(''); setInfo('')
    try {
      const url = await createUploadLink({ orgId, contactId: contact.id, opportunityId: jobId || null, label: contact.full_name })
      const fullBody = `${body}\n\nPlease upload it using this secure link — no account needed:\n${url}\n\nThis link is valid for 30 days.\n\nThanks,\nDispatch`
      await sendEmail({ contactId: contact.id, to: contact.email, subject, body: fullBody })
      setInfo(`✓ ${DOC_REQUEST_PRESETS[docType].label} request emailed to ${contact.email}.`)
      setShowRequestForm(false)
    } catch (e) {
      setErr('Could not send document request: ' + (e.message || e))
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
          <button className={btn} disabled={busy} onClick={openRequestForm}>📋 Request a Document</button>
          <button className={btnAccent} disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Working…' : '⬆️ Upload'}
          </button>
          <input ref={inputRef} type="file" multiple hidden onChange={onPick}
            accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx,.xls,.xlsx" />
        </div>
      </div>

      {err && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
      {info && <p className="mb-3 break-all rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">🔗 {info}</p>}

      {showRequestForm && (
        <div className="mb-4 space-y-3 rounded-lg border border-line bg-canvas/50 p-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">What are you asking for?</label>
            <select
              value={docType}
              onChange={(e) => applyPreset(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              {Object.entries(DOC_REQUEST_PRESETS).map(([key, p]) => (
                <option key={key} value={key}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <p className="mt-1 text-xs text-muted">The secure upload link and its 30-day note are added automatically after this message.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowRequestForm(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">
              Cancel
            </button>
            <button onClick={sendRequest} disabled={busy} className={btnAccent}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </div>
      )}

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

const emailOk = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

function ContactDetails({ contact }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [form, setForm] = useState(null)

  function startEdit() {
    setForm({
      full_name: contact.full_name || '',
      company: contact.company || '',
      phone: contact.phone || '',
      email: contact.email || '',
      notes: contact.notes || '',
    })
    setErr(''); setSaved(false); setEditing(true)
  }

  function cancel() { setEditing(false); setErr('') }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save() {
    if (!form.full_name.trim()) { setErr('Name can’t be empty.'); return }
    if (!emailOk(form.email)) { setErr('That email doesn’t look right.'); return }
    setSaving(true); setErr('')
    try {
      await updateContact(contact.id, form)
      await qc.invalidateQueries({ queryKey: ['contact', contact.id] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      setEditing(false); setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr('Couldn’t save: ' + (e.message || e))
    } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <section className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className={h2 + ' mb-0'}>Edit details</h2>
        </div>
        <div className="space-y-3 text-sm">
          <Field label="Name" value={form.full_name} onChange={set('full_name')} placeholder="Full name" />
          <Field label="Company" value={form.company} onChange={set('company')} placeholder="Company" />
          <Field label="Phone" value={form.phone} onChange={set('phone')} placeholder="+1 555-000-0000" type="tel" />
          <Field label="Email" value={form.email} onChange={set('email')} placeholder="name@example.com" type="email" />
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={3}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
          </div>
          {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button className={btnAccent} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            <button className={btn} disabled={saving} onClick={cancel}>Cancel</button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className={card}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className={h2 + ' mb-0'}>Details</h2>
        <button className="text-xs font-medium text-accent hover:underline" onClick={startEdit}>Edit</button>
      </div>
      {saved && <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ Saved</p>}
      <dl className="space-y-2 text-sm">
        <Row label="Phone" value={contact.phone
          ? <a className="text-accent hover:underline" href={`tel:${contact.phone}`}>{contact.phone}</a> : null} />
        <Row label="Email" value={contact.email
          ? <a className="text-accent hover:underline" href={mailtoUrl(contact)}>{contact.email}</a> : null} />
        {contact.custom_fields?.title && <Row label="Title" value={contact.custom_fields.title} />}
        {contact.custom_fields?.address && <Row label="Address" value={contact.custom_fields.address} />}
        {contact.custom_fields?.website && (
          <Row label="Website" value={
            <a className="text-accent hover:underline" href={/^https?:\/\//i.test(contact.custom_fields.website) ? contact.custom_fields.website : `https://${contact.custom_fields.website}`} target="_blank" rel="noreferrer">
              {contact.custom_fields.website}
            </a>
          } />
        )}
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
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-all text-right text-ink">{value || '—'}</dd>
    </div>
  )
}
