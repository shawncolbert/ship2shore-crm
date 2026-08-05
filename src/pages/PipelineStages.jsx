import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchMyPipeline, applyStageTemplate, createStage, updateStage,
  setIntakeStage, reorderStages, deleteStage, STAGE_TEMPLATES,
} from '../lib/supabase'

const card = 'rounded-xl border border-line bg-surface p-5'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'

export default function PipelineStages() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['myPipeline'], queryFn: fetchMyPipeline })
  const [err, setErr] = useState('')
  const [applying, setApplying] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['myPipeline'] })

  const runTemplate = async (key) => {
    setApplying(true); setErr('')
    try { await applyStageTemplate(key); refresh() }
    catch (e) { setErr(e.message || String(e)) }
    finally { setApplying(false) }
  }

  const startBlank = async () => {
    setApplying(true); setErr('')
    try { await applyStageTemplate('simple'); refresh() } // simplest path to a valid, editable starting point
    catch (e) { setErr(e.message || String(e)) }
    finally { setApplying(false) }
  }

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading…</div>

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Pipeline Stages</h1>
        <p className="max-w-2xl text-sm text-muted">
          These are the columns on your Pipeline board — name them for how your business actually works.
          One stage is marked "New work lands here" — that's where bookings from your booking sidebar,
          public booking page, and funnels get dropped automatically, whatever you call it.
        </p>
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      {!data?.pipeline ? (
        <div className={card}>
          <h2 className="mb-3 text-sm font-semibold text-ink">Start your pipeline</h2>
          <p className="mb-4 text-sm text-muted">Pick a starting point — everything is fully editable afterward.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(STAGE_TEMPLATES).map(([key, t]) => (
              <button key={key} disabled={applying} onClick={() => runTemplate(key)}
                className="rounded-xl border border-line bg-canvas p-4 text-left hover:border-accent disabled:opacity-50">
                <div className="text-sm font-semibold text-ink">{t.label}</div>
                <div className="mt-1 text-xs text-muted">{t.description}</div>
              </button>
            ))}
          </div>
          <button onClick={startBlank} disabled={applying} className="mt-3 text-xs font-semibold text-accent hover:underline">
            Or start blank
          </button>
        </div>
      ) : (
        <StageList pipeline={data.pipeline} stages={data.stages} onChanged={refresh} setErr={setErr} />
      )}
    </div>
  )
}

function StageList({ pipeline, stages, onChanged, setErr }) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const addStage = async () => {
    if (!newName.trim()) return
    setBusy(true); setErr('')
    try {
      await createStage({ pipelineId: pipeline.id, name: newName, color: '#e8a317' })
      setNewName('')
      onChanged()
    } catch (e) { setErr(e.message || String(e)) }
    finally { setBusy(false) }
  }

  const move = async (index, dir) => {
    const to = index + dir
    if (to < 0 || to >= stages.length) return
    const copy = [...stages]
    ;[copy[index], copy[to]] = [copy[to], copy[index]]
    await reorderStages(copy)
    onChanged()
  }

  const rename = async (id, name) => {
    if (!name.trim()) return
    try { await updateStage(id, { name }); onChanged() }
    catch (e) { setErr(e.message || String(e)) }
  }

  const recolor = async (id, color) => {
    try { await updateStage(id, { color }); onChanged() }
    catch (e) { setErr(e.message || String(e)) }
  }

  const makeIntake = async (id) => {
    try { await setIntakeStage(pipeline.id, id); onChanged() }
    catch (e) { setErr(e.message || String(e)) }
  }

  const remove = async (id, name) => {
    if (!confirm(`Delete "${name}"?`)) return
    try { await deleteStage(id); onChanged() }
    catch (e) { setErr(e.message || String(e)) }
  }

  return (
    <div className={`${card} space-y-2`}>
      {stages.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2 rounded-lg border border-line bg-canvas/60 p-3">
          <div className="flex shrink-0 flex-col gap-0.5">
            <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-line px-1.5 text-xs text-muted hover:border-accent disabled:opacity-30">↑</button>
            <button onClick={() => move(i, 1)} disabled={i === stages.length - 1} className="rounded border border-line px-1.5 text-xs text-muted hover:border-accent disabled:opacity-30">↓</button>
          </div>

          <input type="color" value={s.color || '#6b7f8c'} onChange={(e) => recolor(s.id, e.target.value)}
            className="h-8 w-8 shrink-0 cursor-pointer rounded border border-line bg-canvas" />

          <input
            defaultValue={s.name}
            onBlur={(e) => e.target.value !== s.name && rename(s.id, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
            className={`${input} min-w-0 flex-1`}
          />

          <button
            onClick={() => makeIntake(s.id)}
            title="New work lands here"
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
              s.is_intake ? 'bg-accent text-ink' : 'border border-line text-muted hover:border-accent'
            }`}
          >
            {s.is_intake ? '★ Intake' : 'Set as intake'}
          </button>

          <button onClick={() => remove(s.id, s.name)} className="shrink-0 rounded border border-line px-2 py-1.5 text-xs text-port hover:border-port">✕</button>
        </div>
      ))}

      <div className="flex gap-2 pt-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addStage()}
          placeholder="New stage name"
          className={input}
        />
        <button onClick={addStage} disabled={busy} className={btnAccent}>+ Add</button>
      </div>
    </div>
  )
}
