import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { sendConsentRequest } from './_shared/inboxSms.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// The one-time consent-request text for a contact who has a phone number
// on file but hasn't opted in yet (e.g. booked before the consent checkbox
// existed). Their reply is what actually grants consent -- see
// twilio-sms-webhook.js -- this only sends the ask.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const org = await orgForUser(user.id)
  if (!org) return json(403, { error: 'No org membership' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { contactId } = payload
  if (!contactId) return json(400, { error: 'Missing contactId' })

  try {
    const result = await sendConsentRequest({ orgId: org, contactId })
    return json(200, result)
  } catch (e) {
    return json(e.statusCode || 500, { error: String(e.message || e) })
  }
}
