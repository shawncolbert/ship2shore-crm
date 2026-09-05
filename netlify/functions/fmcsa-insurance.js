import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { lookupCarrierByDot } from './_shared/fmcsaLookup.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { dotNumber } = payload
  if (!dotNumber?.toString().trim()) return json(400, { error: 'A DOT number is required.' })

  let carrier
  try {
    carrier = await lookupCarrierByDot(dotNumber.toString().trim())
  } catch (e) {
    return json(502, { error: e.message || 'Could not reach the Motus registration system.' })
  }

  return json(200, { carrier })
}
