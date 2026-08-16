import { createClient } from '@supabase/supabase-js'

// Accept a few common names for the service-role key so a misnamed env
// var doesn't silently break every server function.
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.service_role_key

// Service-role client — bypasses RLS. Only ever runs server-side.
export const admin = createClient(
  process.env.SUPABASE_URL,
  SERVICE_KEY,
  { auth: { persistSession: false } }
)

export async function userFromToken(token) {
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error) return null
  return data.user
}

// Prefers profiles.active_org_id when it's set AND still a real membership
// (a user who belonged to an org that got deleted, or was removed from,
// shouldn't get stuck pointing at it). Falls back to "any membership" --
// fine for the common case of a user with exactly one org, which is most
// of them; a user with several and no active_org_id set yet just gets a
// deterministic first pick until they use the org switcher.
export async function orgForUser(userId) {
  const { data: memberships } = await admin
    .from('memberships').select('org_id').eq('profile_id', userId)
  if (!memberships?.length) return null
  if (memberships.length === 1) return memberships[0].org_id

  const { data: profile } = await admin
    .from('profiles').select('active_org_id').eq('id', userId).maybeSingle()
  const active = profile?.active_org_id
  if (active && memberships.some((m) => m.org_id === active)) return active

  return memberships[0].org_id
}
