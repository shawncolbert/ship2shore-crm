import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchInvoice, fetchInvoiceBusinessInfo, fetchContactsForInvoice, fetchServicesForInvoice,
  createInvoice, updateInvoice, sendInvoice, markInvoicePaidManually, computeTotals,
} from '../lib/invoices'
import InvoicePreview from '../components/InvoicePreview'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] space-y-3'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))

const EMPTY_FIELDS = {
  contact_id: '', po_number: '',
  bill_to_name: '', bill_to_address: '', bill_to_phone: '', bill_to_email: '',
  ship_to_name: '', ship_to_address: '', ship_to_phone: '',
  invoice_date: new Date().toISOString().slice(0, 10), due_date: '', notes: '',
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

  const { data: businessInfo } = useQuery({ queryKey: ['invoiceBusinessInfo'], queryFn: fetchInvoiceBusinessInfo })
  const { data: contacts } = useQuery({ queryKey: ['contactsForInvoice'], queryFn: fetchContactsForInvoice })
  const { data: services } = useQuery({ queryKey: ['servicesForInvoice'], queryFn: fetchServicesForInvoice })
  const { data: existing, isLoading } = useQuery({
    queryKey: ['invoice', id], queryFn: () => fetchInvoice(id), enabled: !isNew,
  })

  const [fields, setFields] = useState(EMPTY_FIELDS)
  const [lineItems, setLineItems] = useState([blankLineItem()])
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState(null)
  const [invoiceId, setInvoiceId] = useState(isNew ? null : id)

  useEffect(() => {
    if (existing?.invoice) {
      const inv = existing.invoice
      setFields({
        contact_id: inv.contact_id || '',
        po_number: inv.po_number || '',
        bill_to_name: inv.bill_to_name || '', bill_to_address: inv.bill_to_address || '',
        bill_to_phone: inv.bill_to_phone || '', bill_to_email: inv.bill_to_email || '',
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
    }
  }, [existing])

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

  const doSave = async () => {
    if (usableLineItems.length === 0) { setErr('Add at least one line item first.'); return null }
    setErr(''); setSaving(true)
    try {
      const result = isNew && !invoiceId
        ? await createInvoice({ fields, lineItems: usableLineItems })
        : await updateInvoice(invoiceId || id, { fields, lineItems: usableLineItems })
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
      } else if (!result.stripeConfigured) {
        setNotice({ type: 'warning', text: 'Invoice emailed — but Stripe isn’t connected yet, so there’s no live Pay Now link. The customer can view the invoice; connect Stripe in Payments to enable online payment.' })
      } else {
        setNotice({ type: 'success', text: 'Invoice emailed with a live Pay Now link.' })
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

  const publicUrl = invoiceId || id ? `${window.location.origin}/invoice/${invoiceId || id}` : null

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Link to="/invoices" className="text-sm text-muted hover:text-ink">‹ Invoices</Link>

      <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
            {isNew ? 'New invoice' : `Invoice ${invoice?.invoice_number || ''}`}
          </h1>
          {invoice?.status && <StatusBadge status={invoice.status} />}
        </div>
        {!isNew && (
          <div className="flex flex-wrap gap-2">
            {invoice?.status !== 'paid' && <button onClick={handleMarkPaid} className={btn}>Mark as Paid</button>}
            {publicUrl && (
              <a href={publicUrl} target="_blank" rel="noreferrer" className={btn}>View customer page ↗</a>
            )}
          </div>
        )}
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
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
          <InvoicePreview businessInfo={businessInfo} invoice={previewInvoice} lineItems={usableLineItems} />
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
