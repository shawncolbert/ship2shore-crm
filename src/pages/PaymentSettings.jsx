import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPaymentSettings, savePaymentSettings } from '../lib/supabase'
import { PAYMENT_METHODS } from '../lib/paymentRequest'

const card = 'rounded-xl border border-line bg-surface p-5'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'

const PLACEHOLDER = {
  zelle_handle: 'Phone number or email registered with Zelle',
  venmo_handle: '@your-venmo-username',
  cashapp_handle: '$your-cashtag',
  apple_pay_handle: 'Phone number or email for Apple Pay',
}

export default function PaymentSettings() {
  const { data, isLoading } = useQuery({ queryKey: ['paymentSettings'], queryFn: fetchPaymentSettings })
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (data) {
      setForm({
        zelle_handle: data.zelle_handle || '',
        venmo_handle: data.venmo_handle || '',
        cashapp_handle: data.cashapp_handle || '',
        apple_pay_handle: data.apple_pay_handle || '',
        default_method: data.default_method || '',
      })
    }
  }, [data])

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false) }

  async function save() {
    setSaving(true); setErr('')
    try {
      await savePaymentSettings({ ...form, default_method: form.default_method || null })
      setSaved(true)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !form) return <div className="p-8 text-sm text-muted">Loading…</div>

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Payment Settings</h1>
        <p className="max-w-2xl text-sm text-muted">
          Enter your handles once. On a job card, the 💲 button sends the customer a payment request for whichever
          method you pick — the request goes out immediately, no review step. None of these apps have an API, so
          you'll still confirm and move the card to Paid yourself once the money actually arrives.
        </p>
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
      {saved && <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ Saved</p>}

      <div className={card}>
        <div className="grid gap-4 sm:grid-cols-2">
          {PAYMENT_METHODS.map((m) => (
            <div key={m.value}>
              <label className={label}>{m.label}</label>
              <input
                className={input}
                value={form[m.handleField]}
                onChange={set(m.handleField)}
                placeholder={PLACEHOLDER[m.handleField]}
              />
            </div>
          ))}
        </div>

        <div className="mt-4 max-w-xs">
          <label className={label}>Default method</label>
          <select className={input} value={form.default_method} onChange={set('default_method')}>
            <option value="">None</option>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-muted">
            Used by the "Send payment request" automation when a job has no method requested yet.
          </p>
        </div>

        <button className={btnAccent + ' mt-5'} disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
