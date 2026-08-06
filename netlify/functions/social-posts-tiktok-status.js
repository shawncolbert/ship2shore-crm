import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { tiktokConfigured } from './_shared/tiktok.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  const connected = await tiktokConfigured(orgId)
  let username = null
  if (connected) {
    const { data } = await admin.from('tiktok_oauth_tokens').select('username').eq('org_id', orgId).maybeSingle()
    username = data?.username || null
  }

  return json(200, { connected, username, appConfigured: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET) })
}
