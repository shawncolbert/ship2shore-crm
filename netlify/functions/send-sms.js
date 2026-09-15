import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { sendCustomerSms } from './_shared/inboxSms.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// Inbox lane reply send -- mirrors send-email.js's shape exactly, so the
// Thread component's compose box can treat SMS and email the same way from
// the client side. Consent is enforced server-side in sendCustomerSms, not
// just by the UI hiding the compose box for an unconsented contact.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const org = await orgForUser(user.id)
  if (!org) return json(403, { error: 'No org membership' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { conversationId, contactId, to, body } = payload
  if (!to || !body) return json(400, { error: 'Missing "to" or "body"' })

  try {
    const sent = await sendCustomerSms({ orgId: org, to, body, contactId, conversationId })
    return json(200, { ok: true, id: sent.id, conversationId: sent.conversationId })
  } catch (e) {
    return json(e.statusCode || 500, { error: String(e.message || e) })
  }
}
