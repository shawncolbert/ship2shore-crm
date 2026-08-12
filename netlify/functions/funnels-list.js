import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })

  // Get user's org
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  // Get funnels for this org
  const { data: funnels, error } = await admin
    .from('funnels')
    .select('id, name, description, published, slug, theme')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return json(500, { error: error.message })
  return json(200, { funnels })
}
