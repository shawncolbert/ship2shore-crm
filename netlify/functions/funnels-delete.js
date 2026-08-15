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

  const { funnelId } = JSON.parse(event.body || '{}')
  if (!funnelId) return json(400, { error: 'Funnel ID required' })

  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  const { error: delErr } = await admin
    .from('funnels')
    .delete()
    .eq('id', funnelId)
    .eq('org_id', orgId)

  if (delErr) return json(500, { error: delErr.message })
  return json(200, { success: true })
}
