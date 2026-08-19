import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchDefaultPipeline, moveOpportunity, cancelOpportunity, deleteOpportunity, setOpportunityBilling, patchOpportunity,
  updateOpportunity,
  uploadCompletionVideo, fetchCompletionVideo, fetchMyOrgId, fetchLatestJobNote, fetchVehiclePhotoUrl,
  fetchDispatcherContacts, assignDispatcher,
  fetchPricingZones, fetchPricingSurcharges,
} from '../lib/supabase'
import { buildBookingSummary, shareBooking } from '../lib/shareBooking'
import NewContactModal from '../components/NewContactModal'
import Tooltip from '../components/Tooltip'

// Shared by the JobCard quick action and the JobEditor's full Share button --
// only the latter has `notes`/`photoUrl` available (fetched while the editor
// is open, for vehicle-transport bookings that captured a pickup/drop-off
// and a photo at booking time -- same info the lead-notification email
// already sends a driver, now available on demand too).
function bookingSummaryFor(c, notes, photoUrl) {
  return buildBookingSummary({
    customerName: c.contacts?.full_name,
    customerPhone: c.contacts?.phone,
    pickupAddress: c.pickup_address,
    dropoffAddress: c.dropoff_address,
    vehicleYear: c.vehicle_year, vehicleMake: c.vehicle_make, vehicleModel: c.vehicle_model, vehicleVin: c.vehicle_vin,
    photoUrl,
    serviceLabel: c.service_code ? c.service_code.replace(/_/g, ' ') : null,
    notes,
  })
}

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

// Which load board (if any) a job came from -- no API access on any plan
// available from either board, so this is a manual tag rather than
// something auto-populated (yet -- see the note on ContactDetail's
// document-request presets for the same "started manual, org can extend
// it" pattern this could grow into later).
const SOURCE_BOARD_LABEL = {
  central_dispatch: 'Central Dispatch',
  super_dispatch: 'Super Dispatch',
  direct: 'Direct',
  referral: 'Referral',
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

  // Who a lead can be handed off to -- contacts tagged segment='dispatcher'
  // (e.g. Warrior Auto Transport, Team Auto Transport/Dispatch), not CRM
  // logins. Fetched once for the whole board rather than per-card.
  const { data: dispatchers } = useQuery({
    queryKey: ['dispatcherContacts'],
    queryFn: fetchDispatcherContacts,
  })

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

  // Hard delete -- distinct from onCancel's soft status change. Same
  // optimistic-remove-then-refetch shape.
  const onDelete = async (id) => {
    setCancelling(id)
    qc.setQueryData(['pipeline'], (prev) => {
      if (!prev) return prev
      return { ...prev, opportunities: prev.opportunities.filter((o) => o.id !== id) }
    })
    try {
      await deleteOpportunity(id)
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

  // Hand a job off to a dispatcher contact (or clear it, when dispatcherId
  // is null). Optimistic so the card's badge updates immediately; the email
  // notification happens server-side and its result is returned, not shown
  // optimistically, so a failure (e.g. dispatcher has no email on file)
  // still surfaces even though the assignment itself already stuck.
  const onAssignDispatcher = async (id, dispatcherId) => {
    const dispatcher = dispatcherId ? dispatchers?.find((d) => d.id === dispatcherId) : null
    qc.setQueryData(['pipeline'], (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        opportunities: prev.opportunities.map((o) =>
          o.id === id ? { ...o, assigned_dispatcher_id: dispatcherId || null, assigned_dispatcher: dispatcher || null } : o
        ),
      }
    })
    try {
      const result = await assignDispatcher(id, dispatcherId)
      if (result.emailError) alert(result.emailError)
    } catch (e) {
      alert(e.message || 'Failed to assign dispatcher')
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
    }
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
              className={`flex min-w-[13rem] flex-1 basis-0 flex-col rounded-xl border bg-canvas/60 ${
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
                    onDelete={onDelete}
                    onSaveBilling={onSaveBilling}
                    onSaveFields={onSaveFields}
                    onPatch={onPatch}
                    dispatchers={dispatchers}
                    onAssignDispatcher={onAssignDispatcher}
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

function JobCard({ c, isWon, dragId, setDragId, cancelling, onCancel, onDelete, onSaveBilling, onSaveFields, onPatch, dispatchers, onAssignDispatcher }) {
  const ref = useRef(null)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  // A text input inside a draggable=true element can't take focus in Chrome.
  // Flip the card's draggable flag off imperatively the instant the billing
  // field is touched (before focus), and back on when we leave it.
  const setDraggable = (on) => { if (ref.current) ref.current.draggable = on }

  // The card's own invoice, if one's been started -- fetchDefaultPipeline
  // embeds each opportunity's invoices ordered newest-first, so [0] is it.
  const invoice = c.invoices?.[0]

  function handleOpenInvoice(e) {
    e.stopPropagation()
    navigate(invoice ? `/invoices/${invoice.id}` : `/invoices/new?opportunity_id=${c.id}`)
  }

  // No await before shareBooking() -- navigator.share() needs to fire within
  // the same user-gesture the click provides, and this card's fields are
  // already all in memory (no fetch needed for the quick-action version).
  function handleShareBooking(e) {
    e.stopPropagation()
    shareBooking({ summaryText: bookingSummaryFor(c), recipientPhone: c.contacts?.phone })
  }

  if (editing) {
    return (
      <JobEditor
        c={c}
        onCancel={() => setEditing(false)}
        onSave={async (patch) => { await onSaveFields(c.id, patch); setEditing(false) }}
        onCancelJob={() => {
          if (window.confirm(`Cancel "${c.title || 'this job'}"? It'll disappear from the board.`)) onCancel(c.id)
        }}
        onDeleteJob={() => {
          if (window.confirm(`Permanently delete "${c.title || 'this job'}"? This can't be undone. Any linked invoice/appointment stays, just unlinked from this job.`)) onDelete(c.id)
        }}
        cancelling={cancelling === c.id}
        dispatchers={dispatchers}
        onAssignDispatcher={onAssignDispatcher}
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
          <Tooltip label={invoice ? `Open invoice ${invoice.invoice_number}` : 'Create an invoice for this job'}>
            <button
              onClick={handleOpenInvoice}
              aria-label={invoice ? `Open invoice ${invoice.invoice_number}` : 'Create an invoice for this job'}
              className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-canvas hover:text-accent"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M8 1.5a1 1 0 0 1 1 1v.55a3 3 0 0 1 2.45 2.45 1 1 0 1 1-1.97.35A1 1 0 0 0 8.5 5H7.2a1.2 1.2 0 0 0-.35 2.35l1.9.63A3.2 3.2 0 0 1 7.65 14.5v.5a1 1 0 1 1-2 0v-.55a3 3 0 0 1-2.45-2.45 1 1 0 1 1 1.97-.35A1 1 0 0 0 6.15 12H7.4a1.2 1.2 0 0 0 .35-2.35l-1.9-.63A3.2 3.2 0 0 1 6.85 2.5V2a1 1 0 0 1 1-1Z" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Text driver / share booking details">
            <button
              onClick={handleShareBooking}
              aria-label="Text driver / share booking details"
              className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-canvas hover:text-accent"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H8.06l-2.5 2.3a.5.5 0 0 1-.84-.37V11H3.5A1.5 1.5 0 0 1 2 9.5v-6Z" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Edit job details">
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true) }}
              aria-label="Edit job details"
              className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-canvas hover:text-accent"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-8 8a.5.5 0 0 1-.223.128l-3 .857a.5.5 0 0 1-.618-.618l.857-3a.5.5 0 0 1 .128-.223l8-8Zm.354 1.061L11.707 4 12 4.293l.793-.793-.293-.293ZM11 5 4.5 11.5l-.5 1.5 1.5-.5L12 6l-1-1Z" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
      {c.scheduled_at && (
        <div className="mt-1.5">
          <span
            title={isWon ? 'Scheduled pickup / service time (Pacific) — job complete' : 'Scheduled pickup / service time (Pacific) — still open'}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
              isWon ? 'bg-accent/15 text-ink ring-accent/40' : 'bg-port/15 text-port ring-port/40'
            }`}
          >
            <span aria-hidden="true">🗓️</span>
            {fmtSched(c.scheduled_at)}
          </span>
        </div>
      )}

      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {c.service_code && <span className="truncate capitalize">{c.service_code.replace(/_/g, ' ')}</span>}
        {c.port && <span className="shrink-0">· {PORT_LABEL[c.port] || c.port}</span>}
        {c.source_board && (
          <span
            title={c.board_order_number ? `Board order #${c.board_order_number}` : undefined}
            className="shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-semibold text-muted ring-1 ring-inset ring-line"
          >
            {SOURCE_BOARD_LABEL[c.source_board] || c.source_board}
          </span>
        )}
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
        {invoice && <InvoiceStatusBadge status={invoice.status} />}
      </div>

      <Tooltip label="Hand this job off to a dispatcher — they'll be emailed the lead details" side="bottom" block>
        <DispatcherAssignField
          value={c.assigned_dispatcher_id}
          dispatchers={dispatchers}
          onAssign={(id) => onAssignDispatcher(c.id, id)}
          onInteractStart={() => setDraggable(false)}
          onInteractEnd={() => setDraggable(true)}
        />
      </Tooltip>

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
            className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent"
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

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// Same Mapbox geocoding endpoint PublicBooking.jsx uses for its address
// autocomplete, but here we already have a plain saved address string (no
// pick-a-suggestion UI on the pipeline card) so this just takes the top
// match's coordinates directly.
async function mapboxGeocodeOne(address) {
  if (!MAPBOX_TOKEN || !address?.trim()) return null
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=false&country=us&types=address,place&limit=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  return data.features?.[0]?.center || null // [lng, lat]
}

async function mapboxDrivingMiles(from, to) {
  if (!MAPBOX_TOKEN || !from || !to) return null
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from[0]},${from[1]};${to[0]},${to[1]}?access_token=${MAPBOX_TOKEN}&overview=false`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const meters = data.routes?.[0]?.distance
  return typeof meters === 'number' ? meters / 1609.344 : null
}

const VEHICLE_TYPES = [
  { value: 'sedan', label: 'Sedan / car' },
  { value: 'suv', label: 'SUV (+$175)' },
  { value: 'truck', label: 'Truck (+$250)' },
  { value: 'enclosed', label: 'Enclosed trailer (×1.5)' },
]
const INTERSTATE_MIN_MI = 250
const INTERSTATE_RATE_LOW = 1.5
const INTERSTATE_RATE_HIGH = 2.5

// Real driver quotes you gave me: Long Beach→Vegas (~300 mi) ran $450-$750,
// and a 670 mi run cost $1,600 -- both land in this same $1.50-$2.50/mi
// band despite the mileage gap, so this is a flat rate rather than
// Gemini's original multi-tier taper (no long-haul reference point yet to
// justify tapering further out -- revisit once a real 2,000+ mi quote
// comes in). No fuel adjustment -- not worth the EIA dependency for the
// accuracy it'd add on top of a driver-sourced rate that already has fuel
// baked in.
function interstateFloor({ miles, vehicleType }) {
  let lineHaulMin = miles * INTERSTATE_RATE_LOW
  let lineHaulMax = miles * INTERSTATE_RATE_HIGH
  if (vehicleType === 'enclosed') { lineHaulMin *= 1.5; lineHaulMax *= 1.5 }

  const flatSurcharge = vehicleType === 'suv' ? 175 : vehicleType === 'truck' ? 250 : 0
  return { floorMin: lineHaulMin + flatSurcharge, floorMax: lineHaulMax + flatSurcharge }
}

// Your locked formula: at least 20% margin, or a flat $150, whichever's bigger.
function applyMargin(floor) {
  return Math.max(floor * 1.2, floor + 150)
}

function InterstateEstimator({ pickup, dropoff, onUseAmount }) {
  const [vehicleType, setVehicleType] = useState('sedan')
  const [miles, setMiles] = useState(null)
  const [milesLoading, setMilesLoading] = useState(false)
  const [milesErr, setMilesErr] = useState('')

  const calcMileage = async () => {
    setMilesLoading(true); setMilesErr(''); setMiles(null)
    try {
      const [from, to] = await Promise.all([mapboxGeocodeOne(pickup), mapboxGeocodeOne(dropoff)])
      if (!from || !to) { setMilesErr('Could not locate one of those addresses.'); return }
      const m = await mapboxDrivingMiles(from, to)
      if (m == null) { setMilesErr('Could not calculate driving distance.'); return }
      setMiles(m)
    } catch {
      setMilesErr('Mileage lookup failed.')
    } finally {
      setMilesLoading(false)
    }
  }

  let floorMin = null, floorMax = null, targetMin = null, targetMax = null
  if (miles != null) {
    const f = interstateFloor({ miles, vehicleType })
    floorMin = f.floorMin; floorMax = f.floorMax
    targetMin = applyMargin(floorMin); targetMax = applyMargin(floorMax)
  }

  return (
    <div className="space-y-1.5">
      <select
        value={vehicleType}
        onChange={(e) => setVehicleType(e.target.value)}
        className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent"
      >
        {VEHICLE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
      </select>
      <button
        type="button"
        onClick={calcMileage}
        disabled={milesLoading || !pickup || !dropoff}
        className="w-full rounded border border-line bg-canvas px-2 py-1 text-[11px] font-semibold text-ink hover:bg-canvas/50 disabled:opacity-50"
      >
        {milesLoading ? 'Calculating…' : miles != null ? `${Math.round(miles)} mi — recalculate` : 'Calculate driving distance'}
      </button>
      {milesErr && <p className="text-[10px] text-port">{milesErr}</p>}
      {miles != null && miles <= INTERSTATE_MIN_MI && (
        <p className="text-[10px] text-muted">Under {INTERSTATE_MIN_MI} mi — the Zone tab may fit this better.</p>
      )}
      {floorMin != null && (
        <>
          <p className="text-[10px] text-muted">
            Floor ${Math.round(floorMin).toLocaleString()}–${Math.round(floorMax).toLocaleString()}
          </p>
          <div className="flex items-center justify-between rounded bg-accent/10 px-2 py-1.5">
            <span className="text-xs font-semibold text-ink">
              ${Math.round(targetMin).toLocaleString()}–${Math.round(targetMax).toLocaleString()}
            </span>
            <button
              type="button"
              onClick={() => onUseAmount(Math.round((targetMin + targetMax) / 2))}
              className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-ink hover:bg-accent-600"
            >
              Use as Amount
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Staff-only quote helper: the landing page/funnel form only ever collects
// a plain pickup/dropoff address (see LandingPagePublic.jsx) -- nobody
// outside the org ever sees a rate. Staff read that address above, then
// either pick a matching zone (local CA runs) or switch to Interstate
// (250+ mi) for a mileage-based range, and get back a number to fill into
// Amount so what's quoted over the phone matches what's on the books.
function PriceEstimator({ pickup, dropoff, onUseAmount }) {
  const [mode, setMode] = useState('zone')
  const stop = (e) => e.stopPropagation()

  return (
    <div onClick={stop} className="space-y-1.5 rounded border border-line bg-canvas/50 p-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Price estimator (staff only)</h4>
        <div className="flex overflow-hidden rounded border border-line text-[10px] font-semibold">
          <button type="button" onClick={() => setMode('zone')}
            className={`px-2 py-0.5 ${mode === 'zone' ? 'bg-accent text-ink' : 'bg-canvas text-muted'}`}>Zone</button>
          <button type="button" onClick={() => setMode('interstate')}
            className={`px-2 py-0.5 ${mode === 'interstate' ? 'bg-accent text-ink' : 'bg-canvas text-muted'}`}>Interstate</button>
        </div>
      </div>
      {mode === 'zone'
        ? <ZoneEstimator onUseAmount={onUseAmount} />
        : <InterstateEstimator pickup={pickup} dropoff={dropoff} onUseAmount={onUseAmount} />}
    </div>
  )
}

// Zones/surcharges come from pricing_zones/pricing_surcharges (Settings'
// rate catalog, same pattern as `services`) so the list can grow without a
// code change. Matches the range whaleyinc.net's own public calculator
// would quote for a local CA run.
function ZoneEstimator({ onUseAmount }) {
  const { data: zones } = useQuery({ queryKey: ['pricingZones'], queryFn: fetchPricingZones })
  const { data: surcharges } = useQuery({ queryKey: ['pricingSurcharges'], queryFn: fetchPricingSurcharges })
  const [zoneId, setZoneId] = useState('')
  const [vehicleCount, setVehicleCount] = useState(1)
  const [checkedSurcharges, setCheckedSurcharges] = useState(() => new Set())
  const stop = (e) => e.stopPropagation()

  const zone = (zones || []).find((z) => z.id === zoneId)
  const count = Math.max(1, Number(vehicleCount) || 1)

  const toggleSurcharge = (id) => {
    setCheckedSurcharges((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  let estimateMin = null, estimateMax = null
  if (zone) {
    const applied = (surcharges || []).filter((s) => checkedSurcharges.has(s.id))
    const sMin = applied.reduce((sum, s) => sum + Number(s.amount_min), 0)
    const sMax = applied.reduce((sum, s) => sum + Number(s.amount_max), 0)
    estimateMin = (Number(zone.rate_min) + sMin) * count
    estimateMax = (Number(zone.rate_max) + sMax) * count
  }

  return (
    <div onClick={stop} className="space-y-1.5">
      <select
        value={zoneId}
        onChange={(e) => setZoneId(e.target.value)}
        className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent"
      >
        <option value="">Match to a zone…</option>
        {(zones || []).map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}{z.note ? ` (${z.note})` : ''} — ${Number(z.rate_min)}–${Number(z.rate_max)}
          </option>
        ))}
      </select>
      {zone && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted">Vehicles</label>
            <input
              type="number" min="1" max="20" value={vehicleCount}
              onChange={(e) => setVehicleCount(e.target.value)}
              className="w-14 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-ink outline-none focus:border-accent"
            />
          </div>
          {(surcharges || []).length > 0 && (
            <div className="space-y-0.5">
              {surcharges.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-[11px] text-ink">
                  <input type="checkbox" checked={checkedSurcharges.has(s.id)} onChange={() => toggleSurcharge(s.id)} />
                  {s.name}
                  <span className="text-muted">
                    (+${Number(s.amount_min)}{Number(s.amount_min) !== Number(s.amount_max) ? `–$${Number(s.amount_max)}` : ''}/car)
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between rounded bg-accent/10 px-2 py-1.5">
            <span className="text-xs font-semibold text-ink">
              ${estimateMin.toLocaleString()}{estimateMin !== estimateMax ? `–$${estimateMax.toLocaleString()}` : ''}
            </span>
            <button
              type="button"
              onClick={() => onUseAmount(Math.round((estimateMin + estimateMax) / 2))}
              className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-ink hover:bg-accent-600"
            >
              Use as Amount
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Inline editor for a job card's title, port and scheduled time. Replaces the
// card while open so the compact card stays uncluttered. Not draggable.
function JobEditor({ c, onCancel, onSave, onCancelJob, onDeleteJob, cancelling, dispatchers, onAssignDispatcher }) {
  const [title, setTitle] = useState(c.title || '')
  const [port, setPort] = useState(c.port || '')
  const [vehicle, setVehicle] = useState(c.vehicle || '')
  const [pickupAddress, setPickupAddress] = useState(c.pickup_address || '')
  const [dropoffAddress, setDropoffAddress] = useState(c.dropoff_address || '')
  const [when, setWhen] = useState(toLocalInput(c.scheduled_at))
  const [amount, setAmount] = useState(c.value ?? '')
  const [sourceBoard, setSourceBoard] = useState(c.source_board || '')
  const [boardOrderNumber, setBoardOrderNumber] = useState(c.board_order_number || '')
  const [saving, setSaving] = useState(false)
  const stop = (e) => e.stopPropagation()

  // Loaded while the editor is open (not for every card on the board) so
  // it's already sitting in state by the time someone taps Share -- calling
  // navigator.share() after an await here would risk losing the click's
  // user-activation on some browsers.
  const { data: latestNote } = useQuery({ queryKey: ['jobNote', c.id], queryFn: () => fetchLatestJobNote(c.id) })
  const { data: photoUrl } = useQuery({ queryKey: ['jobPhoto', c.id], queryFn: () => fetchVehiclePhotoUrl(c.id) })
  const hasDetails = c.vehicle_year || c.vehicle_make || c.vehicle_model || c.vehicle_vin || c.service_code || photoUrl

  function handleShare(e) {
    stop(e)
    shareBooking({ summaryText: bookingSummaryFor(c, latestNote, photoUrl), recipientPhone: c.contacts?.phone })
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave({
        title: title.trim() || null,
        port: port || null,
        vehicle: vehicle.trim() || null,
        pickup_address: pickupAddress.trim() || null,
        dropoff_address: dropoffAddress.trim() || null,
        scheduled_at: fromLocalInput(when),
        value: amount === '' ? null : amount,
        source_board: sourceBoard || null,
        board_order_number: boardOrderNumber || null,
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
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Pickup</label>
            <input
              value={pickupAddress}
              onChange={(e) => setPickupAddress(e.target.value)}
              placeholder="Pickup address"
              className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Drop-off</label>
            <input
              value={dropoffAddress}
              onChange={(e) => setDropoffAddress(e.target.value)}
              placeholder="Drop-off address"
              className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </div>
        </div>
        {(pickupAddress.trim() !== (c.pickup_address || '') || dropoffAddress.trim() !== (c.dropoff_address || '')) && (
          <p className="text-[10px] text-amber-600">Address changed — hit Save below, then Text driver / share booking sends the corrected one.</p>
        )}
        {hasDetails && (
          <div className="space-y-0.5 rounded border border-line bg-canvas/50 p-2 text-[11px] text-muted">
            {c.service_code && <div>Service: <span className="capitalize text-ink">{c.service_code.replace(/_/g, ' ')}</span></div>}
            {(c.vehicle_year || c.vehicle_make || c.vehicle_model || c.vehicle_vin) && (
              <div>
                Vehicle: <span className="text-ink">
                  {[c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')}
                  {c.vehicle_vin ? ` · VIN ${c.vehicle_vin}` : ''}
                </span>
              </div>
            )}
            {latestNote && <div>Notes: <span className="text-ink">{latestNote}</span></div>}
            {photoUrl && (
              <div>
                <a href={photoUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">📷 Vehicle photo ↗</a>
              </div>
            )}
          </div>
        )}
        {(c.pickup_address || c.dropoff_address) && (
          <PriceEstimator pickup={c.pickup_address} dropoff={c.dropoff_address} onUseAmount={(v) => setAmount(v)} />
        )}
        <button
          type="button"
          onClick={handleShare}
          className="w-full rounded bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-brand-600"
        >
          📱 Text driver / share booking
        </button>
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
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Source</label>
          <select
            value={sourceBoard}
            onChange={(e) => setSourceBoard(e.target.value)}
            className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent"
          >
            <option value="">—</option>
            {Object.entries(SOURCE_BOARD_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        {sourceBoard && sourceBoard !== 'direct' && sourceBoard !== 'referral' && (
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Board order #</label>
            <input
              value={boardOrderNumber}
              onChange={(e) => setBoardOrderNumber(e.target.value)}
              placeholder="e.g. CD-482910"
              className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </div>
        )}
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Assign to dispatcher</label>
          <DispatcherAssignField
            value={c.assigned_dispatcher_id}
            dispatchers={dispatchers}
            onAssign={(id) => onAssignDispatcher(c.id, id)}
            bare
          />
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
          <button
            type="button"
            onClick={onCancelJob}
            disabled={saving || cancelling}
            title="Cancel this job — it'll disappear from the board"
            className="ml-auto rounded px-2.5 py-1 text-[11px] font-medium text-port hover:bg-red-50 disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel job'}
          </button>
          <button
            type="button"
            onClick={onDeleteJob}
            disabled={saving || cancelling}
            title="Permanently delete this job — not just cancel it"
            className="rounded px-2.5 py-1 text-[11px] font-medium text-port hover:bg-red-50 disabled:opacity-50"
          >
            Delete job
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

// This job's in-app invoice status, shown once one's been started.
const INVOICE_STATUS_STYLE = {
  paid: 'bg-starboard/15 text-starboard ring-starboard/30',
  sent: 'bg-accent/15 text-ink ring-accent/40',
  overdue: 'bg-red-50 text-red-600 ring-red-200',
  draft: 'bg-canvas text-muted ring-line',
}
const INVOICE_STATUS_LABEL = { paid: 'Invoice paid', sent: 'Invoice sent', overdue: 'Invoice overdue', draft: 'Invoice draft' }
function InvoiceStatusBadge({ status }) {
  const key = status && INVOICE_STATUS_STYLE[status] ? status : 'draft'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${INVOICE_STATUS_STYLE[key]}`}>
      {INVOICE_STATUS_LABEL[key]}
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

// Hand a job off to a dispatcher contact (Warrior Auto Transport, Team Auto
// Transport/Dispatch, etc.) -- commits the moment you pick one, same
// immediate-save shape as BillingField, since choosing a name IS the
// action here (no separate "save" step to forget). `bare` drops the
// card-specific spacing/stop-propagation wrapper for use inside JobEditor,
// which already provides its own label + spacing.
function DispatcherAssignField({ value, dispatchers, onAssign, onInteractStart, onInteractEnd, bare }) {
  const [saving, setSaving] = useState(false)
  const stop = (e) => e.stopPropagation()

  const handleChange = async (e) => {
    const next = e.target.value || null
    if (next === (value || null)) return
    setSaving(true)
    try {
      await onAssign(next)
    } finally {
      setSaving(false)
    }
  }

  const select = (
    <select
      value={value || ''}
      onChange={handleChange}
      disabled={saving}
      draggable={false}
      aria-label="Assign to dispatcher"
      className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent disabled:opacity-50"
    >
      <option value="">— Unassigned —</option>
      {dispatchers?.map((d) => (
        <option key={d.id} value={d.id}>{d.full_name || d.company}</option>
      ))}
    </select>
  )

  if (bare) return select

  return (
    <div
      className="mt-2"
      draggable={false}
      onMouseDown={stop}
      onPointerDown={(e) => { stop(e); onInteractStart?.() }}
      onClick={stop}
      onDragStart={stop}
      onFocus={onInteractStart}
      onBlur={onInteractEnd}
    >
      {select}
    </div>
  )
}
