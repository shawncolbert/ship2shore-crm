import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyOrg, fetchMyOrgId, fetchLandingPages, updateLandingPage, fetchDispatcherContacts } from '../lib/supabase'
import { fetchDispatchRotationCandidates, addToDispatchRotation, removeFromDispatchRotation, saveAutoAssignLeads } from '../lib/dispatchRotation'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'

export default function DispatchAssignment() {
  const qc = useQueryClient()
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg })
  const { data: candidates, isLoading } = useQuery({ queryKey: ['dispatchRotationCandidates'], queryFn: fetchDispatchRotationCandidates })
  const [savingAuto, setSavingAuto] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['dispatchRotationCandidates'] })

  const toggleAutoAssign = async () => {
    setSavingAuto(true)
    try {
      const orgId = await fetchMyOrgId()
      await saveAutoAssignLeads(orgId, !org.auto_assign_leads)
      qc.invalidateQueries({ queryKey: ['myOrg'] })
    } finally {
      setSavingAuto(false)
    }
  }

  const inRotationCount = candidates?.filter((d) => d.inRotation).length || 0

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Dispatch Assignment</h1>
        <p className="max-w-xl text-sm text-muted">
          Pick which dispatchers can receive leads, and whether new leads from your booking funnel get
          handed to them automatically or wait for you to assign them by hand on Pipeline.
        </p>
      </header>

      <div className={`${card} mb-4 flex items-center justify-between gap-3`}>
        <div>
          <p className="text-sm font-semibold text-ink">Auto-assign new funnel leads</p>
          <p className="text-xs text-muted">
            {org?.auto_assign_leads
              ? 'On — new leads round-robin across everyone marked "in rotation" below and get emailed automatically.'
              : 'Off — new leads land unassigned on Pipeline; you pick who gets each one.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!org?.auto_assign_leads}
          onClick={toggleAutoAssign}
          disabled={savingAuto || !org}
          className="shrink-0"
        >
          <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${org?.auto_assign_leads ? 'bg-accent' : 'bg-slate-300'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${org?.auto_assign_leads ? 'translate-x-6' : 'translate-x-1'}`} />
          </span>
        </button>
      </div>

      <div className={card}>
        <h2 className="mb-1 text-sm font-semibold text-ink">Dispatchers</h2>
        <p className="mb-4 text-xs text-muted">
          These are your contacts tagged as dispatchers. Check the ones who should be in the auto-assign
          rotation — {inRotationCount === 0 ? "none marked yet" : `${inRotationCount} marked`}. Anyone
          left unchecked can still be assigned to a job by hand on Pipeline, just not automatically.
        </p>

        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {!isLoading && candidates?.length === 0 && (
          <p className="text-sm text-muted">No contacts tagged as dispatchers yet. Set a contact's segment to "Dispatcher" on their contact page to see them here.</p>
        )}

        <div className="space-y-2">
          {candidates?.map((d) => (
            <DispatcherRow key={d.id} dispatcher={d} onChanged={refresh} />
          ))}
        </div>
      </div>

      <div className={`${card} mt-4`}>
        <h2 className="mb-1 text-sm font-semibold text-ink">Landing pages</h2>
        <p className="mb-4 text-xs text-muted">
          Point a specific page's leads straight at one dispatcher instead of the round-robin above --
          TWIC/Hotshot/Semi-Container/Military leads still always go to you regardless of what's set here.
        </p>
        <LandingPageRouting />
      </div>
    </div>
  )
}

function LandingPageRouting() {
  const qc = useQueryClient()
  const { data: pages, isLoading } = useQuery({ queryKey: ['landingPages'], queryFn: fetchLandingPages })
  const { data: dispatchers } = useQuery({ queryKey: ['dispatcherContacts'], queryFn: fetchDispatcherContacts })
  const [savingId, setSavingId] = useState(null)

  const setDispatcher = async (pageId, dispatcherId) => {
    setSavingId(pageId)
    try {
      await updateLandingPage(pageId, { default_dispatcher_id: dispatcherId || null })
      qc.invalidateQueries({ queryKey: ['landingPages'] })
    } finally {
      setSavingId(null)
    }
  }

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>
  if (!pages?.length) return <p className="text-sm text-muted">No landing pages yet.</p>

  return (
    <div className="space-y-2">
      {pages.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas/50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{p.title || p.slug}</p>
            <p className="truncate text-xs text-muted">/{p.slug}</p>
          </div>
          <select
            value={p.default_dispatcher_id || ''}
            onChange={(e) => setDispatcher(p.id, e.target.value)}
            disabled={savingId === p.id}
            className="shrink-0 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink"
          >
            <option value="">Round robin (default)</option>
            {dispatchers?.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name || d.company}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

function DispatcherRow({ dispatcher, onChanged }) {
  const [saving, setSaving] = useState(false)

  const toggle = async () => {
    setSaving(true)
    try {
      if (dispatcher.inRotation) {
        await removeFromDispatchRotation(dispatcher.id)
      } else {
        const orgId = await fetchMyOrgId()
        await addToDispatchRotation(orgId, dispatcher.id)
      }
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className="flex items-center gap-3 rounded-lg border border-line bg-canvas/50 px-3 py-2 hover:border-accent">
      <input
        type="checkbox"
        checked={dispatcher.inRotation}
        onChange={toggle}
        disabled={saving}
        className="h-4 w-4 rounded border-line text-accent focus:ring-accent"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{dispatcher.full_name || dispatcher.company}</p>
        <p className="truncate text-xs text-muted">{dispatcher.company && dispatcher.full_name ? `${dispatcher.company} · ` : ''}{dispatcher.email || 'No email on file'}</p>
      </div>
      {dispatcher.inRotation && (
        <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-ink ring-1 ring-inset ring-accent/40">In rotation</span>
      )}
    </label>
  )
}
