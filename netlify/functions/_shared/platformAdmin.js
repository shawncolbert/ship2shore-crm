import { admin, userFromToken } from './supabaseAdmin.js'

// Gate for the cross-org admin tools (create org, invite user to any org).
// Uses the service-role client to check profiles.platform_admin directly --
// deliberately bypassing RLS, since this one check is what decides whether
// bypassing RLS for the rest of the request is allowed at all.
export async function requirePlatformAdmin(token) {
  const user = await userFromToken(token)
  if (!user) return null
  const { data } = await admin.from('profiles').select('platform_admin').eq('id', user.id).maybeSingle()
  return data?.platform_admin ? user : null
}
