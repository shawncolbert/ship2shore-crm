import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// Removes one person from one org -- not the org itself, and not their
// profile/account, which may still belong to other orgs. Platform-admin
// only, same gate as the rest of the cross-org admin tools.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { orgId, profileId } = payload
  if (!orgId || !profileId) return json(400, { error: 'orgId and profileId are required' })

  const { error } = await admin
    .from('memberships')
    .delete()
    .eq('org_id', orgId)
    .eq('profile_id', profileId)
  if (error) return json(500, { error: error.message })

  return json(200, { ok: true })
}
