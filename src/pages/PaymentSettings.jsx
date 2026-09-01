import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchPaymentSettings, savePaymentSettings,
  fetchWaveCheckoutLinks, createWaveCheckoutLink, deleteWaveCheckoutLink,
} from '../lib/supabase'
import { PAYMENT_METHODS } from '../lib/paymentRequest'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'
const money = (n) => (n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n)))

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
        payee_name: data.payee_name || '',
        zelle_handle: data.zelle_handle || '',
        venmo_handle: data.venmo_handle || '',
        cashapp_handle: data.cashapp_handle || '',
        apple_pay_handle: data.apple_pay_handle || '',
        default_method: data.default_method || '',
        stripe_secret_key: data.stripe_secret_key || '',
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
          Enter your handles once. They show up as check-off options in an invoice's Payment Options, and are
          used by the "send payment request" automation. None of these apps have an API, so you'll still
          confirm and mark the invoice/job paid yourself once the money actually arrives.
        </p>
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
      {saved && <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ Saved</p>}

      <div className={card}>
        <div className="mb-4">
          <label className={label}>Payee name</label>
          <input
            className={input}
            value={form.payee_name}
            onChange={set('payee_name')}
            placeholder="e.g. Shawn Colbert"
          />
          <p className="mt-1 text-[11px] text-muted">
            Shown alongside every handle below on payment-request emails, so a customer paying via Zelle (or
            any other method) can tell it's really you and not confuse it with the company name.
          </p>
        </div>
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

      <div className={card + ' mt-4'}>
        <h2 className="mb-1 text-sm font-semibold text-ink">Stripe (card payments)</h2>
        <p className="mb-3 text-sm text-muted">
          Paste your own Stripe secret key here to add a "Pay with Card" button to your invoices — get it from
          your Stripe Dashboard under Developers → API keys. This is your own Stripe account; money from cards
          paid this way goes straight to you, never routed through anyone else's account. Leave blank and
          invoices just skip the card option.
        </p>
        <label className={label}>Stripe secret key</label>
        <input
          type="password"
          value={form.stripe_secret_key}
          onChange={(e) => { setForm((f) => ({ ...f, stripe_secret_key: e.target.value })); setSaved(false) }}
          placeholder="sk_live_…"
          autoComplete="off"
          className={`${input} max-w-md`}
        />
      </div>

      <WaveCheckoutLinks />
    </div>
  )
}

// Wave has no API to generate a checkout link per invoice, so links are
// created by hand in Wave and saved here once each -- they're reusable
// (meant for a customer to come back to), so a small library beats pasting
// the same URL into every invoice.
function WaveCheckoutLinks() {
  const qc = useQueryClient()
  const { data: links, isLoading } = useQuery({ queryKey: ['waveCheckoutLinks'], queryFn: fetchWaveCheckoutLinks })
  const { data: paymentSettings } = useQuery({ queryKey: ['paymentSettings'], queryFn: fetchPaymentSettings })
  const [form, setForm] = useState({ label: '', amount: '', url: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [dashboardUrl, setDashboardUrl] = useState('')
  const [dashboardSaving, setDashboardSaving] = useState(false)
  const [dashboardSaved, setDashboardSaved] = useState(false)
  useEffect(() => { if (paymentSettings) setDashboardUrl(paymentSettings.wave_dashboard_url || '') }, [paymentSettings])

  async function saveDashboardUrl() {
    setDashboardSaving(true)
    try {
      await savePaymentSettings({ wave_dashboard_url: dashboardUrl.trim() || null })
      qc.invalidateQueries({ queryKey: ['paymentSettings'] })
      setDashboardSaved(true); setTimeout(() => setDashboardSaved(false), 1500)
    } finally {
      setDashboardSaving(false)
    }
  }

  // Wave itself has no way to be linked to directly for "create a checkout"
  // without a business-specific URL, so this is blank until you paste your
  // own Wave payouts/checkout settings page URL below -- until then it
  // falls back to Wave's plain login page.
  const waveOpenUrl = paymentSettings?.wave_dashboard_url || 'https://my.waveapps.com/login'

  async function add() {
    if (!form.label.trim() || !form.url.trim()) { setErr('Label and URL are required.'); return }
    setSaving(true); setErr('')
    try {
      await createWaveCheckoutLink(form)
      setForm({ label: '', amount: '', url: '' })
      qc.invalidateQueries({ queryKey: ['waveCheckoutLinks'] })
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this Wave Checkout link? Invoices that already used it keep working.')) return
    await deleteWaveCheckoutLink(id)
    qc.invalidateQueries({ queryKey: ['waveCheckoutLinks'] })
  }

  return (
    <div className={card + ' mt-4'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Wave Checkout links</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Generate a link in Wave (Wave has no API for this, so it's a manual step), then save it here with
            a label so you can pick it from a dropdown when building an invoice. Add as many as you want.
          </p>
        </div>
        <a href={waveOpenUrl} target="_blank" rel="noreferrer" className={btnAccent + ' shrink-0'}>
          Create a new Wave Checkout ↗
        </a>
      </div>

      <div className="mt-3 rounded-lg border border-line bg-canvas/60 p-3">
        <label className={label}>Your Wave payouts/checkout settings link (optional)</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={input + ' max-w-md'}
            value={dashboardUrl}
            onChange={(e) => { setDashboardUrl(e.target.value); setDashboardSaved(false) }}
            placeholder="https://my.waveapps.com/login/?next=…"
          />
          <button className={btn} disabled={dashboardSaving} onClick={saveDashboardUrl}>
            {dashboardSaving ? 'Saving…' : dashboardSaved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          Paste your own Wave dashboard URL here once so "Create a new Wave Checkout" above jumps straight to
          it instead of Wave's generic login page. Find it by going to Wave → Payments → Payouts and copying
          the address bar.
        </p>
      </div>

      {err && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      {isLoading ? (
        <p className="mt-3 text-sm text-muted">Loading…</p>
      ) : links?.length ? (
        <ul className="mt-3 space-y-2">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas/60 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{l.label}{money(l.amount) ? ` — ${money(l.amount)}` : ''}</p>
                <p className="truncate text-xs text-muted">{l.url}</p>
              </div>
              <button onClick={() => remove(l.id)} className="shrink-0 rounded p-1.5 text-muted hover:bg-red-50 hover:text-red-500" title="Delete">✕</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No Wave Checkout links saved yet.</p>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
        <div>
          <label className={label}>Label</label>
          <input className={input} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Escort - $85" />
        </div>
        <div>
          <label className={label}>Amount (optional)</label>
          <input type="number" min="0" step="0.01" className={input} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="85.00" />
        </div>
        <div>
          <label className={label}>Wave Checkout URL</label>
          <input className={input} value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://link.waveapps.com/…" />
        </div>
        <button className={btn} disabled={saving} onClick={add}>{saving ? 'Adding…' : '+ Add'}</button>
      </div>
    </div>
  )
}
