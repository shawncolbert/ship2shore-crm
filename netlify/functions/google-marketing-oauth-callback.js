import crypto from 'node:crypto'
import { admin } from './_shared/supabaseAdmin.js'

function siteOrigin(event) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`
}

function redirectTo(event, query) {
  return {
    statusCode: 302,
    headers: { Location: `${siteOrigin(event)}/settings/seo-analytics?${new URLSearchParams(query).toString()}` },
  }
}

// Same verification shape as gmail-oauth-callback.js's verifyState.
function verifyState(state) {
  try {
    const [payload, sig] = String(state || '').split('.')
    if (!payload || !sig) return null
    const expected = crypto.createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET).update(payload).digest('base64url')
    const sigBuf = Buffer.from(sig)
    const expectedBuf = Buffer.from(expected)
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null
    const { orgId, ts } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (Date.now() - ts > 10 * 60 * 1000) return null
    return orgId
  } catch {
    return null
  }
}

export const handler = async (event) => {
  const { code, state, error: googleError } = event.queryStringParameters || {}

  if (googleError) return redirectTo(event, { google: 'error', msg: googleError })

  const orgId = verifyState(state)
  if (!orgId) return redirectTo(event, { google: 'error', msg: 'Connection link expired -- click Connect again.' })
  if (!code) return redirectTo(event, { google: 'error', msg: 'Google did not return an authorization code.' })

  try {
    const redirectUri = `${siteOrigin(event)}/.netlify/functions/google-marketing-oauth-callback`
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenRes.ok || !tokenData.access_token) {
      return redirectTo(event, { google: 'error', msg: 'Google token exchange failed: ' + (tokenData.error_description || tokenData.error || 'unknown error') })
    }
    if (!tokenData.refresh_token) {
      return redirectTo(event, { google: 'error', msg: 'Google did not return a long-lived connection. Go to your Google Account’s "Third-party access" settings, remove this app’s access, then click Connect again.' })
    }

    let email = null
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      if (infoRes.ok) email = (await infoRes.json()).email || null
    } catch {
      // Non-essential -- the connection still works without a display email.
    }

    await admin.from('google_marketing_tokens').upsert({
      org_id: orgId,
      email,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expiry: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' })

    return redirectTo(event, { google: 'connected' })
  } catch (e) {
    return redirectTo(event, { google: 'error', msg: String(e.message || e) })
  }
}
