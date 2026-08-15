import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { PUBLIC_THEMES } from '../lib/publicThemes'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export default function Funnels() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [publishing, setPublishing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const { data: funnels, isLoading } = useQuery({
    queryKey: ['funnels'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/funnels-list', {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      })
      const json_data = await res.json()
      if (!res.ok) throw new Error(json_data.error || 'Failed to fetch funnels')
      return json_data.funnels || []
    },
  })

  const handlePublish = async (funnel) => {
    setPublishing(funnel.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/funnels-publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ funnelId: funnel.id, published: !funnel.published }),
      })
      if (res.ok) qc.invalidateQueries({ queryKey: ['funnels'] })
    } finally {
      setPublishing(null)
    }
  }

  const handleDelete = async (funnel) => {
    if (!window.confirm(`Delete "${funnel.name}"? Its steps and any submitted leads go with it. This can't be undone.`)) return
    setDeleting(funnel.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/funnels-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ funnelId: funnel.id }),
      })
      if (res.ok) qc.invalidateQueries({ queryKey: ['funnels'] })
    } finally {
      setDeleting(null)
    }
  }

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading…</div>

  return (
    <div className="flex h-full flex-col p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
            Funnels
          </h1>
          <p className="text-sm text-muted">Create multi-step forms that convert visitors into contacts.</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600"
        >
          New funnel
        </button>
      </header>

      {showNew && <FunnelEditor onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['funnels'] }) }} />}

      <div className="space-y-3">
        {funnels?.length === 0 && <p className="text-sm text-muted">No funnels yet. Create one to get started.</p>}
        {funnels?.map((funnel) => (
          <div key={funnel.id} className="flex items-center justify-between rounded-lg border border-line bg-surface p-4">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 font-medium text-ink">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PUBLIC_THEMES.find((t) => t.key === funnel.theme)?.accent || PUBLIC_THEMES[0].accent }} />
                {funnel.name}
              </div>
              {funnel.description && <div className="mt-0.5 text-xs text-muted">{funnel.description}</div>}
              <div className="mt-1.5 flex gap-3">
                {funnel.published && (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent ring-1 ring-inset ring-accent/40">
                      ✓ Published
                    </span>
                    <span className="text-xs text-muted font-mono">
                      {window.location.origin}/funnel/{funnel.slug}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handlePublish(funnel)}
                disabled={publishing === funnel.id}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent disabled:opacity-50"
              >
                {funnel.published ? 'Unpublish' : 'Publish'}
              </button>
              <button
                onClick={() => setEditingId(editingId === funnel.id ? null : funnel.id)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent"
              >
                {editingId === funnel.id ? 'Hide' : 'Edit'}
              </button>
              <button
                onClick={() => handleDelete(funnel)}
                disabled={deleting === funnel.id}
                title="Delete funnel"
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-red-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingId && <FunnelEditor funnelId={editingId} onClose={() => setEditingId(null)} onSaved={() => { setEditingId(null); qc.invalidateQueries({ queryKey: ['funnels'] }) }} />}
    </div>
  )
}

function FunnelEditor({ funnelId, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [theme, setTheme] = useState('classic')
  const [steps, setSteps] = useState([
    { title: 'Contact Info', description: 'Tell us who you are', fields: ['full_name', 'email', 'phone'] },
    { title: 'Details', description: 'What do you need?', fields: ['service_type', 'budget'] },
  ])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [prefilling, setPrefilling] = useState(!!funnelId)

  // Loads the funnel's current name/description/theme/steps for editing --
  // without this, saving an existing funnel silently overwrote it with the
  // blank "new funnel" defaults above, wiping whatever theme/steps it had.
  useEffect(() => {
    if (!funnelId) { setPrefilling(false); return }
    let cancelled = false
    ;(async () => {
      const { data: funnel, error: fErr } = await supabase
        .from('funnels').select('name, description, theme').eq('id', funnelId).maybeSingle()
      const { data: funnelSteps, error: sErr } = await supabase
        .from('funnel_steps').select('title, description, fields').eq('funnel_id', funnelId).order('step_number', { ascending: true })
      if (cancelled) return
      if (fErr || sErr || !funnel) { setErr((fErr || sErr)?.message || 'Could not load this funnel.'); setPrefilling(false); return }
      setName(funnel.name || '')
      setDescription(funnel.description || '')
      setTheme(funnel.theme || 'classic')
      if (funnelSteps?.length) setSteps(funnelSteps)
      setPrefilling(false)
    })()
    return () => { cancelled = true }
  }, [funnelId])

  const handleSave = async () => {
    if (!name.trim()) { setErr('Funnel name is required'); return }
    if (steps.length < 2) { setErr('At least 2 steps required'); return }

    setLoading(true)
    setErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/funnels-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ funnelId, name, description, steps, theme }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save funnel')
      onSaved()
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  const addStep = () => setSteps([...steps, { title: `Step ${steps.length + 1}`, description: '', fields: [] }])
  const removeStep = (i) => setSteps(steps.filter((_, idx) => idx !== i))

  if (prefilling) {
    return (
      <div className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <p className="text-sm text-muted">Loading funnel…</p>
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 text-sm font-semibold text-ink">
        {funnelId ? 'Edit Funnel' : 'New Funnel'}
      </h2>
      {err && <p className="mb-3 text-xs text-port">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          placeholder="Funnel name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="mt-3">
        <h3 className="mb-1.5 text-xs font-semibold text-ink">Accent color</h3>
        <div className="flex flex-wrap gap-1.5">
          {PUBLIC_THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTheme(t.key)}
              title={t.label}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                theme === t.key ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-canvas text-muted hover:text-ink'
              }`}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: t.accent }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <h3 className="text-xs font-semibold text-ink">Steps ({steps.length})</h3>
        {steps.map((step, i) => (
          <div key={i} className="rounded-lg bg-canvas/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Step title"
                  value={step.title}
                  onChange={(e) => { const s = [...steps]; s[i].title = e.target.value; setSteps(s) }}
                  className="mb-1 w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-accent"
                />
                <input
                  type="text"
                  placeholder="Step description"
                  value={step.description}
                  onChange={(e) => { const s = [...steps]; s[i].description = e.target.value; setSteps(s) }}
                  className="w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-accent"
                />
              </div>
              <button
                onClick={() => removeStep(i)}
                disabled={steps.length <= 2}
                className="rounded px-2 py-1 text-xs text-port hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={addStep}
          disabled={steps.length >= 4}
          className="text-xs text-accent hover:underline disabled:opacity-50"
        >
          + Add step
        </button>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={loading}
          className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Save funnel'}
        </button>
      </div>
    </div>
  )
}
