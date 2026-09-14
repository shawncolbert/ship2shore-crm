import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchProspects, createProspect, updateProspectStatus, updateProspectEmail, deleteProspect,
  parseCsvFile, importProspects,
  searchBusinesses, addProspectsFromSearch,
  fetchSequences, saveSequence, deleteSequence,
  enrollProspects, fetchEnrollments, stopEnrollment,
  fetchDoNotContact, addDoNotContact, removeDoNotContact,
  saveTwilioCredentials,
} from '../lib/outreach'
import { fetchMyOrg, fetchMyOrgId } from '../lib/supabase'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const field = 'mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const btnGhost = 'rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent'

const STATUS_LABELS = { new: 'New', contacted: 'Contacted', replied: 'Replied', converted: 'Converted', do_not_contact: 'Do not contact' }
const STATUS_COLORS = {
  new: 'bg-line/60 text-muted', contacted: 'bg-accent/15 text-ink',
  replied: 'bg-starboard/15 text-starboard', converted: 'bg-starboard/25 text-starboard',
  do_not_contact: 'bg-red-100 text-red-600',
}

const TABS = [
  { key: 'prospects', label: 'Prospects' },
  { key: 'sequences', label: 'Sequences' },
  { key: 'suppression', label: 'Suppression List' },
]

export default function Outreach() {
  const [tab, setTab] = useState('prospects')

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Prospecting &amp; Outreach</h1>
        <p className="max-w-2xl text-sm text-muted">
          Find local businesses, then follow up automatically over email. Every send carries an unsubscribe
          link and your business address, and nothing goes out to anyone on your suppression list.
        </p>
      </header>

      <div className="mb-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.key ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'prospects' && <ProspectsTab />}
      {tab === 'sequences' && <SequencesTab />}
      {tab === 'suppression' && <SuppressionTab />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Prospects                                                            */
/* ------------------------------------------------------------------ */

function ProspectsTab() {
  const qc = useQueryClient()
  const fileRef = useRef(null)
  const { data: prospects, isLoading } = useQuery({ queryKey: ['prospects'], queryFn: () => fetchProspects() })
  const { data: sequences } = useQuery({ queryKey: ['outreachSequences'], queryFn: fetchSequences })

  const [selected, setSelected] = useState(new Set())
  const [enrollSeq, setEnrollSeq] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ business_name: '', email: '', phone: '', website: '', industry: '', city: '', state: '' })
  const [err, setErr] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['prospects'] })

  const toggle = (id) => setSelected((s) => {
    const next = new Set(s)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const onImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true); setImportSummary(null)
    try {
      const { rows } = await parseCsvFile(file)
      const result = await importProspects(rows)
      setImportSummary(result)
      invalidate()
    } catch (ex) {
      setImportSummary({ imported: 0, skipped: 0, failed: [{ error: ex.message }] })
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const addProspect = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.business_name.trim()) { setErr('Business name is required.'); return }
    try {
      await createProspect(form)
      setForm({ business_name: '', email: '', phone: '', website: '', industry: '', city: '', state: '' })
      setShowAdd(false)
      invalidate()
    } catch (ex) {
      setErr(ex.message || 'Could not add this prospect.')
    }
  }

  const doEnroll = async () => {
    if (!enrollSeq || !selected.size) return
    setEnrolling(true)
    try {
      await enrollProspects({ prospectIds: [...selected], sequenceId: enrollSeq })
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['outreachEnrollments'] })
    } finally {
      setEnrolling(false)
    }
  }

  const [showFind, setShowFind] = useState(false)

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-wrap items-center gap-3`}>
        <button onClick={() => setShowFind((s) => !s)} className={btnAccent}>🔍 Find prospects</button>
        <button onClick={() => setShowAdd((s) => !s)} className={btnGhost}>+ Add prospect</button>
        <label className={`${btnGhost} cursor-pointer`}>
          {importing ? 'Importing…' : 'Import CSV'}
          <input ref={fileRef} type="file" accept=".csv" onChange={onImportFile} disabled={importing} className="hidden" />
        </label>
        <span className="text-xs text-muted">Columns: business_name, industry, website, phone, email, city, state</span>
      </div>

      {showFind && <FindProspectsPanel onAdded={invalidate} onClose={() => setShowFind(false)} />}

      {importSummary && (
        <p className="text-xs text-muted">
          Imported {importSummary.imported}, skipped {importSummary.skipped}
          {importSummary.failed?.length ? `, ${importSummary.failed.length} failed` : ''}.
        </p>
      )}

      {showAdd && (
        <form onSubmit={addProspect} className={`${card} grid gap-3 sm:grid-cols-2`}>
          {err && <p className="text-xs text-port sm:col-span-2">{err}</p>}
          <label className="text-xs font-medium text-muted">Business name
            <input className={field} value={form.business_name} onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-muted">Email
            <input className={field} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-muted">Phone
            <input className={field} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-muted">Website
            <input className={field} value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-muted">Industry
            <input className={field} value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-medium text-muted">City
              <input className={field} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </label>
            <label className="text-xs font-medium text-muted">State
              <input className={field} value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
            </label>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={btnAccent}>Add prospect</button>
          </div>
        </form>
      )}

      {!!selected.size && (
        <div className={`${card} flex flex-wrap items-center gap-3`}>
          <span className="text-xs font-medium text-ink">{selected.size} selected</span>
          <select value={enrollSeq} onChange={(e) => setEnrollSeq(e.target.value)} className="rounded-md border border-line bg-canvas px-2 py-1.5 text-xs text-ink">
            <option value="">Enroll in sequence…</option>
            {sequences?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={doEnroll} disabled={!enrollSeq || enrolling} className={btnAccent}>
            {enrolling ? 'Enrolling…' : 'Enroll'}
          </button>
        </div>
      )}

      <div className={`${card} overflow-x-auto`}>
        {isLoading && <p className="text-xs text-muted">Loading…</p>}
        {!isLoading && !prospects?.length && <p className="text-xs text-muted">No prospects yet — add one or import a CSV.</p>}
        {!!prospects?.length && (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted">
                <th className="w-6"></th>
                <th className="pb-2 pr-3">Business</th>
                <th className="pb-2 pr-3">Contact</th>
                <th className="pb-2 pr-3">Location</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-2"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td className="py-2 pr-3 font-medium text-ink">{p.business_name}{p.industry ? <span className="ml-1.5 text-muted">· {p.industry}</span> : null}</td>
                  <td className="py-2 pr-3 text-muted"><EditableEmail prospect={p} onSaved={invalidate} /></td>
                  <td className="py-2 pr-3 text-muted">{[p.city, p.state].filter(Boolean).join(', ') || '—'}</td>
                  <td className="py-2 pr-3">
                    <select
                      value={p.status}
                      onChange={async (e) => { await updateProspectStatus(p.id, e.target.value); invalidate() }}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_COLORS[p.status]}`}
                    >
                      {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td className="py-2 text-right">
                    <button onClick={async () => { await deleteProspect(p.id); invalidate() }} className="text-muted hover:text-red-500">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <EnrollmentsCard />
    </div>
  )
}

// Phase 2: real business search (Google Places), scored only on public
// signals -- no website? weak reviews? -- never a personal profile. Places
// never returns an email, so results show a "no email" notice; add one by
// hand (edit isn't built yet here, so add manually via + Add prospect with
// the same name) before enrolling someone found this way in a sequence.
function FindProspectsPanel({ onAdded, onClose }) {
  const [industry, setIndustry] = useState('')
  const [location, setLocation] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  const search = async (e) => {
    e.preventDefault()
    setErr('')
    if (!industry.trim() || !location.trim()) { setErr('Enter both an industry and a location.'); return }
    setSearching(true)
    try {
      const r = await searchBusinesses({ industry, location })
      setResults(r)
      setSelected(new Set())
    } catch (ex) {
      setErr(ex.message || 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  const toggle = (i) => setSelected((s) => {
    const next = new Set(s)
    next.has(i) ? next.delete(i) : next.add(i)
    return next
  })

  const addSelected = async () => {
    if (!selected.size) return
    setAdding(true)
    try {
      await addProspectsFromSearch([...selected].map((i) => results[i]))
      onAdded()
      setResults(null)
      setSelected(new Set())
    } catch (ex) {
      setErr(ex.message || 'Could not add these prospects.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Find prospects by industry + location</h2>
        <button onClick={onClose} className="text-xs text-muted hover:text-ink">✕</button>
      </div>
      <p className="text-xs text-muted">
        Real businesses from Google's own listings, scored on what's public — no website, weak reviews. Google
        never shares an email address, so add one by hand once you've found it before enrolling someone in a sequence.
      </p>
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-port">{err}</p>}
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. wedding photographer" className={`${field} max-w-xs`} />
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Long Beach, CA" className={`${field} max-w-xs`} />
        <button type="submit" disabled={searching} className={btnAccent}>{searching ? 'Searching…' : 'Search'}</button>
      </form>

      {results && !results.length && <p className="text-xs text-muted">No results for that search.</p>}
      {!!results?.length && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{results.length} found</span>
            <button onClick={addSelected} disabled={!selected.size || adding} className={btnAccent}>
              {adding ? 'Adding…' : `Add selected (${selected.size})`}
            </button>
          </div>
          <div className="max-h-96 space-y-1.5 overflow-y-auto">
            {results.map((r, i) => (
              <label key={i} className="flex items-start gap-2 rounded-lg border border-line bg-canvas/50 px-3 py-2 text-xs hover:border-accent">
                <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{r.business_name}</p>
                  <p className="text-muted">{[r.city, r.state].filter(Boolean).join(', ') || r.address}{r.phone ? ` · ${r.phone}` : ''}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.website ? 'bg-line/60 text-muted' : 'bg-red-100 text-red-600'}`}>
                      {r.website ? 'Has website' : 'No website'}
                    </span>
                    <span className="rounded-full bg-line/60 px-2 py-0.5 text-[10px] font-semibold text-muted">
                      {r.rating ? `${r.rating}★ (${r.review_count})` : `${r.review_count} reviews`}
                    </span>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// A prospect added by hand or CSV usually already has an email; one found
// via Places search never does (Google doesn't expose them) -- this is the
// one place to fill that in, since a missing email is what blocks
// enrolling someone in a sequence at all.
function EditableEmail({ prospect, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(prospect.email || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await updateProspectEmail(prospect.id, value)
      onSaved()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          placeholder="email@example.com"
          className="w-40 rounded border border-line bg-canvas px-1.5 py-1 text-xs text-ink outline-none focus:border-accent"
        />
        <button onClick={save} disabled={saving} className="text-starboard hover:underline">✓</button>
      </span>
    )
  }
  return (
    <button onClick={() => setEditing(true)} className="hover:text-ink hover:underline">
      {prospect.email || prospect.phone || <span className="italic text-red-500">no email — click to add</span>}
    </button>
  )
}

function EnrollmentsCard() {
  const { data: enrollments } = useQuery({ queryKey: ['outreachEnrollments'], queryFn: fetchEnrollments })
  const qc = useQueryClient()
  if (!enrollments?.length) return null
  return (
    <div className={`${card} overflow-x-auto`}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Active enrollments</h2>
      <table className="w-full text-left text-xs">
        <thead><tr className="text-muted"><th className="pb-2 pr-3">Prospect</th><th className="pb-2 pr-3">Sequence</th><th className="pb-2 pr-3">Step</th><th className="pb-2 pr-3">Status</th><th className="pb-2"></th></tr></thead>
        <tbody>
          {enrollments.map((e) => (
            <tr key={e.id} className="border-t border-line">
              <td className="py-2 pr-3 text-ink">{e.prospects?.business_name}</td>
              <td className="py-2 pr-3 text-muted">{e.outreach_sequences?.name}</td>
              <td className="py-2 pr-3 text-muted">{e.current_step + 1}</td>
              <td className="py-2 pr-3 text-muted capitalize">{e.status}</td>
              <td className="py-2 text-right">
                {e.status === 'active' && (
                  <button onClick={async () => { await stopEnrollment(e.id); qc.invalidateQueries({ queryKey: ['outreachEnrollments'] }) }} className="text-muted hover:text-red-500">Stop</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sequences                                                            */
/* ------------------------------------------------------------------ */

const emptyStep = () => ({ channel: 'email', subject: '', body: '', delay_days: 0 })

function SequencesTab() {
  const qc = useQueryClient()
  const { data: sequences, isLoading } = useQuery({ queryKey: ['outreachSequences'], queryFn: fetchSequences })
  const [editing, setEditing] = useState(null) // sequence object being edited, or {name:'', steps:[]} for new

  const invalidate = () => qc.invalidateQueries({ queryKey: ['outreachSequences'] })

  if (editing) {
    return <SequenceEditor sequence={editing} onClose={() => setEditing(null)} onSaved={() => { invalidate(); setEditing(null) }} />
  }

  return (
    <div className="space-y-4">
      <TwilioSettingsCard />
      <button onClick={() => setEditing({ name: '', steps: [emptyStep()], active: true })} className={btnAccent}>+ New sequence</button>
      {isLoading && <p className="text-xs text-muted">Loading…</p>}
      {!isLoading && !sequences?.length && <p className="text-xs text-muted">No sequences yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {sequences?.map((s) => (
          <div key={s.id} className={card}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{s.name}</p>
                <p className="text-xs text-muted">
                  {s.steps?.length || 0} step{s.steps?.length === 1 ? '' : 's'} · {s.active ? 'Active' : 'Paused'}
                  {s.steps?.some((step) => step.channel === 'sms') ? ' · includes SMS' : ''}
                </p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditing(s)} className={btnGhost}>Edit</button>
                <button onClick={async () => { await deleteSequence(s.id); invalidate() }} className="text-muted hover:text-red-500">✕</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// One-time org setting, same isolation principle as the Telegram bot on
// Dispatch Assignment: each org pastes in its OWN Twilio account, blank
// means SMS steps just don't send for that org, never silently borrow
// another org's number.
function TwilioSettingsCard() {
  const qc = useQueryClient()
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg })
  const [accountSid, setAccountSid] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setAccountSid(org?.twilio_account_sid || '')
    setAuthToken(org?.twilio_auth_token || '')
    setPhoneNumber(org?.twilio_phone_number || '')
  }, [org?.twilio_account_sid, org?.twilio_auth_token, org?.twilio_phone_number])

  const dirty = accountSid.trim() !== (org?.twilio_account_sid || '')
    || authToken.trim() !== (org?.twilio_auth_token || '')
    || phoneNumber.trim() !== (org?.twilio_phone_number || '')

  const save = async () => {
    setSaving(true); setSaved(false)
    try {
      const orgId = await fetchMyOrgId()
      await saveTwilioCredentials(orgId, { accountSid, authToken, phoneNumber })
      qc.invalidateQueries({ queryKey: ['myOrg'] })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const configured = !!(org?.twilio_account_sid && org?.twilio_auth_token && org?.twilio_phone_number)

  return (
    <div className={`${card} space-y-3`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <div>
          <h2 className="text-sm font-semibold text-ink">SMS (Twilio)</h2>
          <p className="text-xs text-muted">
            {configured ? `Connected — sending from ${org.twilio_phone_number}` : 'Not connected — SMS steps won\'t send until this is set up'}
          </p>
        </div>
        <span className="text-xs text-muted">{open ? 'Hide ▲' : 'Set up ▼'}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-xs text-muted">
            From your own Twilio console (console.twilio.com) — Account SID and Auth Token are on the dashboard,
            the phone number is whichever one you've purchased there. This number must be yours; texting from a
            number you don't own risks it getting blocked by carriers.
          </p>
          <label className="block text-xs font-medium text-muted">Account SID
            <input className={field} value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </label>
          <label className="block text-xs font-medium text-muted">Auth token
            <input type="password" className={field} value={authToken} onChange={(e) => setAuthToken(e.target.value)} />
          </label>
          <label className="block text-xs font-medium text-muted">Twilio phone number
            <input className={field} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+15551234567" />
          </label>
          <button onClick={save} disabled={!dirty || saving} className={btnAccent}>{saving ? 'Saving…' : 'Save'}</button>
          {saved && !dirty && <span className="ml-2 text-xs text-starboard">Saved</span>}
        </div>
      )}
    </div>
  )
}

function SequenceEditor({ sequence, onClose, onSaved }) {
  const [name, setName] = useState(sequence.name)
  const [steps, setSteps] = useState(sequence.steps?.length ? sequence.steps : [emptyStep()])
  const [active, setActive] = useState(sequence.active !== false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const setStep = (i, patch) => setSteps((s) => s.map((step, idx) => (idx === i ? { ...step, ...patch } : step)))
  const addStep = () => setSteps((s) => [...s, emptyStep()])
  const removeStep = (i) => setSteps((s) => s.filter((_, idx) => idx !== i))

  const save = async () => {
    setErr('')
    if (!name.trim()) { setErr('Give this sequence a name.'); return }
    if (!steps.length || steps.some((s) => (s.channel !== 'sms' && !s.subject.trim()) || !s.body.trim())) {
      setErr('Every step needs a body (and a subject, for email steps).'); return
    }
    setSaving(true)
    try {
      await saveSequence({ id: sequence.id, name: name.trim(), steps, active })
      onSaved()
    } catch (ex) {
      setErr(ex.message || 'Could not save this sequence.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="text-xs font-medium text-muted hover:text-ink">← Back to sequences</button>
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-port">{err}</p>}
      <div className={`${card} space-y-3`}>
        <label className="block text-xs font-medium text-muted">Sequence name
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Long Beach photographers — intro" />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active — enrolled prospects keep receiving steps
        </label>
      </div>

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className={`${card} space-y-2`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Step {i + 1}</span>
              {steps.length > 1 && <button onClick={() => removeStep(i)} className="text-xs text-muted hover:text-red-500">Remove</button>}
            </div>
            {i > 0 && (
              <label className="block text-xs font-medium text-muted">Send this many days after the previous step
                <input type="number" min="0" className={`${field} w-32`} value={step.delay_days} onChange={(e) => setStep(i, { delay_days: Number(e.target.value) || 0 })} />
              </label>
            )}
            <label className="block text-xs font-medium text-muted">Channel
              <select
                className={`${field} w-40`}
                value={step.channel || 'email'}
                onChange={(e) => setStep(i, { channel: e.target.value })}
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </label>
            {step.channel === 'sms' && (
              <p className="rounded-md bg-accent/10 px-3 py-2 text-xs text-ink">
                SMS only sends to a prospect who's already marked "Replied" — it never goes out as a cold first
                touch. If they haven't replied yet when this step comes due, it's skipped and the sequence moves on.
              </p>
            )}
            {step.channel !== 'sms' && (
              <label className="block text-xs font-medium text-muted">Subject
                <input className={field} value={step.subject} onChange={(e) => setStep(i, { subject: e.target.value })} />
              </label>
            )}
            <label className="block text-xs font-medium text-muted">Body
              <textarea rows={5} className={field} value={step.body} onChange={(e) => setStep(i, { body: e.target.value })} />
            </label>
          </div>
        ))}
        <button onClick={addStep} className={btnGhost}>+ Add follow-up step</button>
      </div>

      <button onClick={save} disabled={saving} className={btnAccent}>{saving ? 'Saving…' : 'Save sequence'}</button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Suppression list                                                     */
/* ------------------------------------------------------------------ */

function SuppressionTab() {
  const qc = useQueryClient()
  const { data: rows, isLoading } = useQuery({ queryKey: ['doNotContact'], queryFn: fetchDoNotContact })
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['doNotContact'] })

  const add = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setAdding(true)
    try {
      await addDoNotContact(email)
      setEmail('')
      invalidate()
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted max-w-xl">
        Anyone here is never sent an outreach email, regardless of which sequence or list they'd otherwise be on.
        People land here automatically when they click "unsubscribe" — add someone by hand if they've asked you
        directly.
      </p>
      <form onSubmit={add} className="flex gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" className={`${field} max-w-xs`} />
        <button type="submit" disabled={adding} className={btnAccent}>{adding ? 'Adding…' : 'Add'}</button>
      </form>
      <div className={`${card} overflow-x-auto`}>
        {isLoading && <p className="text-xs text-muted">Loading…</p>}
        {!isLoading && !rows?.length && <p className="text-xs text-muted">Nobody's suppressed yet.</p>}
        {!!rows?.length && (
          <table className="w-full text-left text-xs">
            <thead><tr className="text-muted"><th className="pb-2 pr-3">Email / Phone</th><th className="pb-2 pr-3">Reason</th><th className="pb-2"></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-2 pr-3 text-ink">{r.email || r.phone}</td>
                  <td className="py-2 pr-3 text-muted capitalize">{r.reason}</td>
                  <td className="py-2 text-right">
                    <button onClick={async () => { await removeDoNotContact(r.id); invalidate() }} className="text-muted hover:text-red-500">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
