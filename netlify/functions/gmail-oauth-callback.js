import crypto from 'node:crypto'
import { admin } from './_shared/supabaseAdmin.js'

function siteOrigin(event) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`
}

function redirectTo(event, query) {
  return {
    statusCode: 302,
    headers: { Location: `${siteOrigin(event)}/inbox?${new URLSearchParams(query).toString()}` },
  }
}

// Same verification shape as tiktok-oauth-callback.js's verifyState.
function verifyState(state) {
  try {
    const [payload, sig] = String(state || '').split('.')
    if (!payload || !sig) return null
    const expected = crypto.createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET).update(payload).digest('base64url')
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

// Google redirects the browser here after the user approves (or denies)
// access on Google's own consent screen -- the other half of
// gmail-oauth-start. No app auth on this request; the signed state is what
// we trust instead, since it's Google's server making this redirect happen.
export const handler = async (event) => {
  const { code, state, error: googleError } = event.queryStringParameters || {}

  if (googleError) return redirectTo(event, { gmail: 'error', msg: googleError })

  const orgId = verifyState(state)
  if (!orgId) return redirectTo(event, { gmail: 'error', msg: 'Connection link expired -- click Connect Gmail again.' })
  if (!code) return redirectTo(event, { gmail: 'error', msg: 'Google did not return an authorization code.' })

  try {
    const redirectUri = `${siteOrigin(event)}/.netlify/functions/gmail-oauth-callback`
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
      return redirectTo(event, { gmail: 'error', msg: 'Google token exchange failed: ' + (tokenData.error_description || tokenData.error || 'unknown error') })
    }
    // Google only issues a refresh_token the FIRST time a given Google
    // account grants this app access, even with prompt=consent, if that
    // combination was already fully revoked+regranted oddly -- in the
    // overwhelming normal case this is present, but guard the rare miss
    // with a clear message instead of silently storing a connection that
    // can't survive its first access-token expiry.
    if (!tokenData.refresh_token) {
      return redirectTo(event, { gmail: 'error', msg: 'Google did not return a long-lived connection. Go to your Google Account’s "Third-party access" settings, remove Ship2Shore, then click Connect Gmail again.' })
    }

    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const profileData = await profileRes.json()
    const email = profileData?.emailAddress
    if (!profileRes.ok || !email) {
      return redirectTo(event, { gmail: 'error', msg: 'Could not read the connected Gmail address.' })
    }

    await admin.from('gmail_oauth_tokens').upsert({
      org_id: orgId,
      email,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expiry: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' })

    return redirectTo(event, { gmail: 'connected' })
  } catch (e) {
    return redirectTo(event, { gmail: 'error', msg: String(e.message || e) })
  }
}
