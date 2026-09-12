import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchVessels, upsertVessel, deleteVessel } from '../lib/supabase'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const input = 'rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'

// The carrier's "FREE TIME EXP." field on a delivery order is almost always
// left blank -- the real deadline comes later, by phone or email from the
// terminal/carrier. Set it here once per vessel and every open job on that
// vessel (matched by vessel_name, see free-time-alerts.js) gets covered by
// the daily Telegram digest -- no need to type a date onto each job.
const daysLeft = (dateStr) => {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  return Math.round((target - today) / 86400000)
}

function badge(d) {
  if (d == null) return null
  if (d < 0) return { text: `${Math.abs(d)}d past due`, cls: 'bg-red-100 text-port' }
  if (d === 0) return { text: 'Due today', cls: 'bg-red-100 text-port' }
  if (d <= 2) return { text: `${d}d left`, cls: 'bg-accent/20 text-ink' }
  return { text: `${d}d left`, cls: 'bg-canvas text-muted' }
}

export default function Vessels() {
  const qc = useQueryClient()
  const { data: vessels, isLoading } = useQuery({ queryKey: ['vessels'], queryFn: fetchVessels })
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['vessels'] })

  async function addVessel(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true); setErr('')
    try {
      await upsertVessel({ name, lastFreeDay: date || null })
      setName(''); setDate('')
      refresh()
    } catch (e2) {
      setErr(e2.message || String(e2))
    } finally {
      setSaving(false)
    }
  }

  async function updateDate(v, newDate) {
    try { await upsertVessel({ name: v.name, lastFreeDay: newDate || null }); refresh() }
    catch (e) { setErr(e.message || String(e)) }
  }

  async function remove(v) {
    if (!confirm(`Remove ${v.name}? Jobs riding this vessel will stop being covered by the free-time alert.`)) return
    try { await deleteVessel(v.id); refresh() }
    catch (e) { setErr(e.message || String(e)) }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Vessels</h1>
        <p className="max-w-2xl text-sm text-muted">
          Set each vessel's last free day once here — the carrier/terminal rarely fills it in on the
          delivery order itself. Every open job whose vessel matches gets covered by a daily Telegram
          alert starting 2 days out, until its gate pass comes back.
        </p>
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      <form onSubmit={addVessel} className={card + ' mb-6 flex flex-wrap items-end gap-3'}>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Vessel name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ADRIA ACE" className={input + ' w-48'} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Last free day</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </div>
        <button type="submit" disabled={saving || !name.trim()} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50">
          {saving ? 'Saving…' : '+ Add / update'}
        </button>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !vessels?.length ? (
        <div className={card}><p className="text-sm text-muted">No vessels tracked yet — add one above.</p></div>
      ) : (
        <div className="space-y-2">
          {vessels.map((v) => {
            const d = daysLeft(v.last_free_day)
            const b = badge(d)
            return (
              <div key={v.id} className={card + ' flex flex-wrap items-center justify-between gap-3'}>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-ink">{v.name}</span>
                  {b && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.cls}`}>{b.text}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    defaultValue={v.last_free_day || ''}
                    onBlur={(e) => { if (e.target.value !== (v.last_free_day || '')) updateDate(v, e.target.value) }}
                    className={input}
                  />
                  <button onClick={() => remove(v)} className="rounded-md px-2 py-2 text-xs font-medium text-muted hover:text-port">Remove</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
