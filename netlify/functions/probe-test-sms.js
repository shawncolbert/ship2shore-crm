// Temporary -- one-off test send. Delete once confirmed.
import { sendSms } from './_shared/twilioSend.js'
const SECRET = 'test-sms-probe-6d2f8a91'
export const handler = async (event) => {
  const { secret, orgId, to, body } = JSON.parse(event.body || '{}')
  if (secret !== SECRET) return { statusCode: 403, body: 'forbidden' }
  const result = await sendSms({ orgId, to, body })
  return { statusCode: 200, body: JSON.stringify(result) }
}
