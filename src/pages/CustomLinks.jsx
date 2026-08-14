import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchCustomLinks, createCustomLink, updateCustomLink, deleteCustomLink } from '../lib/customLinks'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] space-y-3'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'

export default function CustomLinks() {
  const qc = useQueryClient()
  const { data: links, isLoading } = useQuery({ queryKey: ['customLinks'], queryFn: fetchCustomLinks })
  const [adding, setAdding] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['customLinks'] })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Custom Links</h1>
          <p className="max-w-xl text-sm text-muted">
            Add a shortcut to an outside site you use alongside this CRM — a video editor, your listings
            site, whatever the case may be. Each one shows up as its own link near Help in the sidebar and
            opens in a new tab.
          </p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className={btnAccent}>+ Add a link</button>
        )}
      </header>

      {adding && <LinkForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh() }} />}

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {!isLoading && links?.length === 0 && !adding && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line p-10 text-center">
          <p className="text-sm font-medium text-ink">No custom links yet</p>
          <p className="mt-1 text-sm text-muted">Add one to put an outside site a tap away from your sidebar.</p>
        </div>
      )}

      <div className="space-y-3">
        {links?.map((l) => <LinkRow key={l.id} l={l} onChanged={refresh} />)}
      </div>
    </div>
  )
}

function LinkForm({ initial, onClose, onSaved }) {
  const [label_, setLabel] = useState(initial?.label || '')
  const [url, setUrl] = useState(initial?.url || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setSaving(true); setErr('')
    try {
      if (initial) await updateCustomLink(initial.id, { label: label_, url })
      else await createCustomLink({ label: label_, url })
      onSaved()
    } catch (e) {
      setErr(e.message || 'Could not save this link.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${card} mb-4`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Name</span>
          <input value={label_} onChange={(e) => setLabel(e.target.value)} placeholder="Video Editor" className={input} />
        </label>
        <label className="block">
          <span className={label}>URL</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={input} />
        </label>
      </div>
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} disabled={saving} className={btn}>Cancel</button>
        <button onClick={save} disabled={saving} className={btnAccent}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

function LinkRow({ l, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    if (!confirm(`Remove "${l.label}" from your sidebar?`)) return
    setDeleting(true)
    try { await deleteCustomLink(l.id); onChanged() }
    finally { setDeleting(false) }
  }

  if (editing) {
    return <LinkForm initial={l} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} />
  }

  return (
    <div className={`${card} flex flex-row items-center justify-between gap-3`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">{l.label}</p>
        <a href={l.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-accent hover:underline">{l.url}</a>
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => setEditing(true)} className={btn}>Edit</button>
        <button onClick={remove} disabled={deleting} className={`${btn} text-port`}>{deleting ? 'Removing…' : 'Remove'}</button>
      </div>
    </div>
  )
}
