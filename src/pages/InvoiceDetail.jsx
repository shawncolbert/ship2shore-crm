import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchInvoice, fetchInvoiceBusinessInfo, fetchContactsForInvoice, fetchServicesForInvoice,
  fetchOpportunityForInvoice, createInvoice, updateInvoice, sendInvoice, markInvoicePaidManually,
  markInvoiceComplete, unmarkInvoiceComplete, deleteInvoice, computeTotals,
} from '../lib/invoices'
import { fetchPaymentSettings, fetchWaveCheckoutLinks } from '../lib/supabase'
import InvoicePreview from '../components/InvoicePreview'

const DEFAULT_PAYMENT_OPTIONS = { stripe: true, wave: false, zelle: false, venmo: false, cashapp: false, apple_pay: false }
const HANDLE_METHODS = [
  { key: 'zelle', field: 'zelle_handle', label: 'Zelle' },
  { key: 'venmo', field: 'venmo_handle', label: 'Venmo' },
  { key: 'cashapp', field: 'cashapp_handle', label: 'Cash App' },
  { key: 'apple_pay', field: 'apple_pay_handle', label: 'Apple Pay' },
]

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] space-y-3'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))

const EMPTY_FIELDS = {
  contact_id: '', po_number: '',
  bill_to_name: '', bill_to_address: '', bill_to_phone: '', bill_to_email: '',
  ship_from_name: '', ship_from_address: '', ship_from_phone: '',
  ship_to_name: '', ship_to_address: '', ship_to_phone: '',
  invoice_date: new Date().toISOString().slice(0, 10), due_date: '', notes: '',
}

// Whichever vehicle detail the job actually has -- structured year/make/
// model from PublicBooking's form, or just the flat text a landing-page
// lead came in with -- appended onto the line item so the invoice says
// what's being shipped, not just a generic job title.
function vehicleDetail(opp) {
  const structured = [opp.vehicle_year, opp.vehicle_make, opp.vehicle_model].filter(Boolean).join(' ')
  return structured || opp.vehicle || ''
}
const blankLineItem = () => ({ service_id: '', description: '', quantity: 1, unit_price: 0 })

function fillBillToFromContact(contact) {
  const nameLines = [contact.company, contact.full_name].filter(Boolean)
  return {
    bill_to_name: nameLines.join('\n'),
    bill_to_address: contact.custom_fields?.address || '',
    bill_to_phone: contact.phone || '',
    bill_to_email: contact.email || '',
  }
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  // New invoices get this from the URL (the pipeline card's Invoice button
  // passes it); existing ones carry it on the row itself once linked, since
  // a card whose invoice already exists just reopens that same invoice --
  // its own prefill effect below only fires once, on creation.
  const opportunityId = isNew ? searchParams.get('opportunity_id') : null

  const { data: businessInfo } = useQuery({ queryKey: ['invoiceBusinessInfo'], queryFn: fetchInvoiceBusinessInfo })
  const { data: contacts } = useQuery({ queryKey: ['contactsForInvoice'], queryFn: fetchContactsForInvoice })
  const { data: services } = useQuery({ queryKey: ['servicesForInvoice'], queryFn: fetchServicesForInvoice })
  const { data: paymentSettings } = useQuery({ queryKey: ['paymentSettings'], queryFn: fetchPaymentSettings })
  const { data: waveLinks } = useQuery({ queryKey: ['waveCheckoutLinks'], queryFn: fetchWaveCheckoutLinks })
  const { data: existing, isLoading } = useQuery({
    queryKey: ['invoice', id], queryFn: () => fetchInvoice(id), enabled: !isNew,
  })
  const linkedOpportunityId = opportunityId || existing?.invoice?.opportunity_id || null
  // Started from a pipeline card's Invoice button -- prefills Bill To,
  // Ship From/To and a line item from the job, so the dispatcher isn't
  // retyping the customer, addresses and amount that are already sitting
  // right there on the card. Kept loaded even for an already-saved invoice
  // so the "Pull from job" button below has something to pull.
  const { data: sourceOpportunity, error: sourceOpportunityError } = useQuery({
    queryKey: ['opportunityForInvoice', linkedOpportunityId],
    queryFn: () => fetchOpportunityForInvoice(linkedOpportunityId),
    enabled: !!linkedOpportunityId,
  })

  const [fields, setFields] = useState(EMPTY_FIELDS)
  const [lineItems, setLineItems] = useState([blankLineItem()])
  const [paymentOptions, setPaymentOptions] = useState(DEFAULT_PAYMENT_OPTIONS)
  const [waveCheckoutLinkId, setWaveCheckoutLinkId] = useState('')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderIntervalDays, setReminderIntervalDays] = useState(7)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [marking, setMarking] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState(null)
  const [invoiceId, setInvoiceId] = useState(isNew ? null : id)
  const [prefilledFrom, setPrefilledFrom] = useState(null)

  useEffect(() => {
    if (existing?.invoice) {
      const inv = existing.invoice
      setFields({
        contact_id: inv.contact_id || '',
        po_number: inv.po_number || '',
        bill_to_name: inv.bill_to_name || '', bill_to_address: inv.bill_to_address || '',
        bill_to_phone: inv.bill_to_phone || '', bill_to_email: inv.bill_to_email || '',
        ship_from_name: inv.ship_from_name || '', ship_from_address: inv.ship_from_address || '',
        ship_from_phone: inv.ship_from_phone || '',
        ship_to_name: inv.ship_to_name || '', ship_to_address: inv.ship_to_address || '',
        ship_to_phone: inv.ship_to_phone || '',
        invoice_date: inv.invoice_date || EMPTY_FIELDS.invoice_date,
        due_date: inv.due_date || '', notes: inv.notes || '',
      })
      setLineItems(
        existing.lineItems.length
          ? existing.lineItems.map((li) => ({ service_id: li.service_id || '', description: li.description, quantity: li.quantity, unit_price: li.unit_price }))
          : [blankLineItem()]
      )
      setPaymentOptions({ ...DEFAULT_PAYMENT_OPTIONS, ...(inv.payment_options || {}) })
      setWaveCheckoutLinkId(inv.wave_checkout_link_id || '')
      setReminderEnabled(!!inv.reminder_enabled)
      setReminderIntervalDays(inv.reminder_interval_days || 7)
    }
  }, [existing])

  // Shared by the auto-prefill (brand-new invoice) and the manual "Pull
  // from job" button (an already-saved one) below -- same fields either way.
  const applyOpportunity = (opp) => {
    const contact = opp.contacts
    const detail = vehicleDetail(opp)
    setFields((f) => ({
      ...f,
      contact_id: opp.contact_id || '',
      po_number: opp.billing_number || '',
      ...(contact ? fillBillToFromContact(contact) : {}),
      // Pickup is where we're shipping it from, drop-off is where it's
      // going -- Ship To already existed for the destination, Ship From
      // is the new half of that pair for the origin.
      ship_from_address: opp.pickup_address || '',
      ship_to_address: opp.dropoff_address || '',
    }))
    setLineItems([{
      service_id: '', quantity: 1, unit_price: Number(opp.value) || 0,
      description: [opp.title, detail].filter(Boolean).join(' — '),
    }])
    setPrefilledFrom(opp.id)
  }

  useEffect(() => {
    // Only auto-fires for a brand-new invoice -- an already-saved one only
    // updates when someone explicitly hits "Pull from job", so this never
    // silently overwrites edits made after the invoice was first created.
    if (isNew && sourceOpportunity && prefilledFrom !== sourceOpportunity.id) {
      applyOpportunity(sourceOpportunity)
      setNotice({ type: 'success', text: 'Pulled Bill To, Ship From/To and the price from the linked job.' })
    }
  }, [isNew, sourceOpportunity, prefilledFrom])

  const togglePaymentOption = (key) => setPaymentOptions((o) => ({ ...o, [key]: !o[key] }))

  if (!isNew && isLoading) return <div className="p-8 text-sm text-muted">Loading…</div>

  const invoice = existing?.invoice
  const locked = invoice?.status === 'paid'

  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }))

  const onSelectContact = (e) => {
    const cid = e.target.value
    const contact = contacts?.find((c) => c.id === cid)
    setFields((f) => ({ ...f, contact_id: cid, ...(contact ? fillBillToFromContact(contact) : {}) }))
  }

  const updateLine = (i, patch) => setLineItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const onSelectService = (i, serviceId) => {
    const svc = services?.find((s) => s.id === serviceId)
    updateLine(i, { service_id: serviceId, description: svc?.name || lineItems[i].description, unit_price: svc ? Number(svc.default_rate) : lineItems[i].unit_price })
  }
  const removeLine = (i) => setLineItems((rows) => rows.filter((_, idx) => idx !== i))
  const addLine = () => setLineItems((rows) => [...rows, blankLineItem()])

  const usableLineItems = lineItems.filter((li) => li.description.trim())
  const { total } = computeTotals(usableLineItems)

  const previewInvoice = {
    ...fields, invoice_number: invoice?.invoice_number || '(assigned on save)',
    status: invoice?.status || 'draft', total, amount_due: invoice?.status === 'paid' ? 0 : total,
    paid_at: invoice?.paid_at, payment_method: invoice?.payment_method,
  }

  const selectedWaveLink = waveLinks?.find((l) => l.id === waveCheckoutLinkId) || null

  // Live-preview version of the send-time resolver in
  // _shared/invoicePaymentOptions.js -- Stripe's real link doesn't exist
  // until send, so it previews with a placeholder href just to show the
  // button will be there.
  const previewPaymentOptions = [
    ...(paymentOptions.stripe ? [{ method: 'stripe', label: 'Card (Stripe)', kind: 'link', url: '#' }] : []),
    ...(paymentOptions.wave && selectedWaveLink ? [{ method: 'wave', label: `Wave Checkout — ${selectedWaveLink.label}`, kind: 'link', url: selectedWaveLink.url }] : []),
    ...HANDLE_METHODS.filter((m) => paymentOptions[m.key] && paymentSettings?.[m.field]).map((m) => ({
      method: m.key, label: m.label,
      kind: m.key === 'venmo' || m.key === 'cashapp' ? 'link' : 'handle',
      url: '#', handle: paymentSettings[m.field],
    })),
  ]

  const doSave = async () => {
    if (usableLineItems.length === 0) { setErr('Add at least one line item first.'); return null }
    setErr(''); setSaving(true)
    try {
      const fieldsToSave = {
        ...fields, payment_options: paymentOptions, opportunity_id: opportunityId,
        wave_checkout_link_id: paymentOptions.wave ? waveCheckoutLinkId || null : null,
        wave_checkout_url: paymentOptions.wave ? selectedWaveLink?.url || null : null,
        reminder_enabled: reminderEnabled, reminder_interval_days: reminderIntervalDays,
      }
      const result = isNew && !invoiceId
        ? await createInvoice({ fields: fieldsToSave, lineItems: usableLineItems })
        : await updateInvoice(invoiceId || id, { fields: fieldsToSave, lineItems: usableLineItems })
      setInvoiceId(result.invoice.id)
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoice', result.invoice.id] })
      if (isNew) navigate(`/invoices/${result.invoice.id}`, { replace: true })
      return result.invoice.id
    } catch (e) {
      setErr(e.message || 'Could not save this invoice.')
      return null
    } finally {
      setSaving(false)
    }
  }

  const handleSaveDraft = async () => {
    const savedId = await doSave()
    if (savedId) setNotice({ type: 'success', text: 'Draft saved.' })
  }

  const handleSend = async () => {
    if (!fields.bill_to_email.trim()) { setErr('Bill To email is required to send an invoice.'); return }
    const savedId = await doSave()
    if (!savedId) return
    setSending(true); setErr(''); setNotice(null)
    try {
      const result = await sendInvoice(savedId)
      qc.invalidateQueries({ queryKey: ['invoice', savedId] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      if (!result.emailSent) {
        setNotice({ type: 'warning', text: `Invoice saved as sent, but the email didn't go out: ${result.emailError || 'unknown error'}. Share the customer page link directly instead: ${result.publicUrl}` })
      } else if (paymentOptions.stripe && !result.stripeConfigured) {
        setNotice({ type: 'warning', text: `Invoice emailed — but Stripe isn't connected yet, so there's no live Stripe link. ${result.paymentOptionsSent?.length ? `Sent with: ${result.paymentOptionsSent.join(', ')}.` : 'No other payment option was checked, so the customer only got a view link.'} Connect Stripe in Payments to enable it.` })
      } else if (!result.paymentOptionsSent?.length) {
        setNotice({ type: 'warning', text: 'Invoice emailed, but no payment option was actually included — check a box under Payment Options (and make sure any handle/link it needs is filled in) before sending again, or use "View customer page" to share it manually.' })
      } else {
        setNotice({ type: 'success', text: `Invoice emailed with: ${result.paymentOptionsSent.join(', ')}.` })
      }
    } catch (e) {
      setErr(e.message || 'Could not send this invoice.')
    } finally {
      setSending(false)
    }
  }

  const handleMarkPaid = async () => {
    const method = prompt('How was this invoice paid? (e.g. Cash, Check, Venmo, Zelle)')
    if (method === null) return
    try {
      await markInvoicePaidManually(invoiceId || id, { paymentMethod: method })
      qc.invalidateQueries({ queryKey: ['invoice', invoiceId || id] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      setNotice({ type: 'success', text: 'Marked as paid.' })
    } catch (e) {
      setErr(e.message || 'Could not update this invoice.')
    }
  }

  // "Job done" (car picked up / service performed) is independent of
  // payment status -- this also drops a note into the customer's own
  // Timeline on their Contact page, the same ledger delivery orders and
  // other paperwork already land in.
  const handleMarkDone = async () => {
    setMarking(true); setErr('')
    try {
      await markInvoiceComplete(invoiceId || id)
      qc.invalidateQueries({ queryKey: ['invoice', invoiceId || id] })
      qc.invalidateQueries({ queryKey: ['completedJobs'] })
      setNotice({ type: 'success', text: 'Marked job done — also noted on the customer\'s Timeline.' })
    } catch (e) {
      setErr(e.message || 'Could not mark this job done.')
    } finally {
      setMarking(false)
    }
  }

  const handleUnmarkDone = async () => {
    setMarking(true); setErr('')
    try {
      await unmarkInvoiceComplete(invoiceId || id)
      qc.invalidateQueries({ queryKey: ['invoice', invoiceId || id] })
      qc.invalidateQueries({ queryKey: ['completedJobs'] })
      setNotice({ type: 'success', text: 'Un-marked as done.' })
    } catch (e) {
      setErr(e.message || 'Could not update this job.')
    } finally {
      setMarking(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete invoice ${invoice?.invoice_number || ''}? This can't be undone.`)) return
    try {
      await deleteInvoice(invoiceId || id)
      qc.invalidateQueries({ queryKey: ['invoices'] })
      navigate('/invoices')
    } catch (e) {
      setErr(e.message || 'Could not delete this invoice.')
    }
  }

  const publicUrl = invoiceId || id ? `${window.location.origin}/invoice/${invoiceId || id}` : null

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Link to="/invoices" className="text-sm text-muted hover:text-ink">‹ Invoices</Link>

      <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
            {isNew ? 'New invoice' : `Invoice ${invoice?.invoice_number || ''}`}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {invoice?.status && <StatusBadge status={invoice.status} />}
            {invoice?.completed_at && (
              <span
                title={`Marked done ${new Date(invoice.completed_at).toLocaleString()}`}
                className="inline-block rounded-full bg-starboard/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-starboard"
              >
                ✓ Job done {new Date(invoice.completed_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        {!isNew && (
          <div className="flex flex-wrap gap-2">
            {linkedOpportunityId && sourceOpportunity && (
              <button
                onClick={() => { applyOpportunity(sourceOpportunity); setNotice({ type: 'success', text: 'Pulled the latest from the job.' }) }}
                disabled={locked}
                className={btn}
                title="Re-fill Bill To, Ship From/To and the line item from this invoice's linked job"
              >
                ⟳ Pull from job
              </button>
            )}
            {invoice?.status !== 'paid' && <button onClick={handleMarkPaid} className={btn}>Mark as Paid</button>}
            <button onClick={invoice?.completed_at ? handleUnmarkDone : handleMarkDone} disabled={marking} className={btn}>
              {invoice?.completed_at ? 'Undo job done' : 'Mark job done'}
            </button>
            {publicUrl && (
              <a href={publicUrl} target="_blank" rel="noreferrer" className={btn}>View customer page ↗</a>
            )}
            <button onClick={handleDelete} className="rounded p-2 text-muted hover:bg-red-50 hover:text-red-500" title="Delete invoice">
              🗑️
            </button>
          </div>
        )}
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
      {sourceOpportunityError && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">
          ⚠️ Couldn't pull data from the linked job: {sourceOpportunityError.message}
        </p>
      )}
      {notice && (
        <p className={`mb-4 rounded-md px-3 py-2 text-sm ${notice.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
          {notice.type === 'success' ? '✓ ' : '⚠️ '}{notice.text}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Form */}
        <div className={locked ? 'pointer-events-none opacity-60' : ''}>
          <div className="space-y-4">
            <section className={card}>
              <h2 className="text-sm font-semibold text-ink">Bill to</h2>
              <label className="block">
                <span className={label}>Pick an existing contact (optional)</span>
                <select value={fields.contact_id} onChange={onSelectContact} className={input}>
                  <option value="">— Enter manually —</option>
                  {contacts?.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.company || c.email}</option>)}
                </select>
              </label>
              <Field label="Name / Company"><textarea value={fields.bill_to_name} onChange={set('bill_to_name')} rows={2} className={input} /></Field>
              <Field label="Address"><textarea value={fields.bill_to_address} onChange={set('bill_to_address')} rows={2} className={input} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone"><input value={fields.bill_to_phone} onChange={set('bill_to_phone')} className={input} /></Field>
                <Field label="Email"><input type="email" value={fields.bill_to_email} onChange={set('bill_to_email')} className={input} /></Field>
              </div>
            </section>

            <section className={card}>
              <h2 className="text-sm font-semibold text-ink">Ship from (optional)</h2>
              <Field label="Name"><input value={fields.ship_from_name} onChange={set('ship_from_name')} className={input} /></Field>
              <Field label="Address"><textarea value={fields.ship_from_address} onChange={set('ship_from_address')} rows={2} className={input} /></Field>
              <Field label="Phone"><input value={fields.ship_from_phone} onChange={set('ship_from_phone')} className={input} /></Field>
            </section>

            <section className={card}>
              <h2 className="text-sm font-semibold text-ink">Ship to (optional)</h2>
              <Field label="Name"><input value={fields.ship_to_name} onChange={set('ship_to_name')} className={input} /></Field>
              <Field label="Address"><textarea value={fields.ship_to_address} onChange={set('ship_to_address')} rows={2} className={input} /></Field>
              <Field label="Phone"><input value={fields.ship_to_phone} onChange={set('ship_to_phone')} className={input} /></Field>
            </section>

            <section className={card}>
              <h2 className="text-sm font-semibold text-ink">Invoice details</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Invoice date"><input type="date" value={fields.invoice_date} onChange={set('invoice_date')} className={input} /></Field>
                <Field label="Payment due"><input type="date" value={fields.due_date} onChange={set('due_date')} className={input} /></Field>
              </div>
              <Field label="P.O./S.O. number (optional)"><input value={fields.po_number} onChange={set('po_number')} className={input} /></Field>
              <Field label="Notes / Terms"><textarea value={fields.notes} onChange={set('notes')} rows={2} className={input} placeholder="EIN, payment terms, thank-you note…" /></Field>
            </section>

            <section className={card}>
              <h2 className="text-sm font-semibold text-ink">Line items</h2>
              <div className="space-y-2">
                {lineItems.map((li, i) => (
                  <div key={i} className="rounded-lg border border-line bg-canvas/60 p-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                      <select value={li.service_id} onChange={(e) => onSelectService(i, e.target.value)} className={input}>
                        <option value="">Custom line item</option>
                        {services?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <input value={li.description} onChange={(e) => updateLine(i, { description: e.target.value })} placeholder="Description" className={input} />
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                      <input type="number" min="0" step="1" value={li.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} placeholder="Qty" className={input} />
                      <input type="number" min="0" step="0.01" value={li.unit_price} onChange={(e) => updateLine(i, { unit_price: e.target.value })} placeholder="Price" className={input} />
                      <div className="text-right text-sm font-medium text-ink">{money((Number(li.quantity) || 0) * (Number(li.unit_price) || 0))}</div>
                      <button onClick={() => removeLine(i)} className="rounded p-1.5 text-muted hover:bg-red-50 hover:text-red-500" title="Remove line">✕</button>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={addLine} className="text-xs font-semibold text-accent hover:underline">+ Add line item</button>
              <div className="flex justify-end border-t border-line pt-3 text-sm font-bold text-ink">Total: {money(total)}</div>
            </section>

            <section className={card}>
              <h2 className="text-sm font-semibold text-ink">Payment options</h2>
              <p className="-mt-1 text-xs text-muted">Pick which ways to pay show up when this invoice goes out.</p>

              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={paymentOptions.stripe} onChange={() => togglePaymentOption('stripe')} className="h-4 w-4 rounded border-line" />
                Stripe (automatic pay-now link, if connected)
              </label>

              <div>
                <label className={`flex items-center gap-2 text-sm ${waveLinks?.length ? 'text-ink' : 'text-muted'}`}>
                  <input
                    type="checkbox"
                    checked={paymentOptions.wave}
                    disabled={!waveLinks?.length}
                    onChange={() => togglePaymentOption('wave')}
                    className="h-4 w-4 rounded border-line"
                  />
                  Wave Checkout link
                </label>
                {paymentOptions.wave && waveLinks?.length > 0 && (
                  <div className="mt-1.5 ml-6">
                    <select value={waveCheckoutLinkId} onChange={(e) => setWaveCheckoutLinkId(e.target.value)} className={input}>
                      <option value="">— Pick a saved link —</option>
                      {waveLinks.map((l) => (
                        <option key={l.id} value={l.id}>{l.label}{l.amount != null ? ` — ${money(l.amount)}` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
                {!waveLinks?.length && (
                  <p className="mt-1 ml-6 text-[11px] text-muted">
                    No Wave Checkout links saved yet — add one in <Link to="/payment-settings" className="text-accent hover:underline">Payment Settings</Link>.
                  </p>
                )}
              </div>

              {HANDLE_METHODS.map((m) => {
                const handle = paymentSettings?.[m.field]
                return (
                  <label key={m.key} className={`flex items-center gap-2 text-sm ${handle ? 'text-ink' : 'text-muted'}`}>
                    <input
                      type="checkbox"
                      checked={paymentOptions[m.key]}
                      disabled={!handle}
                      onChange={() => togglePaymentOption(m.key)}
                      className="h-4 w-4 rounded border-line"
                    />
                    {m.label}
                    {handle ? <span className="text-xs text-muted">({handle})</span> : <Link to="/payment-settings" className="text-xs text-accent hover:underline">set handle in Payment Settings</Link>}
                  </label>
                )
              })}
            </section>

            <section className={card}>
              <h2 className="text-sm font-semibold text-ink">Payment reminders</h2>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={reminderEnabled}
                  onChange={(e) => setReminderEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-line"
                />
                Auto-remind if unpaid
              </label>
              {reminderEnabled && (
                <div className="ml-6 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted">Every</span>
                  <select
                    value={[3, 7].includes(reminderIntervalDays) ? reminderIntervalDays : 'custom'}
                    onChange={(e) => setReminderIntervalDays(e.target.value === 'custom' ? 14 : Number(e.target.value))}
                    className={input + ' w-auto'}
                  >
                    <option value={3}>3 days</option>
                    <option value={7}>7 days</option>
                    <option value="custom">Custom</option>
                  </select>
                  {![3, 7].includes(reminderIntervalDays) && (
                    <input
                      type="number" min="1" step="1"
                      value={reminderIntervalDays}
                      onChange={(e) => setReminderIntervalDays(Math.max(1, Number(e.target.value) || 1))}
                      className={input + ' w-20'}
                    />
                  )}
                  <span className="text-sm text-muted">days, starting the day it's sent</span>
                </div>
              )}
              <p className="-mt-1 text-[11px] text-muted">
                Only fires while the invoice is unpaid, and stops the moment it's marked Paid. Off by default —
                nothing gets sent unless you check this box.
              </p>
            </section>

            {!locked && (
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={handleSaveDraft} disabled={saving || sending} className={btn}>
                  {saving ? 'Saving…' : 'Save draft'}
                </button>
                <button onClick={handleSend} disabled={saving || sending} className={btnAccent}>
                  {sending ? 'Sending…' : 'Send invoice'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <InvoicePreview businessInfo={businessInfo} invoice={previewInvoice} lineItems={usableLineItems} paymentOptions={previewPaymentOptions} />
        </div>
      </div>
    </div>
  )
}

function Field({ label: l, children }) {
  return (
    <label className="block">
      <span className={label}>{l}</span>
      {children}
    </label>
  )
}

function StatusBadge({ status }) {
  const styles = {
    draft: 'bg-canvas text-muted ring-1 ring-inset ring-line',
    sent: 'bg-sky-50 text-sky-700',
    paid: 'bg-starboard/15 text-starboard',
    overdue: 'bg-red-50 text-red-600',
  }
  return (
    <span className={`mt-1 inline-block rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${styles[status] || styles.draft}`}>
      {status}
    </span>
  )
}
