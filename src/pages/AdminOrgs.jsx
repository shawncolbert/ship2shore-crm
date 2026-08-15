import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchOrgs, createOrg, inviteUser, fetchOrgStats, setOrgFeature, removeMember } from '../lib/admin'
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
                    Features
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
                <OrgFeaturesPanel org={org} onChanged={invalidate} />
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

// Which sidebar items this org sees, one switch per feature. A missing key
// means "on" -- see isFeatureEnabled -- so a brand-new org with an empty
// enabled_features starts with everything visible. Toggles here only
// change local draft state -- nothing is written until Save is clicked, so
// flipping a switch is instant (no network round-trip to wait on before it
// visibly moves) and a batch of changes commits together.
function OrgFeaturesPanel({ org, onChanged }) {
  const [draft, setDraft] = useState(() => ({ ...(org.enabled_features || {}) }))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  const isOn = (key) => draft[key] !== false
  const toggle = (key) => {
    setDraft((d) => ({ ...d, [key]: !isOn(key) }))
    setSaved(false)
  }

  // Only the keys that actually differ from what's saved need a write --
  // same reasoning as the single-toggle version this replaced.
  const dirtyKeys = FEATURES.map((f) => f.key).filter((key) => isOn(key) !== isFeatureEnabled(org, key))

  const save = async () => {
    setSaving(true); setErr('')
    try {
      for (const key of dirtyKeys) {
        await setOrgFeature({ orgId: org.id, featureKey: key, enabled: isOn(key) })
      }
      onChanged()
      setSaved(true)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-line bg-canvas p-4">
      <p className="mb-3 text-xs text-muted">
        What {org.name} sees in their sidebar. Off means the whole feature — sidebar link and the page
        itself — is unreachable for every user in this org. Flip whatever you need, then hit Save.
      </p>
      {err && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-port">⚠️ {err}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {FEATURES.map((f) => {
          const on = isOn(f.key)
          return (
            <button
              key={f.key}
              onClick={() => toggle(f.key)}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-xs font-medium text-ink"
            >
              <span>{f.label}</span>
              <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-starboard' : 'bg-line'}`}>
                <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3 border-t border-line pt-3">
        {saved && !dirtyKeys.length && <span className="text-xs font-medium text-starboard">✓ Saved</span>}
        {!!dirtyKeys.length && <span className="text-xs text-muted">{dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? '' : 's'}</span>}
        <button
          onClick={save}
          disabled={saving || !dirtyKeys.length}
          className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
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
