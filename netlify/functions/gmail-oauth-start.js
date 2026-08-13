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

// Same pattern as tiktok-oauth-start.js's signState: carries the org id
// through Google's redirect with an HMAC, so the callback can trust it
// without a server-side session/cookie.
function signState(orgId) {
  const payload = Buffer.from(JSON.stringify({ orgId, ts: Date.now() })).toString('base64url')
  const sig = crypto.createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

// Returns the URL to send the browser to -- the frontend does
// window.location.href = authorize_url, same shape as "Connect TikTok".
export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return json(400, { error: 'Gmail isn\'t set up yet -- GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET aren\'t configured.' })
  }

  const redirectUri = `${siteOrigin(event)}/.netlify/functions/gmail-oauth-callback`
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    response_type: 'code',
    // send: post replies/payment requests/document requests as this org.
    // readonly: sync inbound/outbound mail into the Inbox and match documents.
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token even if this Google account already authorized once before
    redirect_uri: redirectUri,
    state: signState(orgId),
  })

  return json(200, { authorize_url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` })
}
