import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export default function Funnels() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [editingId, setEditingId] = useState(null)

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
            <div>
              <div className="font-medium text-ink">{funnel.name}</div>
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
            <button
              onClick={() => setEditingId(editingId === funnel.id ? null : funnel.id)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent"
            >
              {editingId === funnel.id ? 'Hide' : 'Edit'}
            </button>
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
  const [steps, setSteps] = useState([
    { title: 'Contact Info', description: 'Tell us who you are', fields: ['full_name', 'email', 'phone'] },
    { title: 'Details', description: 'What do you need?', fields: ['service_type', 'budget'] },
  ])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

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
        body: JSON.stringify({ funnelId, name, description, steps }),
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

  return (
    <div className="mb-6 rounded-xl border border-line bg-surface p-5">
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
