// Cross-org tools for the platform admin only (create an org, invite a user
// to it). These go through Netlify functions backed by the service-role
// client, since ordinary RLS deliberately can't see across tenants -- see
// netlify/functions/_shared/platformAdmin.js for the server-side gate.
import { supabase } from './supabase'

async function authedFetch(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/.netlify/functions/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify(body || {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export async function fetchOrgs() {
  const { organizations } = await authedFetch('admin-list-orgs')
  return organizations
}

export async function createOrg({ name, slug, logoUrl, primaryColor, customDomain }) {
  const { organization } = await authedFetch('admin-create-org', { name, slug, logoUrl, primaryColor, customDomain })
  return organization
}

export async function inviteUser({ orgId, email, fullName, role }) {
  return authedFetch('admin-invite-user', { orgId, email, fullName, role })
}

export async function fetchOrgStats() {
  const { stats } = await authedFetch('admin-org-stats')
  return stats
}

export async function setOrgFeature({ orgId, featureKey, enabled }) {
  const { organization } = await authedFetch('admin-update-org-features', { orgId, featureKey, enabled })
  return organization
}
