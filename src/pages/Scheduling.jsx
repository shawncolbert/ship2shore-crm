import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyOrg, saveOrgCalendlyUrl } from '../lib/supabase'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] space-y-3'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'

export default function Scheduling() {
  const qc = useQueryClient()
  const { data: org, isLoading } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg })
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (org) setUrl(org.calendly_url || '')
  }, [org])

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false)
    try {
      await saveOrgCalendlyUrl(url)
      qc.invalidateQueries({ queryKey: ['myOrg'] })
      setSaved(true)
    } catch (e) {
      setErr(e.message || 'Could not save this link.')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading…</div>

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Scheduling</h1>
        <p className="max-w-xl text-sm text-muted">
          Your own Calendly link, used by the "Book" button and the embedded scheduler on every contact's
          page. This is org-wide — each organization sharing this system has its own, so a contact's Book
          button always opens your calendar, never anyone else's.
        </p>
      </header>

      <div className={card}>
        <label className="block">
          <span className={label}>Calendly link</span>
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setSaved(false) }}
            placeholder="https://calendly.com/your-username"
            className={input}
          />
          <p className="mt-1 text-xs text-muted">
            Find yours at calendly.com under Event Types — copy the link for the event you want customers
            booking. Leave this blank to hide the Book button and scheduler until you're ready.
          </p>
        </label>
        {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
        {saved && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ Saved</p>}
        <button onClick={save} disabled={saving} className={btnAccent}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
