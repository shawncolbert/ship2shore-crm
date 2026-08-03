import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchOrgs, createOrg, inviteUser, fetchOrgStats } from '../lib/admin'
import { fetchMyProfile } from '../lib/supabase'

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
            <div key={org.id} className="rounded-xl border border-line bg-surface p-5">
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
                <button
                  onClick={() => setInviteFor(inviteFor === org.id ? null : org.id)}
                  className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent"
                >
                  Invite user
                </button>
              </div>

            <div className="mt-3 space-y-1">
              {org.members?.length === 0 && <p className="text-xs text-muted">No members yet.</p>}
              {org.members?.map((m, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-ink">{m.fullName || m.email}</span>
                  <span className="rounded-full bg-canvas px-2 py-0.5 font-medium uppercase tracking-wide text-muted ring-1 ring-inset ring-line">
                    {m.role}
                  </span>
                </div>
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
    <div className="mb-6 rounded-xl border border-line bg-surface p-5">
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
