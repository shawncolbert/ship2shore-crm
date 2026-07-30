import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAutomationRules, fetchStageNames, createAutomationRule,
  updateAutomationRule, deleteAutomationRule,
} from '../lib/supabase'

const card = 'rounded-xl border border-line bg-surface p-5'
const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted'

const ACTIONS = [
  { value: 'send_customer_email', label: 'Send customer email' },
  { value: 'notify_internal', label: 'Notify me internally' },
  { value: 'log_only', label: 'Log only' },
]
const actionLabel = (a) => ACTIONS.find((x) => x.value === a)?.label || a

export default function Automations() {
  const qc = useQueryClient()
  const { data: rules, isLoading } = useQuery({ queryKey: ['automationRules'], queryFn: fetchAutomationRules })
  const { data: stages } = useQuery({ queryKey: ['stageNames'], queryFn: fetchStageNames })
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['automationRules'] })
  const stageList = stages || []

  async function addRule() {
    setErr('')
    try {
      await createAutomationRule({
        to_stage: stageList[0] || 'Scheduled',
        action: 'log_only',
        enabled: true,
        position: (rules?.length || 0),
      })
      refresh(); setAdding(false)
    } catch (e) { setErr(e.message || String(e)) }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Automations</h1>
          <p className="max-w-2xl text-sm text-muted">
            Run an action automatically when a job moves into a stage. Changes take effect immediately —
            no code needed. Email templates support variables like <code>{'{{first_name}}'}</code>,{' '}
            <code>{'{{scheduled_at}}'}</code>, <code>{'{{title}}'}</code>, <code>{'{{port}}'}</code>.
          </p>
        </div>
        <button className={btnAccent} disabled={adding} onClick={() => { setAdding(true); addRule() }}>+ New rule</button>
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !rules || rules.length === 0 ? (
        <div className={card}><p className="text-sm text-muted">No rules yet. Add one to automate a stage change.</p></div>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <RuleRow key={r.id} rule={r} stages={stageList} onChanged={refresh} onError={setErr} />
          ))}
        </div>
      )}
    </div>
  )
}

function RuleRow({ rule, stages, onChanged, onError }) {
  const [draft, setDraft] = useState(rule)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule)
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))

  async function save() {
    setSaving(true); onError('')
    try {
      await updateAutomationRule(rule.id, {
        from_stage: draft.from_stage || null,
        to_stage: draft.to_stage,
        action: draft.action,
        email_subject: draft.email_subject || null,
        email_body: draft.email_body || null,
        enabled: draft.enabled,
      })
      setSavedAt(Date.now()); onChanged()
    } catch (e) { onError(e.message || String(e)) }
    finally { setSaving(false) }
  }

  async function toggleEnabled() {
    set('enabled', !draft.enabled)
    try { await updateAutomationRule(rule.id, { enabled: !draft.enabled }); onChanged() }
    catch (e) { onError(e.message || String(e)); set('enabled', draft.enabled) }
  }

  async function remove() {
    if (!confirm('Delete this automation rule?')) return
    try { await deleteAutomationRule(rule.id); onChanged() }
    catch (e) { onError(e.message || String(e)) }
  }

  return (
    <div className={`${card} ${draft.enabled ? '' : 'opacity-60'}`}>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className={label}>When stage moves from</label>
          <select className={input} value={draft.from_stage || ''} onChange={(e) => set('from_stage', e.target.value || null)}>
            <option value="">Any stage</option>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Into stage</label>
          <select className={input} value={draft.to_stage} onChange={(e) => set('to_stage', e.target.value)}>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Then</label>
          <select className={input} value={draft.action} onChange={(e) => set('action', e.target.value)}>
            {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <div className="flex items-end justify-between gap-2">
          <button type="button" onClick={toggleEnabled}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${draft.enabled ? 'bg-starboard/15 text-starboard' : 'bg-canvas text-muted'}`}>
            {draft.enabled ? 'On' : 'Off'}
          </button>
          <button className={btn + ' text-port'} onClick={remove}>Delete</button>
        </div>
      </div>

      {draft.action === 'send_customer_email' && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div>
            <label className={label}>Email subject</label>
            <input className={input} value={draft.email_subject || ''} onChange={(e) => set('email_subject', e.target.value)}
              placeholder="Your Ship2Shore pickup is scheduled" />
          </div>
          <div>
            <label className={label}>Email message</label>
            <textarea className={input + ' font-[family-name:var(--font-mono)]'} rows={6}
              value={draft.email_body || ''} onChange={(e) => set('email_body', e.target.value)}
              placeholder={'Hi {{first_name}},\n\nYour booking is scheduled for {{scheduled_at}}.'} />
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button className={btnAccent} disabled={saving || !dirty} onClick={save}>
          {saving ? 'Saving…' : dirty ? 'Save' : (Date.now() - savedAt < 2500 ? 'Saved ✓' : 'Saved')}
        </button>
        {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
      </div>
    </div>
  )
}
