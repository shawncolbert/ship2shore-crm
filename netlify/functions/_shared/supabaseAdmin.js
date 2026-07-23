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

export async function orgForUser(userId) {
  const { data } = await admin
    .from('memberships').select('org_id').eq('profile_id', userId).limit(1).maybeSingle()
  return data?.org_id || null
}
