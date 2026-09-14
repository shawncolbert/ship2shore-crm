import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchOrgs, createOrg, inviteUser, fetchOrgStats, setOrgFeature, removeMember, fetchFeaturePricing, setFeaturePrice, fetchReminderRules, saveReminderRule, deleteReminderRule } from '../lib/admin'
import { fetchMyProfile } from '../lib/supabase'
import { FEATURES, isFeatureEnabled } from '../lib/features'

const ROLES = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'agent', label: 'Agent' },
  { value: 'viewer', label: 'Viewer' },
]

export default function AdminOrgs() {
  const qc = useQueryClient()
  const { data: profile, isLoading: profileLoading } = useQuery({ queryKey: ['myProfile'], queryFn: fetchMyProfile })
  const { data: orgs, isLoading, error } = useQuery({
    queryKey: ['adminOrgs'],
    queryFn: fetchOrgs,
    enabled: !!profile?.platform_admin,
  })
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['adminOrgStats'],
    queryFn: fetchOrgStats,
    enabled: !!profile?.platform_admin,
  })

  const [showNewOrg, setShowNewOrg] = useState(false)
  const [inviteFor, setInviteFor] = useState(null) // org id currently showing an invite form
  const [featuresFor, setFeaturesFor] = useState(null) // org id currently showing its feature toggles
  const [remindersFor, setRemindersFor] = useState(null) // org id currently showing its reminder rules

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['adminOrgs'] })
    qc.invalidateQueries({ queryKey: ['adminOrgStats'] })
  }

  if (profileLoading) return <div className="p-8 text-sm text-muted">Loading…</div>
  if (!profile?.platform_admin) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted">You don't have access to this page.</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
            Organizations
          </h1>
          <p className="text-sm text-muted">
            Platform-admin only. Create a new client org and invite its users — each org only ever sees its own data.
          </p>
        </div>
        <button
          onClick={() => setShowNewOrg(true)}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600"
        >
          New organization
        </button>
      </header>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-port">Couldn't load organizations.</p>}

      {showNewOrg && (
        <NewOrgForm onClose={() => setShowNewOrg(false)} onCreated={invalidate} />
      )}

      {statsLoading && <p className="text-sm text-muted">Loading stats…</p>}

      <div className="space-y-4">
        {orgs?.map((org) => {
          const orgStat = stats?.find((s) => s.orgId === org.id)
          const createdDate = orgStat?.createdAt ? new Date(orgStat.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
          return (
            <div key={org.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-semibold text-ink">{org.name}</div>
                  <div className="mt-1 text-xs text-muted">
                    {[org.slug, org.custom_domain].filter(Boolean).join(' · ') || 'No slug or custom domain set'}
                  </div>
                  <div className="mt-2 grid gap-4 sm:grid-cols-3">
                    <div className="rounded-lg bg-canvas/50 px-3 py-2">
                      <div className="text-xs font-medium text-muted">Created</div>
                      <div className="text-sm font-semibold text-ink">{createdDate}</div>
                    </div>
                    <div className="rounded-lg bg-canvas/50 px-3 py-2">
                      <div className="text-xs font-medium text-muted">Contacts</div>
                      <div className="text-sm font-semibold text-ink">{orgStat?.contactCount || 0}</div>
                    </div>
                    <div className="rounded-lg bg-canvas/50 px-3 py-2">
                      <div className="text-xs font-medium text-muted">Open Opportunities</div>
                      <div className="text-sm font-semibold text-ink">{orgStat?.openOpportunitiesCount || 0}</div>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => setFeaturesFor(featuresFor === org.id ? null : org.id)}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent"
                  >
                    System Controls
                  </button>
                  <button
                    onClick={() => setRemindersFor(remindersFor === org.id ? null : org.id)}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent"
                  >
                    Reminder Rules
                  </button>
                  <button
                    onClick={() => setInviteFor(inviteFor === org.id ? null : org.id)}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent"
                  >
                    Invite user
                  </button>
                </div>
              </div>

              {featuresFor === org.id && (
                <SystemControlsPanel org={org} onChanged={invalidate} />
              )}

              {remindersFor === org.id && (
                <ReminderRulesPanel org={org} />
              )}

            <div className="mt-3 space-y-1">
              {org.members?.length === 0 && <p className="text-xs text-muted">No members yet.</p>}
              {org.members?.map((m, i) => (
                <MemberRow key={i} orgId={org.id} member={m} onRemoved={invalidate} />
              ))}
            </div>

              {inviteFor === org.id && (
                <InviteForm orgId={org.id} onClose={() => setInviteFor(null)} onInvited={invalidate} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Removes this one person from this one org -- their account and any other
// org they belong to are untouched. Deliberately no "delete organization"
// action anywhere on this page: that would cascade-delete a live client's
// entire CRM (contacts, jobs, invoices, everything), and that blast radius
// is too severe to expose as a click-through button.
function MemberRow({ orgId, member, onRemoved }) {
  const [removing, setRemoving] = useState(false)

  const handleRemove = async () => {
    if (!member.profileId) return
    if (!window.confirm(`Remove ${member.fullName || member.email} from this org? Their account itself isn't deleted.`)) return
    setRemoving(true)
    try {
      await removeMember({ orgId, profileId: member.profileId })
      onRemoved()
    } catch (e) {
      alert(e.message || 'Could not remove this member.')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-ink">{member.fullName || member.email}</span>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-canvas px-2 py-0.5 font-medium uppercase tracking-wide text-muted ring-1 ring-inset ring-line">
          {member.role}
        </span>
        <button
          onClick={handleRemove}
          disabled={removing || !member.profileId}
          title="Remove from this org"
          className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// Starting-point monthly prices for add-on features, based on comparable
// SaaS pricing (general CRMs, dispatch/TMS tools, and all-in-one
// white-label platforms like GoHighLevel this business model resembles
// most closely) -- a real number to start from, not a rule. Anything
// bundled into every plan (contacts, pipeline, calendar, etc.) has no
// suggested price since it's never sold separately. Purely a UI default:
// typing over it and saving is what actually sets a client's real price.
const SUGGESTED_PRICES = {
  ai_assistant: 40,
  social_posts: 55,
  seo_analytics: 32,
  landing_pages: 27,
  funnels: 27,
  lead_finder: 40,
  digital_business_cards: 20,
  business_card_builder: 20,
  document_requests: 12,
  gate_pass: 20,
  vessels: 57,
  outreach: 55,
}

// Which sidebar items this org sees (one switch per feature) plus what
// Shawn is charging them for each one, and whether that charge is actually
// active right now -- his own pricing sheet, never shown to the client
// themselves (feature_pricing has its own platform-admin-only RLS policy,
// same gate as this whole page). A missing enabled_features key means "on"
// -- see isFeatureEnabled -- so a brand-new org with an empty
// enabled_features starts with everything visible. Toggle, price, billing,
// and free-until changes all stay in local draft state until Save is
// clicked, so editing anything is instant (no network round-trip to wait
// on) and a batch of changes commits together.
function SystemControlsPanel({ org, onChanged }) {
  const { data: pricing } = useQuery({
    queryKey: ['featurePricing', org.id], queryFn: () => fetchFeaturePricing(org.id),
  })
  const [enabledDraft, setEnabledDraft] = useState(() => ({ ...(org.enabled_features || {}) }))
  const [priceDraft, setPriceDraft] = useState({})
  const [billingDraft, setBillingDraft] = useState({})
  const [freeUntilDraft, setFreeUntilDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  // Every draft map starts empty (meaning "use the saved value") until
  // someone actually edits that field -- avoids needing to re-sync draft
  // state against an async query that may resolve after this panel
  // mounted, and keeps an untouched suggested-price hint from ever being
  // mistaken for a real saved value.
  const savedPrice = (key) => pricing?.[key]?.price ?? null
  const savedBilling = (key) => pricing?.[key]?.billingActive ?? true
  const savedFreeUntil = (key) => pricing?.[key]?.freeUntil ?? null

  // Shown in the box even before anyone's touched it, so there's a real
  // number to start from -- but purely visual until Save actually commits
  // something, per dirty-detection below.
  const priceFor = (key) => (key in priceDraft ? priceDraft[key] : (savedPrice(key) ?? SUGGESTED_PRICES[key] ?? ''))
  const setPrice = (key, value) => { setPriceDraft((d) => ({ ...d, [key]: value })); setSaved(false) }

  const billingFor = (key) => (key in billingDraft ? billingDraft[key] : savedBilling(key))
  const setBilling = (key, value) => { setBillingDraft((d) => ({ ...d, [key]: value })); setSaved(false) }

  const freeUntilFor = (key) => (key in freeUntilDraft ? freeUntilDraft[key] : (savedFreeUntil(key) || ''))
  const setFreeUntil = (key, value) => { setFreeUntilDraft((d) => ({ ...d, [key]: value })); setSaved(false) }

  const isOn = (key) => enabledDraft[key] !== false
  const toggle = (key) => {
    setEnabledDraft((d) => ({ ...d, [key]: !isOn(key) }))
    setSaved(false)
  }

  // Only the keys that actually differ from what's saved need a write.
  const dirtyToggleKeys = FEATURES.map((f) => f.key).filter((key) => isOn(key) !== isFeatureEnabled(org, key))
  const billingRowDirty = (key) => {
    const priceDirty = key in priceDraft && (priceDraft[key].trim() === '' ? null : Number(priceDraft[key])) !== savedPrice(key)
    const billingDirty = key in billingDraft && billingDraft[key] !== savedBilling(key)
    const freeUntilDirty = key in freeUntilDraft && (freeUntilDraft[key] || null) !== savedFreeUntil(key)
    return priceDirty || billingDirty || freeUntilDirty
  }
  const dirtyBillingKeys = FEATURES.map((f) => f.key).filter(billingRowDirty)

  const save = async () => {
    setSaving(true); setErr('')
    try {
      for (const key of dirtyToggleKeys) {
        await setOrgFeature({ orgId: org.id, featureKey: key, enabled: isOn(key) })
      }
      for (const key of dirtyBillingKeys) {
        const priceTrimmed = key in priceDraft ? priceDraft[key].trim() : null
        const price = key in priceDraft ? (priceTrimmed === '' ? null : Number(priceTrimmed)) : savedPrice(key)
        await setFeaturePrice({
          orgId: org.id, featureKey: key, price,
          billingActive: billingFor(key),
          freeUntil: freeUntilFor(key) || null,
        })
      }
      onChanged()
      setPriceDraft({}); setBillingDraft({}); setFreeUntilDraft({})
      setSaved(true)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const dirtyCount = dirtyToggleKeys.length + dirtyBillingKeys.length

  return (
    <div className="mt-4 rounded-lg border border-line bg-canvas p-4">
      <p className="mb-3 text-xs text-muted">
        <b className="text-ink">System Controls</b> — what {org.name} sees in their sidebar, and what you're
        charging them per feature. The feature switch controls whether they can use it at all; <b>Billing</b>
        controls whether it's actually a paid charge right now — flip Billing off (and optionally set a
        free-until date as your own reminder) to comp a feature or run a free trial without touching whether
        they can use it. None of this is shown to the client or bills them automatically — it's your own
        reference sheet. Flip/type whatever you need, then hit Save.
      </p>
      {err && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-port">⚠️ {err}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {FEATURES.map((f) => {
          const on = isOn(f.key)
          const billing = billingFor(f.key)
          return (
            <div key={f.key} className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => toggle(f.key)} className="flex flex-1 items-center gap-2 text-left">
                  <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-starboard' : 'bg-line'}`}>
                    <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
                  </span>
                  <span className="truncate">{f.label}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1 text-muted">
                  <span>$</span>
                  <input
                    value={priceFor(f.key)}
                    onChange={(e) => setPrice(f.key, e.target.value)}
                    placeholder="—"
                    inputMode="decimal"
                    className="w-14 rounded border border-line bg-canvas px-1.5 py-1 text-right text-xs text-ink outline-none focus:border-accent"
                  />
                  <span>/mo</span>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-[11px] text-muted">
                <button
                  type="button"
                  onClick={() => setBilling(f.key, !billing)}
                  className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${billing ? 'bg-starboard/15 text-starboard' : 'bg-line/60 text-muted'}`}
                  title={billing ? 'Charging this client for this feature -- click to comp it' : 'Not currently charging for this feature (comped or trial)'}
                >
                  {billing ? 'Billing: On' : 'Billing: Off'}
                </button>
                {!billing && (
                  <label className="flex items-center gap-1">
                    Free until
                    <input
                      type="date"
                      value={freeUntilFor(f.key)}
                      onChange={(e) => setFreeUntil(f.key, e.target.value)}
                      className="rounded border border-line bg-canvas px-1 py-0.5 text-ink outline-none focus:border-accent"
                    />
                  </label>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3 border-t border-line pt-3">
        {saved && !dirtyCount && <span className="text-xs font-medium text-starboard">✓ Saved</span>}
        {!!dirtyCount && <span className="text-xs text-muted">{dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}</span>}
        <button
          onClick={save}
          disabled={saving || !dirtyCount}
          className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

const CONDITION_LABELS = {
  lead_not_followed_up: 'Lead not touched',
  invoice_unpaid: 'Invoice unpaid',
}

// Pop-up reminders that show inside this org's own CRM (ReminderPopupToast.jsx)
// whenever a lead has sat untouched, or an invoice has gone unpaid, past a
// threshold Shawn sets here -- each with his own wording for what shows up.
// Purely additive to the org's normal workflow: nothing here changes access
// or billing, only what nudges their own team.
function ReminderRulesPanel({ org }) {
  const qc = useQueryClient()
  const { data: rules, isLoading } = useQuery({
    queryKey: ['reminderRules', org.id], queryFn: () => fetchReminderRules(org.id),
  })
  const [conditionType, setConditionType] = useState('lead_not_followed_up')
  const [thresholdDays, setThresholdDays] = useState('3')
  const [message, setMessage] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reminderRules', org.id] })

  const addRule = async () => {
    const days = Number(thresholdDays)
    if (!Number.isInteger(days) || days <= 0) return setErr('Days must be a positive whole number.')
    if (!message.trim()) return setErr('Write the message that should show up.')
    setErr(''); setSaving(true)
    try {
      await saveReminderRule({ orgId: org.id, conditionType, thresholdDays: days, message, enabled: true })
      setMessage('')
      setThresholdDays('3')
      invalidate()
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleRule = async (rule) => {
    await saveReminderRule({
      id: rule.id, orgId: org.id, conditionType: rule.condition_type,
      thresholdDays: rule.threshold_days, message: rule.message, enabled: !rule.enabled,
    })
    invalidate()
  }

  const removeRule = async (rule) => {
    if (!window.confirm('Delete this reminder rule?')) return
    await deleteReminderRule({ id: rule.id })
    invalidate()
  }

  return (
    <div className="mt-4 rounded-lg border border-line bg-canvas p-4">
      <p className="mb-3 text-xs text-muted">
        <b className="text-ink">Reminder Rules</b> — pop-ups that show inside {org.name}'s own CRM when a lead
        sits untouched or an invoice goes unpaid past a threshold you set. Write the message the way you want
        their team to see it.
      </p>
      {err && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-port">⚠️ {err}</p>}

      {isLoading && <p className="text-xs text-muted">Loading…</p>}
      {!isLoading && !rules?.length && <p className="text-xs text-muted">No reminder rules yet for this org.</p>}

      <div className="space-y-2">
        {rules?.map((rule) => (
          <div key={rule.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <span className="font-semibold text-ink">{CONDITION_LABELS[rule.condition_type] || rule.condition_type}</span>
                <span className="text-muted"> — {rule.threshold_days} day{rule.threshold_days === 1 ? '' : 's'}</span>
                <p className="mt-1 text-ink">{rule.message}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleRule(rule)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${rule.enabled ? 'bg-starboard' : 'bg-line'}`}
                  title={rule.enabled ? 'Enabled — click to turn off' : 'Disabled — click to turn on'}
                >
                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${rule.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <button
                  type="button"
                  onClick={() => removeRule(rule)}
                  title="Delete this rule"
                  className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr]">
          <select
            value={conditionType}
            onChange={(e) => setConditionType(e.target.value)}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
          >
            <option value="lead_not_followed_up">Lead not touched</option>
            <option value="invoice_unpaid">Invoice unpaid</option>
          </select>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              value={thresholdDays}
              onChange={(e) => setThresholdDays(e.target.value)}
              className="w-16 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
            />
            <span className="text-xs text-muted">days</span>
          </div>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. This lead hasn't been followed up on — call them today."
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
          />
        </div>
        <button
          onClick={addRule}
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add rule'}
        </button>
      </div>
    </div>
  )
}

function NewOrgForm({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [primaryColor, setPrimaryColor] = useState('')
  const [customDomain, setCustomDomain] = useState('')
  const [err, setErr] = useState('')

  const mutation = useMutation({
    mutationFn: () => createOrg({ name, slug, primaryColor, customDomain }),
    onSuccess: () => { onCreated(); onClose() },
    onError: (e) => setErr(e.message),
  })

  return (
    <div className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 text-sm font-semibold text-ink">New organization</h2>
      {err && <p className="mb-2 text-xs text-port">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name" value={name} onChange={setName} placeholder="Acme Port Services" />
        <Field label="Slug" value={slug} onChange={setSlug} placeholder="acme-port" />
        <Field label="Primary color" value={primaryColor} onChange={setPrimaryColor} placeholder="#1e40af" />
        <Field label="Custom domain" value={customDomain} onChange={setCustomDomain} placeholder="dispatch.acme.com" />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">
          Cancel
        </button>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !name.trim()}
          className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
        >
          {mutation.isPending ? 'Creating…' : 'Create organization'}
        </button>
      </div>
    </div>
  )
}

function InviteForm({ orgId, onClose, onInvited }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('agent')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  const mutation = useMutation({
    mutationFn: () => inviteUser({ orgId, email, fullName, role }),
    onSuccess: (result) => { setDone(result); onInvited() },
    onError: (e) => setErr(e.message),
  })

  return (
    <div className="mt-4 rounded-lg border border-line bg-canvas p-4">
      {done ? (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink">
            {done.invited ? 'Invite sent — they\'ll get an email to set a password.' : 'Added to this org — they can already log in.'}
          </p>
          <button onClick={onClose} className="text-xs font-medium text-accent hover:underline">Done</button>
        </div>
      ) : (
        <>
          {err && <p className="mb-2 text-xs text-port">{err}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Email" value={email} onChange={setEmail} placeholder="dispatcher@acme.com" />
            <Field label="Full name (optional)" value={fullName} onChange={setFullName} placeholder="Jamie Lee" />
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              >
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface hover:text-ink">
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !email.includes('@')}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
            >
              {mutation.isPending ? 'Inviting…' : 'Send invite'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
    </div>
  )
}
