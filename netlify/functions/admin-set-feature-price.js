import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// System Controls panel (AdminOrgs.jsx) -- records what Shawn is charging
// one org for one feature, and whether that charge is actually active right
// now. Reference-only: nothing in the app reads any of this to decide
// access (enabled_features alone controls that) -- it exists so he has a
// real record of what he quoted each client and whether they're in a free
// trial, not a memory of it. Pass price/freeUntil: null to clear either
// back to "not set."
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { orgId, featureKey, price, billingActive, freeUntil } = payload
  if (!orgId || !featureKey) return json(400, { error: 'Missing orgId or featureKey' })
  if (price != null && (typeof price !== 'number' || price < 0)) {
    return json(400, { error: 'price must be a non-negative number, or null' })
  }
  if (typeof billingActive !== 'boolean') return json(400, { error: 'billingActive must be true or false' })

  const { data, error } = await admin
    .from('feature_pricing')
    .upsert({
      org_id: orgId, feature_key: featureKey, price_usd: price,
      billing_active: billingActive, free_until: freeUntil || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,feature_key' })
    .select('feature_key, price_usd, billing_active, free_until')
    .single()
  if (error) return json(500, { error: error.message })

  return json(200, { pricing: { price: data.price_usd, billingActive: data.billing_active, freeUntil: data.free_until } })
}
