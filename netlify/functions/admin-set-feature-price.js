import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// System Controls panel (AdminOrgs.jsx) -- records what Shawn is charging
// one org for one feature. Reference-only: nothing in the app reads this
// to decide access (enabled_features alone controls that) -- it exists so
// he has a real record of what he quoted each client, not a memory of it.
// Pass price: null to clear a price back to "not set."
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { orgId, featureKey, price } = payload
  if (!orgId || !featureKey) return json(400, { error: 'Missing orgId or featureKey' })
  if (price != null && (typeof price !== 'number' || price < 0)) {
    return json(400, { error: 'price must be a non-negative number, or null' })
  }

  const { data, error } = await admin
    .from('feature_pricing')
    .upsert({ org_id: orgId, feature_key: featureKey, price_usd: price, updated_at: new Date().toISOString() }, { onConflict: 'org_id,feature_key' })
    .select('feature_key, price_usd')
    .single()
  if (error) return json(500, { error: error.message })

  return json(200, { pricing: data })
}
