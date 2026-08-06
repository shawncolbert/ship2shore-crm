import crypto from 'node:crypto'
import { admin } from './_shared/supabaseAdmin.js'

function siteOrigin(event) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`
}

function redirectTo(event, query) {
  return {
    statusCode: 302,
    headers: { Location: `${siteOrigin(event)}/social-posts?${new URLSearchParams(query).toString()}` },
  }
}

function verifyState(state) {
  // Any malformed/forged state (wrong length, bad base64, tampered payload)
  // must come back as "not valid" rather than throw -- this runs unauthenticated,
  // straight off whatever query string shows up on this URL.
  try {
    const [payload, sig] = String(state || '').split('.')
    if (!payload || !sig) return null
    const expected = crypto.createHmac('sha256', process.env.TIKTOK_CLIENT_SECRET).update(payload).digest('base64url')
    const sigBuf = Buffer.from(sig)
    const expectedBuf = Buffer.from(expected)
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null
    const { orgId, ts } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (Date.now() - ts > 10 * 60 * 1000) return null // authorize_url is single-use, 10 min window
    return orgId
  } catch {
    return null
  }
}

// TikTok redirects the browser here after the user approves (or denies)
// access on TikTok's own consent screen -- this is the other half of
// tiktok-oauth-start. No app auth on this request; the signed state is what
// we trust instead, since it's TikTok's server making this redirect happen.
export const handler = async (event) => {
  const { code, state, error: tiktokError } = event.queryStringParameters || {}

  if (tiktokError) return redirectTo(event, { tiktok: 'error', msg: tiktokError })

  const orgId = verifyState(state)
  if (!orgId) return redirectTo(event, { tiktok: 'error', msg: 'Connection link expired -- click Connect TikTok again.' })
  if (!code) return redirectTo(event, { tiktok: 'error', msg: 'TikTok did not return an authorization code.' })

  try {
    const redirectUri = `${siteOrigin(event)}/.netlify/functions/tiktok-oauth-callback`
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenRes.ok || !tokenData.access_token) {
      return redirectTo(event, { tiktok: 'error', msg: 'TikTok token exchange failed: ' + (tokenData.error_description || tokenData.error || 'unknown error') })
    }

    let username = null
    try {
      const infoRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=username', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      const infoData = await infoRes.json()
      username = infoData?.data?.user?.username || null
    } catch {
      // Nice-to-have display name only; connection still succeeds without it.
    }

    await admin.from('tiktok_oauth_tokens').upsert({
      org_id: orgId,
      open_id: tokenData.open_id,
      username,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expiry: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' })

    return redirectTo(event, { tiktok: 'connected' })
  } catch (e) {
    return redirectTo(event, { tiktok: 'error', msg: String(e.message || e) })
  }
}
