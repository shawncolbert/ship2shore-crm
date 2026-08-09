import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// Platform-admin only -- flips one feature flag for one org. A full
// replace-the-whole-map call isn't used on purpose: two admins (or two
// browser tabs) toggling different features around the same moment
// shouldn't be able to clobber each other's change.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { orgId, featureKey, enabled } = payload
  if (!orgId || !featureKey || typeof enabled !== 'boolean') {
    return json(400, { error: 'Missing orgId, featureKey, or enabled' })
  }

  const { data: org, error: fetchErr } = await admin
    .from('organizations').select('enabled_features').eq('id', orgId).maybeSingle()
  if (fetchErr) return json(500, { error: fetchErr.message })
  if (!org) return json(404, { error: 'Organization not found' })

  const nextFeatures = { ...(org.enabled_features || {}), [featureKey]: enabled }
  const { data, error } = await admin
    .from('organizations').update({ enabled_features: nextFeatures }).eq('id', orgId)
    .select('id, enabled_features').single()
  if (error) return json(500, { error: error.message })

  return json(200, { organization: data })
}
