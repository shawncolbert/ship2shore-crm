import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { orgGoogleAccessToken } from './_shared/google.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// 2026-09-02: this used to just check whether a gmail_oauth_tokens row
// existed -- so once connected, the Inbox page showed a green "Gmail
// connected" banner forever, even after Google revoked the refresh token
// (which happens on its own periodically for an unverified OAuth app).
// Shawn had no way to tell it was actually broken, and no way to
// reconnect since the "Connect Gmail" button only shows up when
// disconnected. Now actually exercises the refresh (same call every real
// send makes) so a dead token correctly flips this back to "not
// connected" and the reconnect button reappears.
export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  const { data } = await admin.from('gmail_oauth_tokens').select('email').eq('org_id', orgId).maybeSingle()
  if (!data) {
    return json(200, {
      connected: false,
      email: null,
      appConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    })
  }

  try {
    await orgGoogleAccessToken(orgId, admin)
    return json(200, {
      connected: true,
      email: data.email,
      appConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    })
  } catch (e) {
    return json(200, {
      connected: false,
      needsReconnect: true,
      email: data.email,
      error: String(e?.message || e),
      appConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    })
  }
}
