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

// Removes one person from one org -- not the org itself, and not their
// profile/account, which may still belong to other orgs.
export async function removeMember({ orgId, profileId }) {
  return authedFetch('admin-remove-member', { orgId, profileId })
}

// AI Studio's cross-org data access -- listing/loading/saving a landing
// page or business card for an org the caller isn't necessarily a member
// of. See netlify/functions/ai-studio-admin.js.
export async function aiStudioList({ orgId, kind }) {
  const { items } = await authedFetch('ai-studio-admin', { action: 'list_content', orgId, kind })
  return items
}

export async function aiStudioGet({ orgId, kind, id }) {
  const { item } = await authedFetch('ai-studio-admin', { action: 'get_content', orgId, kind, id })
  return item
}

export async function aiStudioSave({ orgId, kind, id, content }) {
  return authedFetch('ai-studio-admin', { action: 'save_content', orgId, kind, id: id || null, content })
}
