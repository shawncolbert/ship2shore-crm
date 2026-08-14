import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchInvoices, fetchInvoiceBusinessInfo, saveInvoiceBusinessInfo, uploadInvoiceLogo } from '../lib/invoices'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] space-y-3'
const btnAccent = 'rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-600'
const btn = 'rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas'
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

const STATUS_STYLES = {
  draft: 'bg-canvas text-muted ring-1 ring-inset ring-line',
  sent: 'bg-sky-50 text-sky-700',
  paid: 'bg-starboard/15 text-starboard',
  overdue: 'bg-red-50 text-red-600',
}

export default function Invoices() {
  const [showSettings, setShowSettings] = useState(false)
  const { data: invoices, isLoading } = useQuery({ queryKey: ['invoices'], queryFn: fetchInvoices })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Invoices</h1>
          <p className="text-sm text-muted">Bill customers, get paid online, track what's outstanding.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSettings(true)} className={btn}>Business info</button>
          <Link to="/invoices/new" className={btnAccent}>+ New invoice</Link>
        </div>
      </header>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      {!isLoading && invoices?.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line p-10 text-center">
          <p className="text-sm font-medium text-ink">No invoices yet</p>
          <p className="mt-1 text-sm text-muted">Create your first invoice to bill a customer and collect payment.</p>
        </div>
      )}

      {invoices?.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Invoice</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Due</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Amount due</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-line/60 last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <Link to={`/invoices/${inv.id}`} className="font-semibold text-accent hover:underline">{inv.invoice_number}</Link>
                  </td>
                  <td className="px-4 py-3 text-ink">{inv.contacts?.full_name || inv.contacts?.company || '—'}</td>
                  <td className="px-4 py-3 text-muted">{fmtDate(inv.invoice_date)}</td>
                  <td className="px-4 py-3 text-muted">{fmtDate(inv.due_date)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[inv.status] || STATUS_STYLES.draft}`}>
                      {inv.status}
                    </span>
                    {inv.status === 'paid' && inv.paid_at && (
                      <div className="mt-1 text-[11px] text-muted">{fmtDate(inv.paid_at.slice(0, 10))}{inv.payment_method ? ` · ${inv.payment_method}` : ''}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-ink">{money(inv.amount_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showSettings && <BusinessInfoModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function BusinessInfoModal({ onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ['invoiceBusinessInfo'], queryFn: fetchInvoiceBusinessInfo })
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!isLoading && data && !form) {
      setForm({
        invoice_business_name: data.invoice_business_name || data.name || '',
        invoice_business_address: data.invoice_business_address || '',
        invoice_business_phone: data.invoice_business_phone || '',
        invoice_business_website: data.invoice_business_website || '',
        invoice_business_ein: data.invoice_business_ein || '',
        logo_url: data.logo_url || '',
      })
    }
  }, [isLoading, data, form])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true); setErr('')
    try {
      const url = await uploadInvoiceLogo(file)
      setForm((f) => ({ ...f, logo_url: url }))
    } catch (e2) {
      setErr(e2.message || 'Could not upload that logo.')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await saveInvoiceBusinessInfo(form)
      onClose()
    } catch (e) {
      setErr(e.message || 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className={`${card} relative z-10 w-full max-w-lg rounded-t-2xl sm:rounded-2xl`}>
        <h2 className="text-sm font-semibold text-ink">Business info for invoices</h2>
        <p className="text-xs text-muted">Shown on every invoice header (this also sets your organization's logo used elsewhere in the app).</p>
        {form && (
          <>
            <label className="block">
              <span className={label}>Logo</span>
              <div className="flex items-center gap-3">
                <label className={`${btn} cursor-pointer`}>
                  {uploading ? 'Uploading…' : 'Upload a logo'}
                  <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={uploadLogo} />
                </label>
                {form.logo_url && <img src={form.logo_url} alt="" className="h-10 w-10 rounded object-contain" />}
              </div>
            </label>
            <label className="block"><span className={label}>Business name</span><input value={form.invoice_business_name} onChange={set('invoice_business_name')} className={input} /></label>
            <label className="block"><span className={label}>Address</span><textarea value={form.invoice_business_address} onChange={set('invoice_business_address')} rows={2} className={input} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className={label}>Phone</span><input value={form.invoice_business_phone} onChange={set('invoice_business_phone')} className={input} /></label>
              <label className="block"><span className={label}>Website</span><input value={form.invoice_business_website} onChange={set('invoice_business_website')} className={input} /></label>
            </div>
            <label className="block"><span className={label}>EIN (optional, shown in Notes/Terms if set)</span><input value={form.invoice_business_ein} onChange={set('invoice_business_ein')} className={input} /></label>
          </>
        )}
        {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btn}>Cancel</button>
          <button onClick={save} disabled={saving || !form} className={btnAccent}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
