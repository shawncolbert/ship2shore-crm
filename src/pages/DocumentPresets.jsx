import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDocumentPresets, createDocumentPreset, updateDocumentPreset, deleteDocumentPreset } from '../lib/documentPresets'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] space-y-3'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'

export default function DocumentPresets() {
  const qc = useQueryClient()
  const { data: presets, isLoading } = useQuery({ queryKey: ['documentPresets'], queryFn: fetchDocumentPresets })
  const [adding, setAdding] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['documentPresets'] })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Document Requests</h1>
          <p className="max-w-xl text-sm text-muted">
            These are the options that show up when someone clicks "Request a Document" on a contact —
            each one is a starting subject and message, both still editable before sending. Set these up
            for whatever your business actually asks customers for; nothing here is fixed.
          </p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className={btnAccent}>+ Add a preset</button>
        )}
      </header>

      {adding && (
        <PresetForm
          nextPosition={(presets?.length || 0)}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); refresh() }}
        />
      )}

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {!isLoading && presets?.length === 0 && !adding && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line p-10 text-center">
          <p className="text-sm font-medium text-ink">No presets yet</p>
          <p className="mt-1 text-sm text-muted">Add one so "Request a Document" has something to offer.</p>
        </div>
      )}

      <div className="space-y-3">
        {presets?.map((p) => <PresetRow key={p.id} p={p} onChanged={refresh} />)}
      </div>
    </div>
  )
}

function PresetForm({ initial, nextPosition, onClose, onSaved }) {
  const [label_, setLabel] = useState(initial?.label || '')
  const [subject, setSubject] = useState(initial?.subject || '')
  const [bodyTemplate, setBodyTemplate] = useState(initial?.body_template || 'Hi {{first_name}},\n\n')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setSaving(true); setErr('')
    try {
      if (initial) await updateDocumentPreset(initial.id, { label: label_, subject, bodyTemplate })
      else await createDocumentPreset({ label: label_, subject, bodyTemplate, position: nextPosition })
      onSaved()
    } catch (e) {
      setErr(e.message || 'Could not save this preset.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${card} mb-4`}>
      <label className="block">
        <span className={label}>Name</span>
        <input value={label_} onChange={(e) => setLabel(e.target.value)} placeholder="Supporting Documents" className={input} />
      </label>
      <label className="block">
        <span className={label}>Email subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Supporting Documents Needed" className={input} />
      </label>
      <label className="block">
        <span className={label}>Message ({'{{first_name}}'} fills in the contact's first name)</span>
        <textarea value={bodyTemplate} onChange={(e) => setBodyTemplate(e.target.value)} rows={4} className={input} />
      </label>
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} disabled={saving} className={btn}>Cancel</button>
        <button onClick={save} disabled={saving} className={btnAccent}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

function PresetRow({ p, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    if (!confirm(`Remove the "${p.label}" preset?`)) return
    setDeleting(true)
    try { await deleteDocumentPreset(p.id); onChanged() }
    finally { setDeleting(false) }
  }

  if (editing) {
    return <PresetForm initial={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} />
  }

  return (
    <div className={`${card} flex flex-row items-start justify-between gap-3`}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{p.label}</p>
        <p className="text-xs text-muted">{p.subject}</p>
        <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{p.body_template}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => setEditing(true)} className={btn}>Edit</button>
        <button onClick={remove} disabled={deleting} className={`${btn} text-port`}>{deleting ? 'Removing…' : 'Remove'}</button>
      </div>
    </div>
  )
}
