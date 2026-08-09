import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyExternalCards, createExternalCard, updateExternalCard, deleteExternalCard } from '../lib/externalCards'
import { fetchMyOrgId } from '../lib/supabase'

const card = 'rounded-xl border border-line bg-surface p-5'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'

// Click-tracking for digital business cards you already built and host
// elsewhere -- NOT the in-app card builder (that's Settings -> Business
// Card). Each row here is just a name + the real URL; the trackable /go/
// link counts a click, then bounces straight there.
export default function ExternalCardLinks() {
  const qc = useQueryClient()
  const { data: cards, isLoading } = useQuery({ queryKey: ['externalCards'], queryFn: fetchMyExternalCards })
  const { data: orgId } = useQuery({ queryKey: ['myOrgId'], queryFn: fetchMyOrgId })
  const [showNew, setShowNew] = useState(false)

  const totalClicks = (cards || []).reduce((sum, c) => sum + (c.click_count || 0), 0)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Digital Business Cards</h1>
          <p className="max-w-xl text-sm text-muted">
            Cards you've already built and host elsewhere — this just tracks clicks. Share the trackable link
            instead of the raw URL and every visit gets counted here.
          </p>
        </div>
        <button onClick={() => setShowNew(true)} className={btnAccent}>+ Add a card</button>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">{cards?.length || 0} card{cards?.length === 1 ? '' : 's'} on file · {totalClicks} click{totalClicks === 1 ? '' : 's'} total</p>

          {showNew && (
            <NewCardForm
              onClose={() => setShowNew(false)}
              onSave={async (form) => {
                await createExternalCard({ orgId, ...form })
                qc.invalidateQueries({ queryKey: ['externalCards'] })
                setShowNew(false)
              }}
            />
          )}

          <div className="space-y-3">
            {cards?.length === 0 && !showNew && (
              <p className="text-sm text-muted">No cards yet. Add one to start tracking clicks.</p>
            )}
            {cards?.map((c) => (
              <CardRow
                key={c.id}
                c={c}
                onUpdated={() => qc.invalidateQueries({ queryKey: ['externalCards'] })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function CardRow({ c, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [copyFlag, setCopyFlag] = useState(false)
  const [toggling, setToggling] = useState(false)
  const trackedUrl = `${window.location.origin}/go/${c.slug}`
  const active = c.active !== false

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(trackedUrl); setCopyFlag(true); setTimeout(() => setCopyFlag(false), 1800) }
    catch { /* noop */ }
  }

  const remove = async () => {
    if (!confirm(`Remove ${c.name}? This only removes the tracking link — it does not touch the actual card.`)) return
    await deleteExternalCard(c.id)
    onUpdated()
  }

  const toggleActive = async () => {
    if (active && !confirm(`Turn off ${c.name}'s card? Their booking link will stop accepting new leads and their /go/ link will stop redirecting until you turn it back on.`)) return
    setToggling(true)
    try { await updateExternalCard(c.id, { active: !active }); onUpdated() }
    finally { setToggling(false) }
  }

  if (editing) {
    return (
      <NewCardForm
        initial={c}
        onClose={() => setEditing(false)}
        onSave={async (form) => { await updateExternalCard(c.id, form); onUpdated(); setEditing(false) }}
      />
    )
  }

  return (
    <div className={`${card} flex flex-wrap items-center justify-between gap-3 ${active ? '' : 'opacity-60'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{c.name}</span>
          {!active && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-port">Off</span>
          )}
        </div>
        <a href={c.target_url} target="_blank" rel="noreferrer" className="block truncate text-xs text-muted hover:underline">
          {c.target_url}
        </a>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="font-[family-name:var(--font-mono)] text-muted">{trackedUrl}</span>
          <button onClick={copyLink} className="font-semibold text-accent hover:underline">
            {copyFlag ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="text-center">
          <div className="text-xl font-bold text-ink">{c.click_count ?? 0}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Clicks</div>
        </div>
        <button
          onClick={toggleActive}
          disabled={toggling}
          title={active ? "Turn off this card's booking link and click redirect" : 'Turn this card back on'}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${active ? 'bg-starboard' : 'bg-line'}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
        <button onClick={() => setEditing(true)} className={btn}>Edit</button>
        <button onClick={remove} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-500">🗑️</button>
      </div>
    </div>
  )
}

function NewCardForm({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || '')
  const [targetUrl, setTargetUrl] = useState(initial?.target_url || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    if (!name.trim()) { setErr('Name is required'); return }
    if (!/^https?:\/\//i.test(targetUrl.trim())) { setErr('Enter the full URL, including https://'); return }
    setSaving(true); setErr('')
    try {
      await onSave({ name: name.trim(), target_url: targetUrl.trim() })
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${card} mb-4 space-y-3`}>
      <h2 className="text-sm font-semibold text-ink">{initial ? 'Edit card' : 'Add a card'}</h2>
      {err && <p className="text-xs text-port">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Name (whose card is this)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Tilly's Classics" />
        </label>
        <label className="block">
          <span className={label}>Real card URL</span>
          <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} className={input} placeholder="https://tillysclassics.netlify.app" />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">Cancel</button>
        <button onClick={save} disabled={saving} className={btnAccent}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
