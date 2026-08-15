import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// Cross-org listing is deliberately outside what RLS allows any ordinary
// member to see -- only a platform admin can enumerate every tenant.
export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  const { data, error } = await admin
    .from('organizations')
    .select('id, name, slug, logo_url, primary_color, custom_domain, enabled_features, created_at')
    .order('created_at', { ascending: false })
  if (error) return json(500, { error: error.message })

  const { data: members } = await admin
    .from('memberships')
    .select('org_id, profile_id, role, profiles(email, full_name)')
  const byOrg = {}
  for (const m of members || []) {
    (byOrg[m.org_id] ||= []).push({ profileId: m.profile_id, role: m.role, email: m.profiles?.email, fullName: m.profiles?.full_name })
  }

  return json(200, { organizations: (data || []).map((o) => ({ ...o, members: byOrg[o.id] || [] })) })
}
