import { supabase } from './_shared/supabase.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return json(401, { error: 'Unauthorized' })

  // Get user's org
  const { data: membership } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('profile_id', user.id)
    .single()

  if (!membership) return json(403, { error: 'No organization' })

  // Get funnels for this org
  const { data: funnels, error } = await supabase
    .from('funnels')
    .select('id, name, description, published, slug')
    .eq('org_id', membership.org_id)
    .order('created_at', { ascending: false })

  if (error) return json(500, { error: error.message })
  return json(200, { funnels })
}
