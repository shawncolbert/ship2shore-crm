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

// state carries the org id through TikTok's redirect and an HMAC so the
// callback can trust it without needing a server-side session/cookie.
function signState(orgId) {
  const payload = Buffer.from(JSON.stringify({ orgId, ts: Date.now() })).toString('base64url')
  const sig = crypto.createHmac('sha256', process.env.TIKTOK_CLIENT_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

// Returns the URL to send the browser to -- the frontend does
// window.location.href = authorize_url, same shape as any "Connect X" button.
export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
    return json(400, { error: 'TikTok isn\'t set up yet -- TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET aren\'t configured. See Social Posts help text.' })
  }

  const redirectUri = `${siteOrigin(event)}/.netlify/functions/tiktok-oauth-callback`
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    response_type: 'code',
    scope: 'user.info.basic,video.publish',
    redirect_uri: redirectUri,
    state: signState(orgId),
  })

  return json(200, { authorize_url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}` })
}
