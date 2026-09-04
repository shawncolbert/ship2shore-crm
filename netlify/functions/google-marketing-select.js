import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Saves which Search Console site and/or GA4 property this org's synced
// data should come from -- a connected Google account often has several of
// each (agency accounts, old test properties), so this is a deliberate
// pick, not "just use whatever's first."
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { gscSiteUrl, ga4PropertyId } = body

  const patch = { updated_at: new Date().toISOString() }
  if (gscSiteUrl !== undefined) patch.gsc_site_url = gscSiteUrl || null
  if (ga4PropertyId !== undefined) patch.ga4_property_id = ga4PropertyId || null

  const { error } = await admin.from('google_marketing_tokens').update(patch).eq('org_id', orgId)
  if (error) return json(500, { error: error.message })
  return json(200, { ok: true })
}
