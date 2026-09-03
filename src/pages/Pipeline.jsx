import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchDefaultPipeline, moveOpportunity, cancelOpportunity, deleteOpportunity, setOpportunityBilling, patchOpportunity,
  updateOpportunity,
  uploadCompletionVideo, fetchCompletionVideo, fetchMyOrgId, fetchLatestJobNote, fetchVehiclePhotoUrl,
  fetchDispatcherContacts, assignDispatcher,
  fetchTransportDrivers,
  fetchOrCreateTrackingLink,
  requestCarrierQuote, fetchSimilarRouteQuotes,
  classifyVehicle, previewSuggestedPrice,
  sendContract, fetchLatestContract,
  parseJobBrief,
  logAudit, fetchAuditLogsForEntity,
  sendWaveInvoice,
} from '../lib/supabase'
import { createInvoice } from '../lib/invoices'
import { buildBookingSummary, buildCarrierQuoteAsk, shareBooking, copyToClipboard } from '../lib/shareBooking'
import NewContactModal from '../components/NewContactModal'
import Tooltip from '../components/Tooltip'
import AddressAutocompleteField from '../components/AddressAutocompleteField'
import PriceEstimator from '../components/PriceEstimator'
import DropoffPreview from '../components/DropoffPreview'

// Shared by the JobCard quick action and JobDetailModal's full Share button --
// only the latter has `notes`/`photoUrl` available (fetched while the editor
// is open, for vehicle-transport bookings that captured a pickup/drop-off
// and a photo at booking time -- same info the lead-notification email
// already sends a driver, now available on demand too).
function bookingSummaryFor(c, notes, photoUrl) {
  return buildBookingSummary({
    customerName: c.contacts?.full_name,
    customerPhone: c.contacts?.phone,
    bookingNumber: c.booking_number,
    pickupAddress: c.pickup_address,
    dropoffAddress: c.dropoff_address,
    vehicleYear: c.vehicle_year, vehicleMake: c.vehicle_make, vehicleModel: c.vehicle_model, vehicleVin: c.vehicle_vin,
    photoUrl,
    serviceLabel: c.service_code ? c.service_code.replace(/_/g, ' ') : null,
    notes,
  })
}

// Driver-facing text for the "Text route" / "Text to another driver"
// buttons -- adds drop-off access notes and the driver's tracking link on
// top of the base summary, neither of which the customer-facing Share
// button above ever sees.
function driverTextFor(c, notes, photoUrl, dropoffInfo, trackingLink) {
  let text = bookingSummaryFor(c, notes, photoUrl)
  if (dropoffInfo?.notes?.length) {
    text += '\n\nDrop-off access notes:\n' + dropoffInfo.notes.map((n) => `- ${n.note}`).join('\n')
  }
  if (trackingLink) {
    text += `\n\nTap to share your location and confirm pickup/drop-off: ${trackingLink}`
  }
  return text
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

// Real pickup addresses for each port -- picking one in the Port field
// below auto-fills Pickup with it instead of the dispatcher typing/looking
// it up every time. Confirmed against Shawn's own addresses, not guessed.
const PORT_ADDRESS = {
  long_beach: '1525 Pier F Ave, Long Beach, CA 90802',
  wilmington: '250 S Avalon Blvd, Wilmington, CA 90744',
  matson: '1320 Pier C St, Long Beach, CA 90813',
}

// 2026-09-02: "Track shipment" -- Shawn's actual workflow is a single site
// he checks 2-5x/day (Ports America's Wilmington cargo/demurrage lookup),
// not a per-carrier routing tool. That page needs a real logged-in browser
// session, which ruled out checking it automatically from the server --
// but this button runs client-side in Shawn's own browser (same as his
// existing bookmark to this exact URL), so it carries whatever access he
// already has there. No pre-filled querystring -- his own bookmark doesn't
// use one either, so the page apparently doesn't support one; this copies
// the B/L number to the clipboard instead so it's a paste, not a retype.
const PORTS_AMERICA_URL = 'https://dockworks.portsamerica.com/Operations/Cargo/CargoAvailableAndDemurrage.aspx'

async function openCarrierTracking(blNumber) {
  const clean = String(blNumber || '').trim()
  if (!clean) return
  // window.open has to fire synchronously, in the same tick as the click --
  // Safari (especially iOS) silently blocks it as a popup if anything gets
  // awaited first, which is exactly what copyToClipboard below would do.
  window.open(PORTS_AMERICA_URL, '_blank')
  await copyToClipboard(clean)
}

// Vehicle type bucket used for auto-pricing (matches the DB check constraint
// and the vin-decode Edge Function's BodyClass mapping).
const VEHICLE_TYPE_LABEL = {
  small: 'Small vehicle',
  sedan: 'Sedan',
  suv: 'SUV',
  truck: 'Truck',
  van: 'Van',
  coupe: 'Coupe',
}
const VEHICLE_MOD_LABEL = { stock: 'Stock', raised: 'Raised', lowered: 'Lowered' }

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

// Photography orgs (Tre Colbert Photography) have no load boards -- their
// leads come from social/word-of-mouth/wedding-industry sites instead.
const PHOTOGRAPHY_SOURCE_LABEL = {
  instagram: 'Instagram',
  the_knot: 'The Knot / WeddingWire',
  website: 'Website',
  referral: 'Referral',
  direct: 'Direct',
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
  const [searchParams, setSearchParams] = useSearchParams()
  // ?new=1 auto-opens the New Booking modal on load -- lets a Home Screen
  // shortcut (dispatch.ship2shorebooking.com/pipeline?new=1) drop a
  // dispatcher straight into the paste box, no taps once the page loads.
  const [showNew, setShowNew] = useState(() => searchParams.get('new') === '1')

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

  // Same query key JobCard's detail view uses for the driver dropdown --
  // React Query dedupes this to one shared cache entry, so keeping a
  // reference here (just for audit-log display names) doesn't cost a
  // second network call once that view has also loaded it.
  const { data: driversForLog } = useQuery({ queryKey: ['transportDrivers'], queryFn: fetchTransportDrivers })
  const driverName = (id) => driversForLog?.find((d) => d.id === id)?.full_name || (id ? 'Unknown driver' : 'Unassigned')
  const stageName = (id) => data?.stages?.find((s) => s.id === id)?.name || id

  const onCancel = async (id) => {
    setCancelling(id)
    qc.setQueryData(['pipeline'], (prev) => {
      if (!prev) return prev
      return { ...prev, opportunities: prev.opportunities.filter((o) => o.id !== id) }
    })
    try {
      await cancelOpportunity(id)
    } catch (e) {
      // Per-2026-09-01 audit: without this, a failed save (dropped
      // connection, bad cell signal) just silently reverted on the next
      // refetch below with zero indication anything went wrong.
      alert(e.message || "Couldn't cancel this job — check your connection and try again.")
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['auditLogs'] })
      setCancelling(null)
    }
  }

  // Hard delete -- distinct from onCancel's soft status change. Same
  // optimistic-remove-then-refetch shape.
  const onDelete = async (id) => {
    const prevOpp = data?.opportunities?.find((o) => o.id === id)
    setCancelling(id)
    qc.setQueryData(['pipeline'], (prev) => {
      if (!prev) return prev
      return { ...prev, opportunities: prev.opportunities.filter((o) => o.id !== id) }
    })
    try {
      await deleteOpportunity(id)
      if (prevOpp) {
        fetchMyOrgId().then((orgId) => logAudit({
          orgId, entityType: 'opportunity', entityId: id, action: 'deleted',
          oldValue: prevOpp.title || prevOpp.contacts?.full_name || id,
        }))
      }
    } catch (e) {
      alert(e.message || "Couldn't delete this job — check your connection and try again.")
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['auditLogs'] })
      setCancelling(null)
    }
  }

  // Toggle a per-job flag (cleared / paid) with an optimistic card update.
  // Also the choke point for the driver-assignment dropdown (JobCard passes
  // a { assigned_driver_card_id } patch here) -- logged separately from the
  // plain paid/deposit_paid toggles below since a wrong driver assignment is
  // exactly the kind of thing Jim's audit flagged ("who unassigned this?").
  const onPatch = async (id, patch) => {
    const prevOpp = data?.opportunities?.find((o) => o.id === id)
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
      if ('assigned_driver_card_id' in patch && prevOpp && prevOpp.assigned_driver_card_id !== patch.assigned_driver_card_id) {
        fetchMyOrgId().then((orgId) => logAudit({
          orgId, entityType: 'opportunity', entityId: id, action: 'driver_assigned', field: 'assigned_driver_card_id',
          oldValue: driverName(prevOpp.assigned_driver_card_id), newValue: driverName(patch.assigned_driver_card_id),
        }))
      }
    } catch (e) {
      alert(e.message || "Couldn't save that change — check your connection and try again.")
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['auditLogs'] })
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
    } catch (e) {
      alert(e.message || "Couldn't save this job — check your connection and try again.")
      throw e // let the caller's own try/catch (the JobCard Save button) know too, so it doesn't show "Saved ✓"
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['auditLogs'] })
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
    } catch (e) {
      alert(e.message || "Couldn't save the billing number — check your connection and try again.")
      throw e
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['auditLogs'] })
    }
  }

  // Hand a job off to a dispatcher contact (or clear it, when dispatcherId
  // is null). Optimistic so the card's badge updates immediately; the email
  // notification happens server-side and its result is returned, not shown
  // optimistically, so a failure (e.g. dispatcher has no email on file)
  // still surfaces even though the assignment itself already stuck.
  const onAssignDispatcher = async (id, dispatcherId) => {
    const prevOpp = data?.opportunities?.find((o) => o.id === id)
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
      if (prevOpp && prevOpp.assigned_dispatcher_id !== (dispatcherId || null)) {
        const oldDispatcher = prevOpp.assigned_dispatcher_id ? dispatchers?.find((d) => d.id === prevOpp.assigned_dispatcher_id) : null
        fetchMyOrgId().then((orgId) => logAudit({
          orgId, entityType: 'opportunity', entityId: id, action: 'dispatcher_assigned', field: 'assigned_dispatcher_id',
          oldValue: oldDispatcher?.full_name || oldDispatcher?.company || 'Unassigned',
          newValue: dispatcher?.full_name || dispatcher?.company || 'Unassigned',
        }))
      }
    } catch (e) {
      alert(e.message || 'Failed to assign dispatcher')
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['auditLogs'] })
    }
  }

  // Move a job to a specific stage directly (e.g. tapping a step in the big
  // job view's progress bar) -- same optimistic-then-refetch shape as
  // onDrop, just without any drag state to clear.
  const onMoveStage = async (id, stageId) => {
    const prevOpp = data?.opportunities?.find((o) => o.id === id)
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
      if (prevOpp && prevOpp.stage_id !== stageId) {
        fetchMyOrgId().then((orgId) => logAudit({
          orgId, entityType: 'opportunity', entityId: id, action: 'stage_change', field: 'stage_id',
          oldValue: stageName(prevOpp.stage_id), newValue: stageName(stageId),
        }))
      }
    } catch (e) {
      alert(e.message || "Couldn't move this job — check your connection and try again.")
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['auditLogs'] })
    }
  }

  const onDrop = async (stageId) => {
    setOverStage(null)
    const id = dragId
    setDragId(null)
    if (!id) return
    const prevOpp = data?.opportunities?.find((o) => o.id === id)

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
      if (prevOpp && prevOpp.stage_id !== stageId) {
        fetchMyOrgId().then((orgId) => logAudit({
          orgId, entityType: 'opportunity', entityId: id, action: 'stage_change', field: 'stage_id',
          oldValue: stageName(prevOpp.stage_id), newValue: stageName(stageId),
        }))
      }
    } catch (e) {
      alert(e.message || "Couldn't move this job — check your connection and try again.")
    } finally {
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['auditLogs'] })
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
                    autoOpen={c.id === searchParams.get('job')}
                    isWon={!!stage.is_won}
                    stages={stages}
                    dragId={dragId}
                    setDragId={setDragId}
                    cancelling={cancelling}
                    onCancel={onCancel}
                    onDelete={onDelete}
                    onSaveBilling={onSaveBilling}
                    onSaveFields={onSaveFields}
                    onPatch={onPatch}
                    onMoveStage={onMoveStage}
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

function JobCard({ c, autoOpen, isWon, stages, dragId, setDragId, cancelling, onCancel, onDelete, onSaveBilling, onSaveFields, onPatch, onMoveStage, dispatchers, onAssignDispatcher }) {
  const ref = useRef(null)
  const navigate = useNavigate()
  // ?job=<id> (e.g. a "Open in CRM" link from a Telegram lead alert) opens
  // this card's modal straight away -- only read once on mount, so closing
  // it afterward doesn't keep snapping back open.
  const [editing, setEditing] = useState(() => !!autoOpen)
  // A text input inside a draggable=true element can't take focus in Chrome.
  // Flip the card's draggable flag off imperatively the instant the billing
  // field is touched (before focus), and back on when we leave it.
  const setDraggable = (on) => { if (ref.current) ref.current.draggable = on }

  // Up to two invoices per job now -- a deposit invoice at booking and a
  // balance invoice at delivery. fetchDefaultPipeline embeds them
  // newest-first, so .find grabs the latest of each kind.
  const invoice = c.invoices?.find((i) => i.kind !== 'deposit')
  const depositInvoice = c.invoices?.find((i) => i.kind === 'deposit')

  // `e` is optional -- these fire both from a card's own quick-action icon
  // (inside a draggable card, so it stops propagation) and from a plain
  // button inside JobDetailModal (no drag/propagation concern there).
  function handleOpenInvoice(e) {
    e?.stopPropagation()
    navigate(invoice ? `/invoices/${invoice.id}` : `/invoices/new?opportunity_id=${c.id}`)
  }

  function handleOpenDepositInvoice(e) {
    e?.stopPropagation()
    navigate(depositInvoice ? `/invoices/${depositInvoice.id}` : `/invoices/new?opportunity_id=${c.id}&kind=deposit`)
  }

  // 2026-09-02: this button is labeled (and meant) for the driver, but was
  // wired to c.contacts?.phone -- the linked CRM contact, which for a
  // vehicle-transport job is the customer, not the driver. shareBooking()
  // addresses the text straight to whatever phone it's given, so that sent
  // it to the customer's phone instead of the assigned driver's every time.
  // Fixed to use the assigned driver's own number, same source "Text route"
  // already uses correctly; falls back to the open share sheet (no
  // preaddressed number) when no driver's assigned yet, same as "Text to
  // another driver (not in system)" below.
  const { data: driversForShare } = useQuery({ queryKey: ['transportDrivers'], queryFn: fetchTransportDrivers })
  const assignedDriverForShare = driversForShare?.find((d) => d.id === c.assigned_driver_card_id)

  // No await before shareBooking() -- navigator.share() needs to fire within
  // the same user-gesture the click provides, and this card's fields are
  // already all in memory (no fetch needed for the quick-action version).
  function handleShareBooking(e) {
    e?.stopPropagation()
    shareBooking({ summaryText: bookingSummaryFor(c), recipientPhone: assignedDriverForShare?.sms_number || assignedDriverForShare?.phone })
  }

  return (
    <>
    {editing && (
      <JobDetailModal
        c={c}
        stages={stages}
        isWon={isWon}
        invoice={invoice}
        depositInvoice={depositInvoice}
        onClose={() => setEditing(false)}
        onSave={async (patch) => { await onSaveFields(c.id, patch) }}
        onCancelJob={() => {
          if (window.confirm(`Cancel "${c.title || 'this job'}"? It'll disappear from the board.`)) { onCancel(c.id); setEditing(false) }
        }}
        onDeleteJob={() => {
          if (window.confirm(`Permanently delete "${c.title || 'this job'}"? This can't be undone. Any linked invoice/appointment stays, just unlinked from this job.`)) { onDelete(c.id); setEditing(false) }
        }}
        cancelling={cancelling === c.id}
        dispatchers={dispatchers}
        onAssignDispatcher={onAssignDispatcher}
        onSaveBilling={(v) => onSaveBilling(c.id, v)}
        onPatch={(patch) => onPatch(c.id, patch)}
        onMoveStage={(stageId) => onMoveStage(c.id, stageId)}
        onOpenInvoice={handleOpenInvoice}
        onOpenDepositInvoice={handleOpenDepositInvoice}
      />
    )}
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
          {Number(c.deposit_amount) > 0 && (
            <Tooltip label={depositInvoice ? `Open deposit invoice ${depositInvoice.invoice_number}` : 'Create a deposit invoice for this job'}>
              <button
                onClick={handleOpenDepositInvoice}
                aria-label={depositInvoice ? `Open deposit invoice ${depositInvoice.invoice_number}` : 'Create a deposit invoice for this job'}
                className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-canvas hover:text-accent"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M4 2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.414a1 1 0 0 0-.293-.707l-3.414-3.414A1 1 0 0 0 8.586 2H4Zm4.5 1.5L11.5 6.5H9a1 1 0 0 1-1-1V3.5ZM5 9.5h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1 0-1Zm0 2.5h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1 0-1Z" />
                </svg>
              </button>
            </Tooltip>
          )}
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
      {c.booking_number && (
        <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-muted">{c.booking_number}</div>
      )}
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

      {/* What's actually come in -- deposit and final payment, independently */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PaymentBadgeToggle
          label="Deposit"
          paid={c.deposit_paid}
          onToggle={() => onPatch(c.id, { deposit_paid: !c.deposit_paid })}
        />
        <PaymentBadgeToggle
          label="Final"
          paid={c.paid}
          onToggle={() => onPatch(c.id, { paid: !c.paid })}
        />
        {depositInvoice && <InvoiceStatusBadge status={depositInvoice.status} prefix="Deposit: " />}
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
    </>
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

// Every field a job has, on one big page -- opened from a card's "Open job
// details" action. Replaces the old inline-on-the-board editor: this is a
// full-screen overlay (same fixed-inset-0/backdrop convention as
// NewContactModal, just a bigger panel) so there's room to actually see
// pickup/drop-off, price, port, source board, dispatcher, vehicle, and
// status all at once, plus a real progress stepper across the org's own
// pipeline stages. Closing it (X, backdrop click, or Escape) always
// discards unsaved field edits and returns to the normal board -- only the
// toggles (Cleared/Paid) and dispatcher assignment save immediately,
// exactly like they already did on the compact card.
function JobDetailModal({
  c, stages, isWon, invoice, depositInvoice,
  onClose, onSave, onCancelJob, onDeleteJob, cancelling,
  dispatchers, onAssignDispatcher, onSaveBilling, onPatch, onMoveStage,
  onOpenInvoice, onOpenDepositInvoice,
}) {
  const [title, setTitle] = useState(c.title || '')
  const [port, setPort] = useState(c.port || '')
  const [vehicle, setVehicle] = useState(c.vehicle || '')
  const [pickupAddress, setPickupAddress] = useState(c.pickup_address || '')
  const [dropoffAddress, setDropoffAddress] = useState(c.dropoff_address || '')
  const [when, setWhen] = useState(toLocalInput(c.scheduled_at))
  const [amount, setAmount] = useState(c.value ?? '')
  const [depositAmount, setDepositAmount] = useState(c.deposit_amount ?? '')
  const [escortFee, setEscortFee] = useState(c.escort_fee ?? '')
  const [sourceBoard, setSourceBoard] = useState(c.source_board || '')
  const [boardOrderNumber, setBoardOrderNumber] = useState(c.board_order_number || '')
  const [billingNumber, setBillingNumber] = useState(c.billing_number || '')
  const [blNumber, setBlNumber] = useState(c.bl_number || '')
  const [trackingShipment, setTrackingShipment] = useState(false)
  const [trackedCarrier, setTrackedCarrier] = useState(null)
  const [copiedBlNumber, setCopiedBlNumber] = useState(false)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [copiedRoute, setCopiedRoute] = useState(false)

  // Agent 2 -- in-house drivers only (business cards opted into "offers
  // vehicle transport"), separate from Assigned dispatcher above (which
  // hands the whole job off to another business). Sorted lightest-load
  // first as a plain, honest signal -- never a fabricated "best match"
  // score, and never a claim that anyone's actually available right now.
  const { data: drivers } = useQuery({ queryKey: ['transportDrivers'], queryFn: fetchTransportDrivers })
  const assignedDriver = drivers?.find((d) => d.id === c.assigned_driver_card_id)

  // Drop-off access notes -- captured from DropoffPreview once it's
  // geocoded the address, so "Text route to driver" can fold in any notes
  // on file without a second geocode call of its own. Driver-facing only:
  // never appended to the customer-facing Share button above.
  const [dropoffInfo, setDropoffInfo] = useState(null)

  // Vehicle classification + auto-pricing. vehicleYear/Make/Model double as
  // the "manual entry" fallback fields -- typing all three (with no VIN)
  // checks vehicle_type_cache the same way a VIN decode does, just without
  // the NHTSA call.
  const [vehicleVin, setVehicleVin] = useState(c.vehicle_vin || '')
  const [vehicleYear, setVehicleYear] = useState(c.vehicle_year || '')
  const [vehicleMake, setVehicleMake] = useState(c.vehicle_make || '')
  const [vehicleModel, setVehicleModel] = useState(c.vehicle_model || '')
  const [vehicleType, setVehicleType] = useState(c.vehicle_type || '')
  const [vehicleModification, setVehicleModification] = useState(c.vehicle_modification || 'stock')
  const [vehicleExtended, setVehicleExtended] = useState(!!c.vehicle_extended)

  // Photography job tracking (project_type/gallery_link/custom_fields on
  // opportunities) -- gated to Tre Colbert Photography's org rather than a
  // generic FEATURES toggle, same reasoning as Jobline's PRICING_TOOLS_ORG_IDS:
  // this is one client's workflow, not a feature every transport-dispatch org
  // using this same board should see.
  const isPhotographyOrg = c.org_id === 'b438f814-40bf-48d4-9ffe-73b4d6ba5e07'

  // Fetched (and created, if this job doesn't have one yet) as soon as the
  // modal opens rather than on button click -- iOS Safari only allows
  // navigator.share() to fire synchronously inside the click handler, so an
  // await right before shareBooking() would silently break the share sheet
  // there. By the time a dispatcher reaches "Text route" this is already
  // sitting in cache.
  const { data: trackingLink } = useQuery({
    queryKey: ['trackingLink', c.id], queryFn: () => fetchOrCreateTrackingLink(c.id), enabled: !isPhotographyOrg,
  })
  const [projectType, setProjectType] = useState(c.project_type || '')
  const [galleryLink, setGalleryLink] = useState(c.gallery_link || '')
  const [venue, setVenue] = useState(c.custom_fields?.venue || '')
  const [classifying, setClassifying] = useState(false)
  const [classifyResult, setClassifyResult] = useState(null)
  const [suggestedPrice, setSuggestedPrice] = useState(c.suggested_price ?? null)
  const [priceConfirmed, setPriceConfirmed] = useState(false)

  const { data: latestNote } = useQuery({ queryKey: ['jobNote', c.id], queryFn: () => fetchLatestJobNote(c.id) })
  const { data: photoUrl } = useQuery({ queryKey: ['jobPhoto', c.id], queryFn: () => fetchVehiclePhotoUrl(c.id) })
  const { data: contract } = useQuery({ queryKey: ['jobContract', c.id], queryFn: () => fetchLatestContract(c.id) })
  const [sendingContract, setSendingContract] = useState(false)
  const [requestingQuote, setRequestingQuote] = useState(false)
  const [sendingWave, setSendingWave] = useState(false)
  const [estimatedMiles, setEstimatedMiles] = useState(null)
  const qc = useQueryClient()
  const hasVehicleDetails = c.vehicle_year || c.vehicle_make || c.vehicle_model || c.vehicle_vin

  async function handleSendContract() {
    if (sendingContract) return
    setSendingContract(true)
    try {
      await sendContract(c.id)
      qc.invalidateQueries({ queryKey: ['jobContract', c.id] })
    } catch (err) {
      alert(err.message)
    } finally {
      setSendingContract(false)
    }
  }

  // Audio Brief -- talk through a job, have it fill the fields in below.
  // Speech-to-text happens entirely in the browser (same SpeechRecognition
  // API the AI Assistant page already uses); only the resulting text is
  // sent anywhere, to parseJobBrief for Claude to structure. Never saves --
  // it only fills the form state below, same as typing it in by hand.
  const [briefListening, setBriefListening] = useState(false)
  const [briefTranscript, setBriefTranscript] = useState('')
  const [processingBrief, setProcessingBrief] = useState(false)
  const [briefError, setBriefError] = useState('')
  const [briefApplied, setBriefApplied] = useState(null)
  const recognitionRef = useRef(null)

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return
    const rec = new SpeechRecognition()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onstart = () => setBriefListening(true)
    rec.onend = () => setBriefListening(false)
    rec.onerror = () => setBriefListening(false)
    rec.onresult = (event) => {
      let finalText = ''
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript + ' '
      }
      if (finalText) setBriefTranscript((prev) => (prev ? prev.trim() + ' ' : '') + finalText.trim())
    }
    recognitionRef.current = rec
    return () => rec.stop()
  }, [])

  function toggleBriefMic() {
    if (!recognitionRef.current) { setBriefError('Voice input is not supported in this browser.'); return }
    if (briefListening) recognitionRef.current.stop()
    else {
      // Starting a fresh recording -- clear whatever was left over from
      // last time instead of piling new speech onto old text.
      setBriefError('')
      setBriefApplied(null)
      setBriefTranscript('')
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
      recognitionRef.current.start()
    }
  }

  // Reads the captured fields back out loud (browser-native SpeechSynthesis,
  // same "entirely client-side, no extra API cost" reasoning as the
  // SpeechRecognition side of this feature) -- so a dispatcher glancing away
  // from the screen still hears what actually got picked up, not just silence.
  function speakBriefSummary(result) {
    if (!('speechSynthesis' in window)) return
    const parts = []
    if (result.title) parts.push(`Title: ${result.title}.`)
    if (result.vehicle_description) parts.push(`Vehicle: ${result.vehicle_description}.`)
    if (result.pickup_address) parts.push(`Pickup: ${result.pickup_address}.`)
    if (result.dropoff_address) parts.push(`Drop-off: ${result.dropoff_address}.`)
    if (result.price != null) parts.push(`Price: ${result.price} dollars.`)
    const text = parts.length ? `Got it. ${parts.join(' ')}` : "I didn't catch anything usable in that -- try again."
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  }

  async function handleProcessBrief() {
    if (!briefTranscript.trim() || processingBrief) return
    setProcessingBrief(true)
    setBriefError('')
    try {
      const result = await parseJobBrief(briefTranscript)
      const applied = []
      if (result.title) { setTitle(result.title); applied.push('title') }
      if (result.pickup_address) { setPickupAddress(result.pickup_address); applied.push('pickup') }
      if (result.dropoff_address) { setDropoffAddress(result.dropoff_address); applied.push('drop-off') }
      if (result.vehicle_description) { setVehicle(result.vehicle_description); applied.push('vehicle') }
      if (result.price != null) { setAmount(String(result.price)); setPriceConfirmed(false); applied.push('price') }
      setBriefApplied({ fields: applied, notes: result.notes })
      speakBriefSummary(result)
    } catch (err) {
      setBriefError(err.message)
    } finally {
      setProcessingBrief(false)
    }
  }

  // Escape closes, same as clicking the X or the backdrop.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // "Saved ✓" confirmation fades back to the normal Save label on its own,
  // so it reads as a quick confirmation rather than a permanent status.
  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => setJustSaved(false), 3000)
    return () => clearTimeout(t)
  }, [justSaved])

  // Auto-detect the vehicle as the dispatcher types -- a VIN (decodes via
  // NHTSA), or a "2022 Toyota Tacoma"-style description (parsed locally and
  // checked against the cache), or the manual Year/Make/Model fields once
  // all three are filled. Debounced so it fires after typing pauses, not on
  // every keystroke. Whichever result comes back drives the "what is this
  // vehicle" popup under the Vehicle panel.
  useEffect(() => {
    const vin = vehicleVin.trim().toUpperCase()
    let year = vehicleYear.trim(), make = vehicleMake.trim(), model = vehicleModel.trim()

    if (!vin && (!year || !make || !model)) {
      const parsed = vehicle.match(/^\s*((?:19|20)\d{2})\s+(\S+)\s+(.+?)\s*$/)
      if (parsed) { year = parsed[1]; make = parsed[2]; model = parsed[3] }
    }

    const vinReady = vin.length === 17
    const manualReady = !vinReady && year && make && model
    if (!vinReady && !manualReady) { setClassifyResult(null); return }

    let cancelled = false
    const timer = setTimeout(async () => {
      setClassifying(true)
      try {
        const result = vinReady ? await classifyVehicle({ vin }) : await classifyVehicle({ year, make, model })
        if (cancelled) return
        setClassifyResult(result)
        if (result.year) setVehicleYear(result.year)
        if (result.make) setVehicleMake(result.make)
        if (result.model) setVehicleModel(result.model)
        if (result.vehicle_type) setVehicleType(result.vehicle_type)
      } catch (err) {
        if (!cancelled) setClassifyResult({ manual_required: true, reason: err.message || 'Could not classify this vehicle.' })
      } finally {
        if (!cancelled) setClassifying(false)
      }
    }, 600)
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleVin, vehicleYear, vehicleMake, vehicleModel, vehicle])

  // Live suggested price -- same formula as the calculate_suggested_price DB
  // trigger, called via RPC so the two never drift. Recomputes whenever the
  // vehicle condition or the base amount/service changes; never writes
  // anywhere until the dispatcher hits Confirm price.
  useEffect(() => {
    if (!vehicleType) { setSuggestedPrice(c.suggested_price ?? null); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const price = await previewSuggestedPrice({
          orgId: c.org_id, serviceCode: c.service_code, value: amount,
          vehicleType, vehicleModification, vehicleExtended,
        })
        if (!cancelled) setSuggestedPrice(price)
      } catch { /* leave last known suggestion in place */ }
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [c.org_id, c.service_code, amount, vehicleType, vehicleModification, vehicleExtended, c.suggested_price])

  function confirmPrice() {
    if (suggestedPrice == null) return
    setAmount(String(suggestedPrice))
    setPriceConfirmed(true)
  }

  // Once there's a contact, a vehicle, and a dollar amount, there's nothing
  // left for a human to decide about an invoice's contents -- so build the
  // draft automatically on Save rather than making the dispatcher start one
  // from a blank form. It still lands as a draft, not sent: opening
  // "Deposit invoice"/"Balance invoice" shows it pre-filled and ready, the
  // dispatcher still has to hit Send. Best-effort and silent -- if it
  // fails, the buttons still let them build one by hand, same as before.
  async function autoDraftInvoice({ kind, existing, unitPrice, label }) {
    if (existing || !c.contact_id) return
    if (!(unitPrice > 0)) return
    const vehicleDesc = vehicle.trim() || [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ').trim()
    try {
      await createInvoice({
        fields: {
          opportunity_id: c.id,
          contact_id: c.contact_id,
          bill_to_name: c.contacts?.full_name || null,
          bill_to_phone: c.contacts?.phone || null,
          bill_to_email: c.contacts?.email || null,
          notes: [vehicleDesc, pickupAddress && dropoffAddress ? `${pickupAddress} → ${dropoffAddress}` : null].filter(Boolean).join('\n') || null,
          kind,
        },
        lineItems: [{ description: `${label} — ${vehicleDesc || title.trim() || 'vehicle transport'}`, quantity: 1, unit_price: unitPrice }],
      })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['auditLogs'] })
    } catch { /* best-effort -- the invoice buttons still work by hand */ }
  }

  async function autoDraftInvoices() {
    // Paid on-site jobs never get an invoice at all -- the driver already
    // collected in person, so there's nothing left to bill.
    if (c.paid_on_site) return
    await autoDraftInvoice({ kind: 'deposit', existing: depositInvoice, unitPrice: Number(depositAmount), label: 'Deposit' })
    // Balance invoice: whatever's still owed once the deposit's accounted
    // for. Skipped if that's zero/negative (e.g. fully covered by deposit).
    const remaining = Number(amount || 0) - Number(depositAmount || 0)
    await autoDraftInvoice({ kind: 'invoice', existing: invoice, unitPrice: remaining, label: 'Balance' })
  }

  // 2026-09-02: same fix as JobCard's quick-action version above -- was
  // wired to c.contacts?.phone (the customer), sending "Text driver" texts
  // straight to the customer instead of the assigned driver. Uses the same
  // assignedDriver this modal already loads for "Text route".
  function handleShare() {
    shareBooking({ summaryText: bookingSummaryFor(c, latestNote, photoUrl), recipientPhone: assignedDriver?.sms_number || assignedDriver?.phone })
  }

  // Real invoice inside Shawn's actual Wave account (separate from this
  // CRM's own invoice records above) -- creates/reuses the Wave customer,
  // creates + emails a Wave invoice for the job's transport value, and gets
  // marked paid automatically once Wave confirms it (wave-payment-sync
  // polls every 15 min; no Wave Pro plan required for either step, per the
  // 2026-09-01 check). Needs a contact email and a value set first.
  async function handleSendWaveInvoice() {
    if (!c.contact_id) { alert('This job needs a linked contact first.'); return }
    if (!c.contacts?.email) { alert("This job's contact has no email on file — add one on their contact page, then try again."); return }
    if (c.paid_on_site) { alert("This job is marked Paid on-site / COD — there's nothing to invoice through Wave."); return }
    if (!(Number(c.value) > 0)) { alert('Set a transport price above, hit Save, then try again.'); return }
    setSendingWave(true)
    try {
      await sendWaveInvoice(c.id)
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      alert('Wave invoice sent — the customer should have it in their inbox now.')
    } catch (e) {
      alert(e.message || 'Could not send this through Wave.')
    } finally {
      setSendingWave(false)
    }
  }

  // Works for any driver, saved contact or not -- prompts for whatever
  // number to text it to, same one-off entry Shawn asked for, since a
  // driver being asked for a quote usually isn't in the system yet.
  async function handleAskDriverForQuote() {
    if (!c.pickup_address || !c.dropoff_address) {
      alert('This job needs both a pickup and drop-off address first — add them above, hit Save, then try again.')
      return
    }
    setRequestingQuote(true)
    try {
      const { url } = await requestCarrierQuote(c.id)
      const phone = window.prompt("Driver's phone number to text this to (leave blank to just open Messages):") || ''
      shareBooking({
        summaryText: buildCarrierQuoteAsk({ pickupAddress: c.pickup_address, dropoffAddress: c.dropoff_address, url }),
        recipientPhone: phone,
        title: 'Quote Request',
      })
    } catch (e) {
      alert(e.message || 'Could not create the quote request.')
    } finally {
      setRequestingQuote(false)
    }
  }

  // Money-field changes get their own audit entries (per the 2026-09-01
  // "who changed this rate" audit) -- diffed against the job's value as it
  // was when this modal opened, since the big Save button bundles price
  // together with unrelated fields like title/vehicle/addresses.
  const logPriceChanges = () => {
    const newAmount = amount === '' ? null : Number(amount)
    const newDeposit = depositAmount === '' ? 0 : Number(depositAmount)
    const newEscort = escortFee === '' ? null : Number(escortFee)
    const changes = [
      Number(c.value ?? null) !== newAmount ? ['value', c.value, newAmount] : null,
      Number(c.deposit_amount ?? 0) !== newDeposit ? ['deposit_amount', c.deposit_amount, newDeposit] : null,
      Number(c.escort_fee ?? null) !== newEscort ? ['escort_fee', c.escort_fee, newEscort] : null,
    ].filter(Boolean)
    if (!changes.length) return
    fetchMyOrgId().then((orgId) => {
      for (const [field, oldValue, newValue] of changes) {
        logAudit({
          orgId, entityType: 'opportunity', entityId: c.id, action: 'price_change', field,
          oldValue: oldValue == null ? 'not set' : money(oldValue), newValue: newValue == null ? 'not set' : money(newValue),
        })
      }
    })
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setJustSaved(false)
    try {
      await Promise.all([
        onSave({
          title: title.trim() || null,
          port: port || null,
          vehicle: vehicle.trim() || null,
          pickup_address: pickupAddress.trim() || null,
          dropoff_address: dropoffAddress.trim() || null,
          scheduled_at: fromLocalInput(when),
          value: amount === '' ? null : amount,
          deposit_amount: depositAmount === '' ? 0 : depositAmount,
          escort_fee: escortFee === '' ? null : escortFee,
          source_board: sourceBoard || null,
          board_order_number: boardOrderNumber || null,
          bl_number: blNumber || null,
          vehicle_vin: vehicleVin || null,
          vehicle_year: vehicleYear || null,
          vehicle_make: vehicleMake || null,
          vehicle_model: vehicleModel || null,
          vehicle_type: vehicleType || null,
          vehicle_modification: vehicleModification,
          vehicle_extended: vehicleExtended,
          ...(priceConfirmed ? { confirmed_price: suggestedPrice } : {}),
          ...(isPhotographyOrg ? {
            project_type: projectType || null,
            gallery_link: galleryLink.trim() || null,
            custom_fields: { ...(c.custom_fields || {}), venue: venue.trim() || undefined },
          } : {}),
        }),
        billingNumber.trim().slice(0, 16) !== (c.billing_number || '') ? onSaveBilling(billingNumber.trim().slice(0, 16)) : null,
      ])
      logPriceChanges()
      await autoDraftInvoices()
      setJustSaved(true)
    } catch (e) {
      // onSave/onSaveBilling already alert() their own failure and re-throw
      // -- this just stops it from becoming a silent unhandled-rejection
      // and, more importantly, from reaching setJustSaved(true) below,
      // which would otherwise show "Saved ✓" on a save that didn't happen.
      console.error('Job save failed:', e)
    } finally {
      setSaving(false)
    }
  }

  const flowStages = (stages || []).filter((s) => !s.is_lost).slice().sort((a, b) => a.position - b.position)
  const currentIdx = flowStages.findIndex((s) => s.id === c.stage_id)
  const balance = Number(amount || 0) - Number(depositAmount || 0)

  const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted'
  const field = 'w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'
  const mono = 'font-[family-name:var(--font-mono)]'
  const panel = 'rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]'
  const redField = 'border-red-500 ring-1 ring-red-500/40'
  const redPill = 'rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white'

  // 2026-09-02: temporary red highlighting on whatever's missing for a
  // correct Wave invoice -- Shawn asked for this to build the habit of
  // filling every job in fully before we send an invoice through Wave.
  // Amount and a real vehicle description are required for a clean line
  // item; escort fee is flagged (not required) whenever a port's picked,
  // since not every port job needs one but it's easy to forget.
  const amountMissing = !(Number(amount) > 0)
  const vehicleDescMissing = !vehicle.trim() && !hasVehicleDetails
  const portEscortUnchecked = !isPhotographyOrg && !!port && !(Number(escortFee) > 0)
  const contactMissing = !c.contact_id
  const contactEmailMissing = !!c.contact_id && !c.contacts?.email

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Job details — ${c.title || c.contacts?.full_name || 'job'}`}
        className="relative z-10 flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-canvas shadow-2xl sm:h-[92vh]"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-[family-name:var(--font-display)] text-xl font-bold text-ink">
              {c.contacts?.full_name || c.title || 'Job'}
            </h2>
            <p className={`${mono} mt-0.5 text-xs text-muted`}>
              {c.booking_number || 'No booking #'}{c.billing_number ? ` · Ship billing ${c.billing_number}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Stepper -- tap a stage to move the job there directly */}
        {flowStages.length > 1 && (
          <div className="overflow-x-auto border-b border-line bg-surface px-5 py-3">
            <div className="flex min-w-max items-center">
              {flowStages.map((s, i) => {
                const done = currentIdx >= 0 && i < currentIdx
                const current = i === currentIdx
                return (
                  <div key={s.id} className="flex items-center">
                    {i > 0 && <div className={`h-0.5 w-8 sm:w-16 ${done || current ? 'bg-accent' : 'bg-line'}`} />}
                    <button
                      type="button"
                      onClick={() => onMoveStage(s.id)}
                      title={current ? 'Current stage' : `Move to ${s.name}`}
                      className="flex flex-col items-center gap-1 px-1"
                    >
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-2 transition-colors ${
                          current
                            ? 'bg-accent text-ink ring-accent'
                            : done
                              ? 'bg-accent/20 text-accent ring-accent/40'
                              : 'bg-canvas text-muted ring-line'
                        }`}
                      >
                        {done ? '✓' : i + 1}
                      </span>
                      <span className={`whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide ${current ? 'text-accent' : 'text-muted'}`}>
                        {s.name}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {/* Hero strip */}
          <div className="mb-4 flex flex-col gap-4 overflow-hidden rounded-[var(--radius-card)] bg-brand p-4 text-white shadow-[var(--shadow-card)] sm:flex-row sm:items-center">
            {photoUrl && (
              <a href={photoUrl} target="_blank" rel="noreferrer" className="block h-28 w-full shrink-0 overflow-hidden rounded-lg sm:w-40">
                <img src={photoUrl} alt="Vehicle" className="h-full w-full object-cover" />
              </a>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Current job</p>
              {isPhotographyOrg ? (
                <>
                  <p className="mt-0.5 truncate text-lg font-bold">
                    {c.title || (projectType === 'wedding' ? 'Wedding' : projectType === 'real_estate' ? 'Real estate shoot' : 'Photography project')}
                  </p>
                  {venue && <p className="mt-2 truncate text-sm text-white/90">{venue}</p>}
                </>
              ) : (
                <>
                  <p className="mt-0.5 truncate text-lg font-bold">
                    {[c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') || vehicle || c.service_code?.replace(/_/g, ' ') || 'Vehicle transport'}
                  </p>
                  {c.vehicle_vin && <p className={`${mono} text-xs text-white/70`}>VIN {c.vehicle_vin}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/90">
                    <span className="truncate">{c.pickup_address || 'Pickup TBD'}</span>
                    <span aria-hidden="true">→</span>
                    <span className="truncate">{c.dropoff_address || 'Drop-off TBD'}</span>
                  </div>
                </>
              )}
            </div>
            <div className="shrink-0 border-t border-white/15 pt-3 text-sm sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Scheduled (Pacific)</p>
              <p className="font-semibold">{fmtSched(c.scheduled_at) || 'Not set'}</p>
              {c.port && <p className="mt-1 text-white/70">{PORT_LABEL[c.port] || c.port}</p>}
            </div>
          </div>

          {(contactMissing || contactEmailMissing) && (
            <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-card)] border-2 border-red-500 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">
              <span aria-hidden="true">⚠️</span>
              {contactMissing
                ? 'No contact linked — link one before this job can be invoiced through Wave.'
                : "This contact has no email on file — add one on their contact page before invoicing through Wave."}
            </div>
          )}

          {latestNote && (
            <div className="mb-4 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2.5 text-sm text-ink">
              <span className="font-semibold text-muted">Latest note: </span>{latestNote}
            </div>
          )}

          <div className="space-y-4">
            {/* Section 1 -- Job details, plus Audio Brief: talk through a
                job and have it fill the fields below in. */}
            <div className={panel}>
              <h3 className="mb-3 text-sm font-bold text-ink">Job details &amp; Audio Brief</h3>

              <div className="mb-4 rounded-md border border-line bg-canvas p-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleBriefMic}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
                      briefListening ? 'bg-port text-white' : 'bg-accent text-ink hover:bg-accent-600'
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                      <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2Z" />
                      <path d="M4.5 7a.5.5 0 0 1 .5.5 3 3 0 0 0 6 0 .5.5 0 0 1 1 0 4 4 0 0 1-3.5 3.97V13H10a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1h1.5v-1.53A4 4 0 0 1 4 7.5a.5.5 0 0 1 .5-.5Z" />
                    </svg>
                    {briefListening ? 'Stop recording' : 'Record brief'}
                  </button>
                  {briefTranscript && !briefListening && (
                    <button
                      type="button"
                      onClick={handleProcessBrief}
                      disabled={processingBrief}
                      className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent disabled:opacity-50"
                    >
                      {processingBrief ? 'Processing…' : 'Process Audio Brief'}
                    </button>
                  )}
                </div>
                {briefTranscript && (
                  <textarea
                    value={briefTranscript}
                    onChange={(e) => setBriefTranscript(e.target.value)}
                    rows={2}
                    placeholder="Talk through the job — pickup, drop-off, vehicle, price..."
                    className="mt-2 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
                  />
                )}
                {briefError && <p className="mt-2 text-xs text-port">{briefError}</p>}
                {briefApplied && (
                  <p className="mt-2 text-xs text-starboard">
                    {briefApplied.fields.length
                      ? `Filled in: ${briefApplied.fields.join(', ')} — review below, then Save.`
                      : "Didn't catch any fields to fill in — try again or type them in below."}
                    {briefApplied.notes && <span className="mt-1 block text-muted">Also mentioned: {briefApplied.notes}</span>}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={label}>Title</label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title" className={field} />
                </div>
                {!isPhotographyOrg && (
                  <div>
                    <label className={label}>Port</label>
                    <select
                      value={port}
                      onChange={(e) => {
                        const v = e.target.value
                        setPort(v)
                        if (PORT_ADDRESS[v]) setPickupAddress(PORT_ADDRESS[v])
                      }}
                      className={field}
                    >
                      <option value="">—</option>
                      {Object.entries(PORT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className={label}>Source</label>
                  <select value={sourceBoard} onChange={(e) => setSourceBoard(e.target.value)} className={field}>
                    <option value="">—</option>
                    {Object.entries(isPhotographyOrg ? PHOTOGRAPHY_SOURCE_LABEL : SOURCE_BOARD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                {!isPhotographyOrg && sourceBoard && sourceBoard !== 'direct' && sourceBoard !== 'referral' && (
                  <div>
                    <label className={label}>Board order #</label>
                    <input value={boardOrderNumber} onChange={(e) => setBoardOrderNumber(e.target.value)} placeholder="e.g. CD-482910" className={field} />
                  </div>
                )}
                <div>
                  <label className={label}>Assigned dispatcher</label>
                  <DispatcherAssignField value={c.assigned_dispatcher_id} dispatchers={dispatchers} onAssign={(id) => onAssignDispatcher(c.id, id)} bare />
                </div>
                <div>
                  <label className={label}>Assigned driver (in-house)</label>
                  <div className="flex gap-1.5">
                    <select
                      value={c.assigned_driver_card_id || ''}
                      onChange={(e) => onPatch({ assigned_driver_card_id: e.target.value || null })}
                      className={`${field} flex-1`}
                    >
                      <option value="">— Unassigned —</option>
                      {drivers?.map((d, i) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name}{i === 0 && d.openJobCount === 0 ? ' (suggested — no open jobs)' : ` (${d.openJobCount} open job${d.openJobCount === 1 ? '' : 's'})`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!assignedDriver}
                      title="Never confirms availability -- text the route, then call to actually confirm they can take it"
                      onClick={() => {
                        let text = driverTextFor(c, latestNote, photoUrl, dropoffInfo, trackingLink)
                        shareBooking({ summaryText: text, recipientPhone: assignedDriver?.sms_number || assignedDriver?.phone })
                      }}
                      className="shrink-0 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-40"
                    >
                      Text route
                    </button>
                    <button
                      type="button"
                      disabled={!assignedDriver}
                      title="On a computer, 'Text route' often can't open Messages -- this copies the same text so you can paste it into iMessage, WhatsApp, or an email instead."
                      onClick={async () => {
                        const text = driverTextFor(c, latestNote, photoUrl, dropoffInfo, trackingLink)
                        if (await copyToClipboard(text)) { setCopiedRoute(true); setTimeout(() => setCopiedRoute(false), 2000) }
                      }}
                      className="shrink-0 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-40"
                    >
                      {copiedRoute ? 'Copied ✓' : '📋 Copy'}
                    </button>
                  </div>
                  <button
                    type="button"
                    title="For a driver who isn't in your driver list -- a carrier from Super Dispatch/Central Dispatch, or someone new you haven't added yet. Opens your own Messages app so you pick who it goes to."
                    onClick={() => {
                      const text = driverTextFor(c, latestNote, photoUrl, dropoffInfo, trackingLink)
                      shareBooking({ summaryText: text })
                    }}
                    className="mt-1.5 text-xs font-medium text-accent hover:underline"
                  >
                    Text to another driver (not in system)
                  </button>
                </div>
                <div>
                  <label className={label}>Ship billing #</label>
                  <input value={billingNumber} onChange={(e) => setBillingNumber(e.target.value.slice(0, 16))} maxLength={16} placeholder="Ship billing #" className={`${field} ${mono}`} />
                </div>
                <div className="sm:col-span-2">
                  <label className={label} title="From the waybill/Bill of Lading -- include the carrier prefix (e.g. MOLU18009385790).">Bill of Lading #</label>
                  <div className="flex gap-1.5">
                    <input
                      value={blNumber} onChange={(e) => setBlNumber(e.target.value.trim())}
                      placeholder="e.g. MOLU18009385790" className={`${field} ${mono} flex-1`}
                    />
                    <button
                      type="button"
                      disabled={!blNumber}
                      title="Just copies the number -- doesn't open anything."
                      onClick={async () => {
                        if (await copyToClipboard(blNumber)) {
                          setCopiedBlNumber(true)
                          setTimeout(() => setCopiedBlNumber(false), 2000)
                        }
                      }}
                      className="shrink-0 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-40"
                    >
                      {copiedBlNumber ? 'Copied ✓' : '📋 Copy'}
                    </button>
                    <button
                      type="button"
                      disabled={!blNumber || trackingShipment}
                      title="Copies the number and opens Ports America's cargo lookup in a new tab -- paste the number in and hit their Search."
                      onClick={async () => {
                        setTrackingShipment(true)
                        try {
                          await openCarrierTracking(blNumber)
                          setTrackedCarrier(true)
                          setTimeout(() => setTrackedCarrier(null), 3000)
                        } finally {
                          setTrackingShipment(false)
                        }
                      }}
                      className="shrink-0 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-40"
                    >
                      🔎 Check port status
                    </button>
                  </div>
                  {trackedCarrier && (
                    <p className="mt-1 text-[11px] text-muted">
                      Number copied — paste it into the BL Number box and hit Search.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Per-2026-09-01 audit -- "who changed this and when" for
                price/deposit/escort fee edits, stage moves, and
                driver/dispatcher (re)assignment. Own section since it spans
                changes made in every other section above. */}
            <div className={panel}>
              <JobActivityLog opportunityId={c.id} />
            </div>

            {/* Section 2 -- Logistics & Pricing: addresses, vehicle, and
                price all together, since they drive each other (the price
                estimator needs the addresses, the suggested price needs the
                vehicle). */}
            <div className={panel}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-ink">Logistics &amp; Pricing</h3>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  title="Save just this job — no need to scroll to the bottom"
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : justSaved ? 'Saved ✓' : 'Save'}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <AddressAutocompleteField label="Pickup" value={pickupAddress} onChange={setPickupAddress} />
                <AddressAutocompleteField label="Drop-off" value={dropoffAddress} onChange={setDropoffAddress} />
              </div>
              {(pickupAddress.trim() !== (c.pickup_address || '') || dropoffAddress.trim() !== (c.dropoff_address || '')) && (
                <p className="mt-2 text-xs text-amber-600">Address changed — hit Save, then Text driver sends the corrected one.</p>
              )}
              <div className="mt-3">
                <label className={label}>Scheduled (Pacific)</label>
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={field} />
              </div>
              {(pickupAddress || dropoffAddress) && (
                <div className="mt-3">
                  <PriceEstimator
                    pickup={pickupAddress} dropoff={dropoffAddress} vehicleType={vehicleType} scheduledAt={fromLocalInput(when)}
                    onUseAmount={(v) => { setAmount(v); setPriceConfirmed(false) }}
                    orgId={c.org_id} opportunityId={c.id}
                    onMilesKnown={setEstimatedMiles}
                  />
                  <SimilarRouteQuotes miles={estimatedMiles} excludeOpportunityId={c.id} />
                </div>
              )}
              {dropoffAddress && (
                <div className="mt-3">
                  <DropoffPreview pickup={pickupAddress} dropoff={dropoffAddress} orgId={c.org_id} opportunityId={c.id} onCoordsReady={setDropoffInfo} />
                </div>
              )}

              {isPhotographyOrg && (
                <div className="mt-4 border-t border-line pt-4">
                  <label className={label}>Project type</label>
                  <select value={projectType} onChange={(e) => setProjectType(e.target.value)} className={field}>
                    <option value="">— Not set —</option>
                    <option value="wedding">Wedding</option>
                    <option value="real_estate">Real estate</option>
                  </select>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className={label}>Venue / property address</label>
                      <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Venue name, or the listing address" className={field} />
                    </div>
                    <div>
                      <label className={label}>Gallery link</label>
                      <input value={galleryLink} onChange={(e) => setGalleryLink(e.target.value)} placeholder="https://…" className={field} />
                    </div>
                  </div>
                  {c.shot_completed_at && (
                    <p className="mt-2 text-xs text-muted">
                      Shot completed: <span className="text-ink">{new Date(c.shot_completed_at).toLocaleString()}</span> (stamped automatically when this job moved to the "Shot" stage)
                    </p>
                  )}
                </div>
              )}

              {!isPhotographyOrg && (
              <div className="mt-4 border-t border-line pt-4">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <label className={`${label} !mb-0`}>Vehicle description</label>
                  {vehicleDescMissing && <span className={redPill}>Needed for invoice</span>}
                </div>
                <input
                  value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. 2022 Toyota Tacoma"
                  className={`${field} ${vehicleDescMissing ? redField : ''}`}
                />
                {hasVehicleDetails && (
                  <p className="mt-2 text-xs text-muted">
                    Captured at booking: <span className="text-ink">{[c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')}</span>
                    {c.vehicle_vin && <span className={mono}> · VIN {c.vehicle_vin}</span>}
                  </p>
                )}
                {c.service_code && <p className="mt-1 text-xs text-muted">Service: <span className="capitalize text-ink">{c.service_code.replace(/_/g, ' ')}</span></p>}
                {photoUrl && (
                  <a href={photoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-accent hover:underline">📷 Vehicle photo ↗</a>
                )}

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3">
                    <label className={label}>VIN</label>
                    <input
                      value={vehicleVin}
                      onChange={(e) => setVehicleVin(e.target.value.toUpperCase().slice(0, 17))}
                      placeholder="17-character VIN — auto-decodes"
                      maxLength={17}
                      className={`${field} ${mono}`}
                    />
                  </div>
                  <div>
                    <label className={label}>Year</label>
                    <input value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value.slice(0, 4))} placeholder="2022" className={field} />
                  </div>
                  <div>
                    <label className={label}>Make</label>
                    <input value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} placeholder="Toyota" className={field} />
                  </div>
                  <div>
                    <label className={label}>Model</label>
                    <input value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} placeholder="Tacoma" className={field} />
                  </div>
                </div>

                {/* Auto-detect popup -- appears as soon as the VIN, description, or
                    manual Year/Make/Model fields resolve to a vehicle. */}
                {(classifying || classifyResult) && (
                  <div className="mt-3 rounded-md border border-accent/40 bg-accent/8 p-3">
                    {classifying ? (
                      <p className="text-xs font-semibold text-ink">Detecting vehicle…</p>
                    ) : classifyResult.vehicle_type ? (
                      <>
                        <p className="text-xs font-semibold text-ink">
                          {classifyResult.guessed ? 'Best guess: ' : 'Detected: '}
                          <span className="text-accent-600">{VEHICLE_TYPE_LABEL[classifyResult.vehicle_type] || classifyResult.vehicle_type}</span>
                          {classifyResult.from_cache && <span className="ml-1 font-normal text-muted">(seen before)</span>}
                        </p>
                        {classifyResult.guessed && <p className="mt-0.5 text-[11px] text-muted">Based on the model name — please confirm below.</p>}
                        {classifyResult.body_class && <p className="mt-0.5 text-[11px] text-muted">NHTSA body class: {classifyResult.body_class}</p>}
                      </>
                    ) : (
                      <p className="text-xs text-ink">
                        {classifyResult.reason || 'Could not auto-detect this vehicle — pick a type below.'}
                        {vehicleType && <span className="block text-[11px] text-muted">Currently set to {VEHICLE_TYPE_LABEL[vehicleType] || vehicleType} below — change it if that's not right.</span>}
                      </p>
                    )}

                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className={label}>Vehicle type</label>
                        <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className={field}>
                          <option value="">—</option>
                          {Object.entries(VEHICLE_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={label}>Condition</label>
                        <select value={vehicleModification} onChange={(e) => setVehicleModification(e.target.value)} className={field}>
                          {Object.entries(VEHICLE_MOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </div>
                    </div>
                    {vehicleType === 'truck' && (
                      <label className="mt-2 flex items-center gap-2 text-xs font-medium text-ink">
                        <input type="checkbox" checked={vehicleExtended} onChange={(e) => setVehicleExtended(e.target.checked)} />
                        Extended / long bed
                      </label>
                    )}
                  </div>
                )}
              </div>
              )}

              <div className="mt-4 border-t border-line pt-4">
                <div className={`grid gap-3 ${isPhotographyOrg ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <label className={`${label} !mb-0`}>Amount ($)</label>
                      {amountMissing && <span className={redPill}>Needed for invoice</span>}
                    </div>
                    <input
                      type="number" inputMode="decimal" min="0" step="1" value={amount}
                      onChange={(e) => { setAmount(e.target.value); setPriceConfirmed(false) }}
                      placeholder="0" className={`${field} ${mono} ${amountMissing ? redField : ''}`}
                    />
                  </div>
                  <div>
                    <label className={label}>Deposit collected ($)</label>
                    <input type="number" inputMode="decimal" min="0" step="1" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0" className={`${field} ${mono}`} />
                  </div>
                  {!isPhotographyOrg && (
                    <div>
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <label
                          className={`${label} !mb-0`}
                          title="Flat port escort fee -- always due in full, never split into a deposit, never part of Amount above. Billed as its own line item on the Wave invoice."
                        >
                          T.W.I.C. Vehicle Service fee ($)
                        </label>
                        {portEscortUnchecked && <span className={redPill}>Port pickup — check this</span>}
                      </div>
                      <input
                        type="number" inputMode="decimal" min="0" step="1" value={escortFee} onChange={(e) => setEscortFee(e.target.value)}
                        placeholder="0" className={`${field} ${mono} ${portEscortUnchecked ? redField : ''}`}
                      />
                    </div>
                  )}
                </div>
                {Number(depositAmount) > 0 && Number(amount) > 0 && (
                  <p className={`${mono} mt-2 text-xs text-muted`}>Balance due at delivery: {money(balance)}</p>
                )}
                {Number(escortFee) > 0 && (
                  <p className={`${mono} mt-1 text-xs text-muted`}>Plus ${Number(escortFee).toLocaleString()} escort fee — flat, due in full, no deposit.</p>
                )}
                {suggestedPrice != null && vehicleType && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-accent/40 bg-accent/8 px-3 py-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Suggested price</p>
                      <p className={`${mono} text-sm font-bold text-ink`}>{money(suggestedPrice)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={confirmPrice}
                      disabled={priceConfirmed && Number(amount) === Number(suggestedPrice)}
                      className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
                    >
                      {priceConfirmed && Number(amount) === Number(suggestedPrice) ? 'Confirmed ✓' : 'Confirm price'}
                    </button>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <PaymentBadgeToggle label="Deposit" paid={c.deposit_paid} onToggle={() => onPatch({ deposit_paid: !c.deposit_paid })} />
                  <PaymentBadgeToggle label="Final" paid={c.paid} onToggle={() => onPatch({ paid: !c.paid })} />
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={!!c.paid_on_site}
                    onChange={(e) => {
                      const checked = e.target.checked
                      onPatch(checked ? { paid_on_site: true, deposit_paid: true, paid: true } : { paid_on_site: false })
                    }}
                  />
                  Paid on-site / COD — driver collected in person, no invoice needed
                </label>
              </div>
            </div>

            {/* Section 3 -- Documents & Execution, split into Billing (ways to
                get paid) and Driver & Contract (everything else) so the three
                invoicing options read as one group instead of one of them
                looking like a random extra button. */}
            <div className={panel}>
              <h3 className="mb-1 text-sm font-bold text-ink">Documents &amp; Execution</h3>

              <h4 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Billing</h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => onOpenInvoice()} className="flex items-center justify-between rounded-md border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink hover:border-accent">
                  Balance invoice {invoice && <InvoiceStatusBadge status={invoice.status} />}
                </button>
                <button type="button" onClick={() => onOpenDepositInvoice()} className="flex items-center justify-between rounded-md border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink hover:border-accent">
                  Deposit invoice {depositInvoice && <InvoiceStatusBadge status={depositInvoice.status} prefix="Deposit: " />}
                </button>
                <button
                  type="button" onClick={handleSendWaveInvoice} disabled={sendingWave}
                  title="Sends a real invoice through your own Wave account -- separate from the invoice buttons above. Marked paid automatically once Wave confirms it (checked every 15 min)."
                  className="flex items-center justify-between rounded-md border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink hover:border-accent disabled:opacity-50 sm:col-span-2"
                >
                  {sendingWave ? 'Sending…' : c.wave_invoice_id ? `📤 Wave invoice ${c.payment_status === 'paid' ? '— Paid ✓' : 'sent'}` : '📤 Send via Wave'}
                </button>
              </div>
              {!c.wave_invoice_id && (contactMissing || contactEmailMissing || amountMissing || vehicleDescMissing) && (
                <p className="mt-1.5 text-[11px] font-semibold text-red-600">
                  Fix the fields marked "Needed for invoice" above before sending via Wave.
                </p>
              )}

              <h4 className="mb-2 mt-4 border-t border-line pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Driver &amp; Contract</h4>
              <button
                type="button"
                onClick={handleSendContract}
                disabled={sendingContract}
                className="flex w-full items-center justify-between rounded-md border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink hover:border-accent disabled:opacity-50"
              >
                <span>{sendingContract ? 'Sending contract…' : contract ? 'Resend contract' : 'Send contract'}</span>
                {contract && <ContractStatusBadge contract={contract} />}
              </button>
              <button type="button" onClick={handleShare} className="mt-2 w-full rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600">
                📱 Text driver / share booking
              </button>
              <button
                type="button" onClick={handleAskDriverForQuote} disabled={requestingQuote}
                className="mt-2 w-full rounded-md border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink hover:border-accent disabled:opacity-50"
              >
                {requestingQuote ? 'Creating link…' : '🚚 Ask driver for quote'}
              </button>
              {isWon && (
                <div className="mt-3">
                  <CompletionVideoField opportunityId={c.id} contactId={c.contact_id} onInteractStart={() => {}} onInteractEnd={() => {}} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer actions -- Save only saves and stays open, so you can see
            it actually went through before leaving; Close (a real "back to
            the board" action, never automatic) is the only thing that exits. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-5 py-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : justSaved ? 'Saved ✓' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            title="Back to the board"
            className="flex items-center gap-1.5 rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
            </svg>
            Close
          </button>
          <button
            type="button"
            onClick={onCancelJob}
            disabled={saving || cancelling}
            title="Cancel this job — it'll disappear from the board"
            className="ml-auto rounded-md px-4 py-2 text-sm font-medium text-port hover:bg-red-50 disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel job'}
          </button>
          <button
            type="button"
            onClick={onDeleteJob}
            disabled={saving || cancelling}
            title="Permanently delete this job — not just cancel it"
            className="rounded-md px-4 py-2 text-sm font-medium text-port hover:bg-red-50 disabled:opacity-50"
          >
            Delete job
          </button>
        </div>
      </div>
    </div>
  )
}

// "Has a driver already quoted a route like this before?" -- fires once
// PriceEstimator has resolved mileage for the current pickup/drop-off.
// Per Shawn 2026-08-30: pickup/drop-off addresses on a repeat lane rarely
// match exactly even when it's the same route, so mileage is the matching
// signal (see fetchSimilarRouteQuotes's tolerance), not the address text --
// the actual routes are shown so Shawn can eyeball whether it's really the
// same lane before trusting the price.
function SimilarRouteQuotes({ miles, excludeOpportunityId }) {
  const { data: matches } = useQuery({
    queryKey: ['similarRouteQuotes', Math.round(miles || 0), excludeOpportunityId],
    queryFn: () => fetchSimilarRouteQuotes(miles, { excludeOpportunityId }),
    enabled: !!miles,
  })

  if (!matches?.length) return null

  return (
    <div className="mt-2 rounded border border-accent/40 bg-accent/8 p-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink">💡 Drivers who've quoted a similar route before</p>
      <ul className="mt-1.5 space-y-1.5">
        {matches.map((m) => (
          <li key={m.id} className="text-[11px] text-ink">
            <span className="font-semibold">{m.driverLabel}</span> — <span className="font-semibold">${Number(m.quoted_amount).toLocaleString()}</span>
            {m.miles ? ` (${Math.round(m.miles)} mi)` : ''}
            <span className="block text-muted">{m.pickup_address} → {m.dropoff_address}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const ACTION_LABELS = {
  price_change: 'Price changed',
  stage_change: 'Stage changed',
  driver_assigned: 'Driver reassigned',
  dispatcher_assigned: 'Dispatcher reassigned',
  deleted: 'Job deleted',
}

// Per-2026-09-01 audit -- "who changed this and when" for the actions that
// cause disputes. Read-only, newest first; there's no undo here, this is
// just a record so a disagreement has an answer.
function JobActivityLog({ opportunityId }) {
  const { data: entries, isLoading } = useQuery({
    queryKey: ['auditLogs', 'opportunity', opportunityId],
    queryFn: () => fetchAuditLogsForEntity('opportunity', opportunityId),
  })

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-sm font-bold text-ink">
        Activity {entries?.length ? `(${entries.length})` : ''}
      </summary>
      <div className="mt-2">
        {isLoading && <p className="text-muted">Loading…</p>}
        {!isLoading && !entries?.length && <p className="text-muted">No changes logged yet.</p>}
        {!!entries?.length && (
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.id} className="border-b border-line/60 pb-1.5 last:border-0">
                <span className="font-medium text-ink">{ACTION_LABELS[e.action] || e.action}</span>
                {e.field ? <span className="text-muted"> ({e.field})</span> : null}
                {e.old_value != null || e.new_value != null ? (
                  <span className="text-muted">: {e.old_value ?? '—'} → {e.new_value ?? '—'}</span>
                ) : null}
                <span className="block text-muted">
                  {e.source === 'telegram' ? 'via Telegram' : (e.user_email || 'Unknown user')} · {new Date(e.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
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

// Deposit-paid / final-paid status, shown as the same bubble style as
// InvoiceStatusBadge/ContractStatusBadge -- red means money hasn't come in
// yet, blue means it has. Still a click-to-flip toggle (not read-only),
// same interaction as the switches it replaced.
function PaymentBadgeToggle({ label, paid, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={paid}
      title={paid ? `${label} paid — click to mark unpaid` : `${label} unpaid — click to mark paid`}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset transition-colors ${
        paid ? 'bg-blue-50 text-blue-600 ring-blue-200 hover:bg-blue-100' : 'bg-red-50 text-red-600 ring-red-200 hover:bg-red-100'
      }`}
    >
      {label} {paid ? 'paid' : 'unpaid'}
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
function InvoiceStatusBadge({ status, prefix = '' }) {
  const key = status && INVOICE_STATUS_STYLE[status] ? status : 'draft'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${INVOICE_STATUS_STYLE[key]}`}>
      {prefix}{INVOICE_STATUS_LABEL[key]}
    </span>
  )
}

function ContractStatusBadge({ contract }) {
  const signed = contract?.status === 'signed'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${signed ? 'bg-emerald-50 text-emerald-600 ring-emerald-200' : 'bg-canvas text-muted ring-line'}`}>
      {signed ? 'Signed' : 'Sent'}
    </span>
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
// card-specific spacing/stop-propagation wrapper for use inside JobDetailModal,
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
