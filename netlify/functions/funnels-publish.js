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

  const { funnelId, published } = JSON.parse(event.body || '{}')
  if (!funnelId) return json(400, { error: 'Funnel ID required' })

  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  // Verify ownership and update
  const { error: updateErr } = await admin
    .from('funnels')
    .update({ published })
    .eq('id', funnelId)
    .eq('org_id', orgId)

  if (updateErr) return json(500, { error: updateErr.message })
  return json(200, { success: true })
}
