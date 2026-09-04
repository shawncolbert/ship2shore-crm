import crypto from 'node:crypto'
import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function siteOrigin(event) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`
}

// Same signed-state shape as gmail-oauth-start.js's signState.
function signState(orgId) {
  const payload = Buffer.from(JSON.stringify({ orgId, ts: Date.now() })).toString('base64url')
  const sig = crypto.createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

// Separate OAuth connection from "Connect Gmail" -- reuses the same Google
// Cloud OAuth client (GOOGLE_CLIENT_ID/SECRET), different scopes. An org
// shouldn't have to grant Gmail access just to see its own search/traffic
// numbers, or vice versa.
export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return json(400, { error: 'Google isn\'t set up yet -- GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET aren\'t configured.' })
  }

  const redirectUri = `${siteOrigin(event)}/.netlify/functions/google-marketing-oauth-callback`
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    response_type: 'code',
    // webmasters.readonly: Search Console queries/clicks/impressions/position.
    // analytics.readonly: GA4 sessions/pageviews per page.
    // openid + userinfo.email: just so the Settings page can show "connected as x@y.com".
    scope: 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly openid https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token even if this Google account already authorized this app before
    redirect_uri: redirectUri,
    state: signState(orgId),
  })

  return json(200, { authorize_url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` })
}
