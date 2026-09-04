import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { orgGoogleMarketingToken } from './_shared/googleMarketing.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Same "actually exercise the refresh, don't just check the row exists"
// shape as gmail-status.js -- a dead refresh token should flip this back to
// "not connected" so Settings shows Reconnect instead of a stale green check.
export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  const { data } = await admin.from('google_marketing_tokens').select('email, gsc_site_url, ga4_property_id').eq('org_id', orgId).maybeSingle()
  if (!data) {
    return json(200, { connected: false, email: null, gscSiteUrl: null, ga4PropertyId: null })
  }

  try {
    await orgGoogleMarketingToken(orgId, admin)
    return json(200, { connected: true, email: data.email, gscSiteUrl: data.gsc_site_url, ga4PropertyId: data.ga4_property_id })
  } catch (e) {
    return json(200, { connected: false, needsReconnect: true, email: data.email, error: String(e?.message || e), gscSiteUrl: data.gsc_site_url, ga4PropertyId: data.ga4_property_id })
  }
}
