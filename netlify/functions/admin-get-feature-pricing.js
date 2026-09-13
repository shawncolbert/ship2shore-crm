import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// System Controls panel (AdminOrgs.jsx) -- what Shawn is charging one org
// per feature, keyed by feature key. Missing a key just means "not priced
// yet," same "absence is the default" shape as enabled_features.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { orgId } = payload
  if (!orgId) return json(400, { error: 'Missing orgId' })

  const { data, error } = await admin
    .from('feature_pricing').select('feature_key, price_usd').eq('org_id', orgId)
  if (error) return json(500, { error: error.message })

  const pricing = Object.fromEntries((data || []).map((r) => [r.feature_key, r.price_usd]))
  return json(200, { pricing })
}
