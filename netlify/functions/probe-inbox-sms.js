// Temporary -- verifies Inbox SMS lane end-to-end. Delete once confirmed.
import { sendConsentRequest, sendCustomerSms } from './_shared/inboxSms.js'
const SECRET = 'inbox-sms-probe-b81e4c3f'
export const handler = async (event) => {
  const { secret, action, orgId, contactId, to, body, from, smsTo, smsBody } = JSON.parse(event.body || '{}')
  if (secret !== SECRET) return { statusCode: 403, body: 'forbidden' }
  try {
    if (action === 'ask') {
      return { statusCode: 200, body: JSON.stringify(await sendConsentRequest({ orgId, contactId })) }
    }
    if (action === 'send') {
      return { statusCode: 200, body: JSON.stringify(await sendCustomerSms({ orgId, contactId, to, body })) }
    }
    if (action === 'simulate-inbound') {
      // pg_net can't send a raw form-urlencoded body (its body param is
      // JSON-only), so this does a real server-to-server call with proper
      // encoding to actually exercise twilio-sms-webhook.js as Twilio would.
      const params = new URLSearchParams({ From: from, To: smsTo, Body: smsBody })
      const res = await fetch('https://dispatch.ship2shorebooking.com/.netlify/functions/twilio-sms-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      })
      return { statusCode: 200, body: JSON.stringify({ webhookStatus: res.status }) }
    }
    return { statusCode: 400, body: 'unknown action' }
  } catch (e) {
    return { statusCode: e.statusCode || 500, body: JSON.stringify({ error: e.message }) }
  }
}
