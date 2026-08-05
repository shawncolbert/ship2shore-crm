import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { sendCustomerEmail } from './_shared/email.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const org = await orgForUser(user.id)
  if (!org) return json(403, { error: 'No org membership' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { conversationId, contactId, to, subject, body } = payload
  if (!to || !body) return json(400, { error: 'Missing "to" or "body"' })

  try {
    const sent = await sendCustomerEmail({ orgId: org, to, subject, body, contactId, conversationId })
    return json(200, { ok: true, id: sent.id, conversationId: sent.conversationId })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
