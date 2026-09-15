// Temporary -- verifies Inbox SMS lane end-to-end. Delete once confirmed.
import { sendConsentRequest, sendCustomerSms } from './_shared/inboxSms.js'
const SECRET = 'inbox-sms-probe-b81e4c3f'
export const handler = async (event) => {
  const { secret, action, orgId, contactId, to, body } = JSON.parse(event.body || '{}')
  if (secret !== SECRET) return { statusCode: 403, body: 'forbidden' }
  try {
    const result = action === 'ask'
      ? await sendConsentRequest({ orgId, contactId })
      : await sendCustomerSms({ orgId, contactId, to, body })
    return { statusCode: 200, body: JSON.stringify(result) }
  } catch (e) {
    return { statusCode: e.statusCode || 500, body: JSON.stringify({ error: e.message }) }
  }
}
