import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAllServices, createService, updateService, deleteService } from '../lib/supabase'

const card = 'rounded-xl border border-line bg-surface p-5'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'

const emptyForm = { code: '', name: '', default_rate: '' }

// Slugify a service name into a stable code, e.g. "Portrait Session" -> "portrait_session".
function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export default function Services() {
  const qc = useQueryClient()
  const { data: services, isLoading } = useQuery({ queryKey: ['allServices'], queryFn: fetchAllServices })
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const startEdit = (svc) => {
    setEditingId(svc.id)
    setForm({ code: svc.code, name: svc.name, default_rate: String(svc.default_rate ?? '') })
    setErr('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(emptyForm)
    setErr('')
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setErr('Name is required'); return }
    setBusy(true)
    setErr('')
    try {
      const code = form.code.trim() || slugify(form.name)
      if (editingId) {
        await updateService(editingId, { code, name: form.name, default_rate: form.default_rate })
      } else {
        await createService({ code, name: form.name, default_rate: form.default_rate })
      }
      qc.invalidateQueries({ queryKey: ['allServices'] })
      qc.invalidateQueries({ queryKey: ['services'] })
      cancelEdit()
    } catch (e2) {
      setErr(e2.message || String(e2))
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (svc) => {
    await updateService(svc.id, { active: !svc.active })
    qc.invalidateQueries({ queryKey: ['allServices'] })
    qc.invalidateQueries({ queryKey: ['services'] })
  }

  const remove = async (svc) => {
    if (!confirm(`Delete "${svc.name}"? This can't be undone.`)) return
    try {
      await deleteService(svc.id)
      qc.invalidateQueries({ queryKey: ['allServices'] })
      qc.invalidateQueries({ queryKey: ['services'] })
    } catch (e) {
      alert(e.message || String(e))
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Services</h1>
        <p className="max-w-2xl text-sm text-muted">
          Define what you sell — this is exactly what shows up as the pickable list in the "New Booking" sidebar and
          on your public booking page. Each service is a name and a default price; quantity and the final price are
          adjusted per booking.
        </p>
      </header>

      <div className={`${card} mb-6 max-w-xl`}>
        <h2 className="mb-3 text-sm font-semibold text-ink">{editingId ? 'Edit service' : 'Add a service'}</h2>
        {err && <p className="mb-3 text-xs text-port">{err}</p>}
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className={label}>Name</span>
            <input value={form.name} onChange={set('name')} placeholder="e.g. Portrait Session" className={input} />
          </label>
          <label className="block">
            <span className={label}>Default price (USD)</span>
            <input value={form.default_rate} onChange={set('default_rate')} inputMode="decimal" placeholder="200" className={input} />
          </label>
          <label className="block">
            <span className={label}>Code (optional)</span>
            <input value={form.code} onChange={set('code')} placeholder="auto-generated from name" className={input} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={busy} className={btnAccent}>
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add service'}
            </button>
            {editingId && (
              <button type="button" onClick={cancelEdit} className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-canvas hover:text-ink">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : services?.length === 0 ? (
        <p className="text-sm text-muted">No services yet — add your first one above.</p>
      ) : (
        <div className="max-w-xl space-y-2">
          {services.map((svc) => (
            <div key={svc.id} className={`flex items-center justify-between ${card} !p-3`}>
              <div className={svc.active ? '' : 'opacity-50'}>
                <div className="text-sm font-medium text-ink">{svc.name}</div>
                <div className="text-xs text-muted">
                  ${Number(svc.default_rate || 0).toFixed(0)} · {svc.code}
                  {!svc.active && ' · inactive'}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => toggleActive(svc)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-accent">
                  {svc.active ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => startEdit(svc)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-accent">
                  Edit
                </button>
                <button onClick={() => remove(svc)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-port hover:border-port">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
