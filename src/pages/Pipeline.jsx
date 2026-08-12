import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchDefaultPipeline, moveOpportunity, cancelOpportunity, setOpportunityBilling, patchOpportunity,
  updateOpportunity, sendWaveInvoice, fetchPaymentSettings, sendPaymentRequest,
  uploadCompletionVideo, fetchCompletionVideo, fetchMyOrgId,
} from '../lib/supabase'
import { PAYMENT_METHODS, methodLabel } from '../lib/paymentRequest'
import NewContactModal from '../components/NewContactModal'

const money = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    .format(Number(n || 0))

// Scheduled pickup/service time, shown in Pacific (the business timezone).
// e.g. "Jul 28, 10:00 AM"
const fmtSched = (d) =>
  d
    ? new Date(d).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null

const PORT_LABEL = {
  long_beach: 'Long Beach',
  wilmington: 'Wilmington',
  matson: 'Matson',
  other: 'Other',
}

// <input type="datetime-local"> works in the device's local time. Shawn runs
// Pacific, so this matches the Pacific display on the card.
const toLocalInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null)

export default function Pipeline() {
  const qc = useQueryClient()
  const [dragId, setDragId] = useState(null)
  const [overStage, setOverStage] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [showNew, setShowNew] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['pipeline'],
    queryFn: fetchDefaultPipeline,
  })
  // Which methods have a handle configured -- used to grey out unset options
  // in the card's payment-request menu.
  const { data: paymentSettings } = useQuery({ queryKey: ['paymentSettings'], queryFn: fetchPaymentSettings })

  const onCancel = async (id) => {
    setCancelling(id)
    qc.setQueryData(['pipeline'], (prev) => {
      if (!prev) return prev
      return { ...prev, opportunities: prev.opportunities.filter((o) => o.id !== id) }
    })
    try {
      await cancelOpportunity(id)
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      setCancelling(null)
    }
  }

  // Toggle a per-job flag (cleared / paid) with an optimistic card update.
  const onPatch = async (id, patch) => {
    qc.setQueryData(['pipeline'], (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        opportunities: prev.opportunities.map((o) =>
          o.id === id ? { ...o, ...patch } : o
        ),
      }
    })
    try {
      await patchOpportunity(id, patch)
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
    }
  }

  // Save edited opportunity fields (title, port, scheduled_at) with an
  // optimistic card update, same pattern as billing.
  const onSaveFields = async (id, patch) => {
    qc.setQueryData(['pipeline'], (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        opportunities: prev.opportunities.map((o) =>
          o.id === id ? { ...o, ...patch } : o
        ),
      }
    })
    try {
      await updateOpportunity(id, patch)
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
    }
  }

  const onSaveBilling = async (id, value) => {
    // optimistic: show it on the card right away
    qc.setQueryData(['pipeline'], (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        opportunities: prev.opportunities.map((o) =>
          o.id === id ? { ...o, billing_number: value || null } : o
        ),
      }
    })
    try {
      await setOpportunityBilling(id, value)
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
    }
  }

  // No optimistic update -- we only know payment_status changed once Wave
  // actually confirms the invoice was created and sent, so we wait for the
  // real result and just refetch. Errors bubble up to the caller (JobCard).
  const onSendInvoice = async (id) => {
    const result = await sendWaveInvoice(id)
    qc.invalidateQueries({ queryKey: ['pipeline'] })
    return result
  }

  // Fires immediately -- no draft/review step. Errors bubble up to JobCard.
  const onSendPaymentRequest = async (id, method) => {
    const result = await sendPaymentRequest(id, method)
    qc.invalidateQueries({ queryKey: ['pipeline'] })
    return result
  }

  const onDrop = async (stageId) => {
    setOverStage(null)
    const id = dragId
    setDragId(null)
    if (!id) return

    // optimistic update
    qc.setQueryData(['pipeline'], (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        opportunities: prev.opportunities.map((o) =>
          o.id === id ? { ...o, stage_id: stageId } : o
        ),
      }
    })
    try {
      await moveOpportunity(id, stageId)
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
    }
  }

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading board…</div>
  if (error)
    return (
      <div className="p-8 text-sm text-port">
        Couldn’t load the pipeline. Make sure the schema ran and you’re signed in.
      </div>
    )

  const { stages, opportunities } = data

  return (
    <div className="flex h-full flex-col p-4 sm:p-6 lg:p-8">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
            Pipeline
          </h1>
          <p className="text-sm text-muted">Drag a job to move it through the stages.</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-600"
        >
          + New booking
        </button>
      </header>

      <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const cards = opportunities.filter((o) => o.stage_id === stage.id)
          const total = cards.reduce((s, c) => s + Number(c.value || 0), 0)
          const isOver = overStage === stage.id
          return (
            <div
              key={stage.id}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage.id) }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
              onDrop={() => onDrop(stage.id)}
              className={`flex min-w-[11rem] flex-1 basis-0 flex-col rounded-xl border bg-canvas/60 ${
                isOver ? 'border-accent ring-2 ring-accent/30' : 'border-line'
              }`}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {stage.name}
                  <span className="rounded-full bg-ink/10 px-1.5 text-xs text-ink/70">
                    {cards.length}
                  </span>
                </span>
                <span className="font-[family-name:var(--font-mono)] text-xs text-muted">
                  {money(total)}
                </span>
              </div>

              <div className="flex-1 space-y-2 px-2 pb-3">
                {cards.length === 0 && (
                  <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                    Drop jobs here
                  </div>
                )}
                {cards.map((c) => (
                  <JobCard
                    key={c.id}
                    c={c}
                    isWon={!!stage.is_won}
                    dragId={dragId}
                    setDragId={setDragId}
                    cancelling={cancelling}
                    onCancel={onCancel}
                    onSaveBilling={onSaveBilling}
                    onSaveFields={onSaveFields}
                    onPatch={onPatch}
                    onSendInvoice={onSendInvoice}
                    onSendPaymentRequest={onSendPaymentRequest}
                    paymentSettings={paymentSettings}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <NewContactModal open={showNew} onClose={() => setShowNew(false)} />
    </div>
  )
}

function JobCard({ c, isWon, dragId, setDragId, cancelling, onCancel, onSaveBilling, onSaveFields, onPatch, onSendInvoice, onSendPaymentRequest, paymentSettings }) {
  const ref = useRef(null)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [sendingInvoice, setSendingInvoice] = useState(false)
  const [invoiceError, setInvoiceError] = useState('')
  const [payMenuOpen, setPayMenuOpen] = useState(false)
  const [sendingPayment, setSendingPayment] = useState(null)
  const [paymentError, setPaymentError] = useState('')
  const payMenuRef = useRef(null)
  // A text input inside a draggable=true element can't take focus in Chrome.
  // Flip the card's draggable flag off imperatively the instant the billing
  // field is touched (before focus), and back on when we leave it.
  const setDraggable = (on) => { if (ref.current) ref.current.draggable = on }

  async function handleSendInvoice(e) {
    e.stopPropagation()
    if (sendingInvoice) return
    setSendingInvoice(true); setInvoiceError('')
    try {
      await onSendInvoice(c.id)
    } catch (err) {
      setInvoiceError(err.message || String(err))
    } finally {
      setSendingInvoice(false)
    }
  }

  // Fires the request immediately on click -- no confirm step.
  async function handleRequestPayment(e, method) {
    e.stopPropagation()
    setPayMenuOpen(false)
    if (sendingPayment) return
    setSendingPayment(method); setPaymentError('')
    try {
      await onSendPaymentRequest(c.id, method)
    } catch (err) {
      setPaymentError(err.message || String(err))
    } finally {
      setSendingPayment(null)
    }
  }

  useEffect(() => {
    if (!payMenuOpen) return
    const onDocClick = (e) => { if (!payMenuRef.current?.contains(e.target)) setPayMenuOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [payMenuOpen])

  if (editing) {
    return (
      <JobEditor
        c={c}
        onCancel={() => setEditing(false)}
        onSave={async (patch) => { await onSaveFields(c.id, patch); setEditing(false) }}
      />
    )
  }

  return (
    <article
      ref={ref}
      draggable
      onDragStart={() => setDragId(c.id)}
      onDragEnd={() => setDragId(null)}
      className={`group cursor-grab rounded-lg border border-line bg-surface p-3 shadow-sm active:cursor-grabbing ${
        dragId === c.id ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {c.contact_id ? (
          <button
            type="button"
            title="Open contact — email, call or text"
            draggable={false}
            style={{ touchAction: 'manipulation' }}
            onClick={(e) => { e.stopPropagation(); navigate(`/contacts/${c.contact_id}`) }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onDragStart={(e) => e.preventDefault()}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink underline decoration-transparent underline-offset-2 hover:text-accent hover:decoration-accent"
          >
            {c.contacts?.full_name || c.title || 'Job'}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {c.contacts?.full_name || c.title || 'Job'}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {/* Tap the amount to edit it. "Paid" is the separate toggle below. */}
          <AmountField
            value={c.value}
            paid={c.paid}
            onSave={(v) => onSaveFields(c.id, { value: v })}
            onInteractStart={() => setDraggable(false)}
            onInteractEnd={() => setDraggable(true)}
          />
          <div className="relative" ref={payMenuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setPayMenuOpen((o) => !o) }}
              disabled={!!sendingPayment}
              title="Request payment (Zelle / Venmo / Cash App / Apple Pay)"
              className="rounded p-0.5 text-[11px] font-bold text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-canvas hover:text-accent disabled:cursor-wait disabled:opacity-100"
            >
              {sendingPayment ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 animate-spin">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                  <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <span className="flex h-3.5 w-3.5 items-center justify-center">$</span>
              )}
            </button>
            {payMenuOpen && (
              <div
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-line bg-surface py-1 shadow-lg"
              >
                {PAYMENT_METHODS.map((m) => {
                  const configured = !!paymentSettings?.[m.handleField]
                  return (
                    <button
                      key={m.value}
                      type="button"
                      disabled={!configured}
                      title={configured ? undefined : `Set your ${m.label} handle in Payment Settings first`}
                      onClick={(e) => handleRequestPayment(e, m.value)}
                      className="block w-full px-3 py-1.5 text-left text-xs text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:text-muted disabled:opacity-50"
                    >
                      {m.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <button
            onClick={handleSendInvoice}
            disabled={sendingInvoice}
            title={c.wave_invoice_id ? 'Resend Wave invoice' : 'Send Wave invoice'}
            className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-canvas hover:text-accent disabled:cursor-wait disabled:opacity-100"
          >
            {sendingInvoice ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 animate-spin">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M8 1.5a1 1 0 0 1 1 1v.55a3 3 0 0 1 2.45 2.45 1 1 0 1 1-1.97.35A1 1 0 0 0 8.5 5H7.2a1.2 1.2 0 0 0-.35 2.35l1.9.63A3.2 3.2 0 0 1 7.65 14.5v.5a1 1 0 1 1-2 0v-.55a3 3 0 0 1-2.45-2.45 1 1 0 1 1 1.97-.35A1 1 0 0 0 6.15 12H7.4a1.2 1.2 0 0 0 .35-2.35l-1.9-.63A3.2 3.2 0 0 1 6.85 2.5V2a1 1 0 0 1 1-1Z" />
              </svg>
            )}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true) }}
            title="Edit job details"
            className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-canvas hover:text-accent"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-8 8a.5.5 0 0 1-.223.128l-3 .857a.5.5 0 0 1-.618-.618l.857-3a.5.5 0 0 1 .128-.223l8-8Zm.354 1.061L11.707 4 12 4.293l.793-.793-.293-.293ZM11 5 4.5 11.5l-.5 1.5 1.5-.5L12 6l-1-1Z" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (window.confirm(`Cancel "${c.title || 'this job'}"? It'll disappear from the board.`)) onCancel(c.id)
            }}
            disabled={cancelling === c.id}
            title="Cancel job"
            className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>
      </div>
      {c.scheduled_at && (
        <div className="mt-1.5">
          <span
            title="Scheduled pickup / service time (Pacific)"
            className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-ink ring-1 ring-inset ring-accent/40"
          >
            <span aria-hidden="true">🗓️</span>
            {fmtSched(c.scheduled_at)}
          </span>
        </div>
      )}

      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {c.service_code && <span className="truncate capitalize">{c.service_code.replace(/_/g, ' ')}</span>}
        {c.port && <span className="shrink-0">· {PORT_LABEL[c.port] || c.port}</span>}
      </div>

      {/* Cleared (NC/C) and Paid toggles */}
      <div className="mt-2 flex items-center gap-4">
        <ClearedToggle
          cleared={c.cleared}
          onToggle={() => onPatch(c.id, { cleared: !c.cleared })}
        />
        <PaidToggle
          paid={c.paid}
          onToggle={() => onPatch(c.id, { paid: !c.paid })}
        />
        {c.wave_invoice_id && <PaymentStatusBadge status={c.payment_status} />}
        {c.payment_requested_at && (
          <span
            title={`Requested ${new Date(c.payment_requested_at).toLocaleString()}`}
            className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-muted ring-1 ring-inset ring-line"
          >
            {methodLabel(c.payment_method_requested)} requested
          </span>
        )}
      </div>
      {invoiceError && (
        <p className="mt-1.5 text-[11px] text-port" title={invoiceError}>⚠️ {invoiceError}</p>
      )}
      {paymentError && (
        <p className="mt-1.5 text-[11px] text-port" title={paymentError}>⚠️ {paymentError}</p>
      )}

      <BillingField
        value={c.billing_number}
        onSave={(v) => onSaveBilling(c.id, v)}
        onInteractStart={() => setDraggable(false)}
        onInteractEnd={() => setDraggable(true)}
      />

      {isWon && (
        <CompletionVideoField
          opportunityId={c.id}
          contactId={c.contact_id}
          onInteractStart={() => setDraggable(false)}
          onInteractEnd={() => setDraggable(true)}
        />
      )}
    </article>
  )
}

// Upload a completion video and explicitly tag its gate location. Only
// outside_gate ever reaches the auto-post pipeline (trg_notify_completion_video
// checks this server-side too) -- there's no default, a human must pick.
function CompletionVideoField({ opportunityId, contactId, onInteractStart, onInteractEnd }) {
  const qc = useQueryClient()
  const [gateStatus, setGateStatus] = useState('')
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const stop = (e) => e.stopPropagation()

  const { data: video, isLoading } = useQuery({
    queryKey: ['completionVideo', opportunityId],
    queryFn: () => fetchCompletionVideo(opportunityId),
  })

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) { setErr('Choose a video file first'); return }
    if (!gateStatus) { setErr('Pick outside gate or inside gate first'); return }
    setUploading(true)
    setErr('')
    try {
      const orgId = await fetchMyOrgId()
      await uploadCompletionVideo({ orgId, contactId, opportunityId, file, gateStatus })
      qc.invalidateQueries({ queryKey: ['completionVideo', opportunityId] })
    } catch (e) {
      setErr(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (isLoading) return null

  return (
    <div
      className="mt-2 rounded-lg border border-line bg-canvas/50 p-2"
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={stop}
      onFocus={onInteractStart}
      onBlur={onInteractEnd}
    >
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
        Completion video
      </label>
      {video ? (
        <div className="flex items-center gap-1.5 text-xs text-ink">
          <span aria-hidden="true">🎬</span>
          <span className="truncate">{video.file_name}</span>
          <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${video.gate_status === 'outside_gate' ? 'bg-accent/20 text-ink' : 'bg-ink/10 text-muted'}`}>
            {video.gate_status === 'outside_gate' ? 'Outside gate' : 'Inside gate'}
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="w-full text-[10px] text-muted file:mr-2 file:rounded file:border-0 file:bg-ink/10 file:px-2 file:py-1 file:text-[10px] file:font-semibold"
          />
          <select
            value={gateStatus}
            onChange={(e) => setGateStatus(e.target.value)}
            className="w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-accent"
          >
            <option value="">Gate location — required</option>
            <option value="outside_gate">Outside gate (safe to auto-post)</option>
            <option value="inside_gate">Inside gate (private — never posted)</option>
          </select>
          {err && <p className="text-[10px] text-port">{err}</p>}
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="w-full rounded bg-accent px-2 py-1 text-[10px] font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      )}
    </div>
  )
}

// Inline editor for a job card's title, port and scheduled time. Replaces the
// card while open so the compact card stays uncluttered. Not draggable.
function JobEditor({ c, onCancel, onSave }) {
  const [title, setTitle] = useState(c.title || '')
  const [port, setPort] = useState(c.port || '')
  const [vehicle, setVehicle] = useState(c.vehicle || '')
  const [when, setWhen] = useState(toLocalInput(c.scheduled_at))
  const [amount, setAmount] = useState(c.value ?? '')
  const [saving, setSaving] = useState(false)
  const stop = (e) => e.stopPropagation()

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave({
        title: title.trim() || null,
        port: port || null,
        vehicle: vehicle.trim() || null,
        scheduled_at: fromLocalInput(when),
        value: amount === '' ? null : amount,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <article
      draggable={false}
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={stop}
      onDragStart={(e) => e.preventDefault()}
      className="rounded-lg border border-accent bg-surface p-3 shadow-sm ring-2 ring-accent/30"
    >
      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Job title"
            className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Amount ($)</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full rounded border border-line bg-canvas px-2 py-1 font-[family-name:var(--font-mono)] text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Port</label>
          <select
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent"
          >
            <option value="">—</option>
            {Object.entries(PORT_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Vehicle</label>
          <input
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            placeholder="e.g. 2022 Toyota Tacoma"
            className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Scheduled (Pacific)</label>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div className="flex items-center gap-1 pt-0.5">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-accent px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded border border-line px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </article>
  )
}

// Tap the amount to edit it inline. Pointer events are stopped so tapping/
// typing here never starts a card drag (same approach as BillingField).
function AmountField({ value, paid, onSave, onInteractStart, onInteractEnd }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const stop = (e) => e.stopPropagation()

  const begin = () => { setDraft(value == null ? '' : String(value)); setEditing(true); onInteractStart?.() }
  const done = () => { setEditing(false); onInteractEnd?.() }

  const commit = async () => {
    if (saving) return
    const next = draft.trim() === '' ? null : Number(draft)
    if (next !== null && !Number.isFinite(next)) { done(); return }
    setSaving(true)
    try { await onSave(next); done() }
    finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <button
        type="button"
        title="Tap to edit amount"
        onClick={(e) => { stop(e); begin() }}
        onPointerDown={stop}
        onMouseDown={stop}
        className={`rounded px-1 font-[family-name:var(--font-mono)] text-sm transition-colors hover:bg-canvas ${
          paid ? 'text-starboard line-through decoration-2' : 'text-ink'
        }`}
      >
        {money(value)}
      </button>
    )
  }

  return (
    <div
      className="flex items-center gap-1"
      draggable={false}
      onMouseDown={stop}
      onPointerDown={(e) => { stop(e); onInteractStart?.() }}
      onClick={stop}
      onDragStart={stop}
    >
      <span className="text-xs text-muted">$</span>
      <input
        autoFocus
        type="number"
        inputMode="decimal"
        min="0"
        step="1"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { done() }
        }}
        onBlur={commit}
        draggable={false}
        aria-label="Job amount"
        className="w-16 rounded border border-line bg-canvas px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
      <button
        type="button"
        onClick={commit}
        disabled={saving}
        title="Save amount"
        className="shrink-0 rounded bg-brand px-1.5 py-0.5 text-[11px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {saving ? '…' : '✓'}
      </button>
    </div>
  )
}

// Paid / unpaid switch, mirroring ClearedToggle.
function PaidToggle({ paid, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={paid}
      title={paid ? 'Paid — click to mark unpaid' : 'Mark as paid'}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className="flex shrink-0 items-center gap-1"
    >
      <span
        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
          paid ? 'bg-starboard' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
            paid ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className={`text-[10px] font-bold ${paid ? 'text-starboard' : 'text-muted'}`}>
        {paid ? 'PAID' : 'UNPAID'}
      </span>
    </button>
  )
}

// Wave invoice status, shown once an invoice has been sent for this job.
const PAYMENT_STATUS_STYLE = {
  paid: 'bg-starboard/15 text-starboard ring-starboard/30',
  sent: 'bg-accent/15 text-ink ring-accent/40',
  unpaid: 'bg-canvas text-muted ring-line',
}
const PAYMENT_STATUS_LABEL = { paid: 'Invoice paid', sent: 'Invoice sent', unpaid: 'Invoice unpaid' }
function PaymentStatusBadge({ status }) {
  const key = status && PAYMENT_STATUS_STYLE[status] ? status : 'unpaid'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${PAYMENT_STATUS_STYLE[key]}`}>
      {PAYMENT_STATUS_LABEL[key]}
    </span>
  )
}

// Cleared / not-cleared switch. Shows a sliding toggle plus a C / NC label.
function ClearedToggle({ cleared, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={cleared}
      aria-label={cleared ? 'Cleared' : 'Not cleared'}
      title={cleared ? 'Cleared — click to mark not cleared' : 'Not cleared — click to mark cleared'}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className="flex shrink-0 items-center gap-1"
    >
      <span
        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
          cleared ? 'bg-starboard' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
            cleared ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span
        className={`w-5 text-[10px] font-bold ${cleared ? 'text-starboard' : 'text-port'}`}
      >
        {cleared ? 'C' : 'NC'}
      </span>
    </button>
  )
}

// Per-job ship billing number (≤16 chars). Lives on the card and rides
// along with the job through every stage. Pointer events are stopped so
// typing/tapping here never starts a card drag.
function BillingField({ value, onSave, onInteractStart, onInteractEnd }) {
  const [draft, setDraft] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const stop = (e) => e.stopPropagation()

  const commit = async () => {
    if (saving) return
    const next = draft.trim().slice(0, 16)
    if (next === (value || '')) {
      setSaved(true); setTimeout(() => setSaved(false), 1200)
      return
    }
    setSaving(true)
    try {
      await onSave(next)
      setSaved(true); setTimeout(() => setSaved(false), 1200)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="mt-2 flex items-center gap-1"
      draggable={false}
      onMouseDown={stop}
      onPointerDown={(e) => { stop(e); onInteractStart?.() }}
      onClick={stop}
      onDragStart={stop}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, 16))}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
        onFocus={onInteractStart}
        onBlur={onInteractEnd}
        maxLength={16}
        draggable={false}
        placeholder="Ship billing #"
        aria-label="Ship billing number"
        className="min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 font-[family-name:var(--font-mono)] text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
      <button
        type="button"
        onClick={commit}
        disabled={saving}
        title="Save billing number"
        className={`shrink-0 rounded px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
          saved ? 'bg-starboard text-white' : 'bg-brand text-white hover:bg-brand-600'
        }`}
      >
        {saved ? 'Saved ✓' : saving ? '…' : 'Enter'}
      </button>
    </div>
  )
}
