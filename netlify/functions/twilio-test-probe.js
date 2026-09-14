// Temporary -- manual verification only, delete once confirmed working.
// Exists because outreach-sequence-sender.js is a scheduled function and
// can't be hit directly (Netlify returns 403 for anything with a
// `schedule` entry), same reason buffer-setup-probe.js existed earlier.
import { sendSms } from './_shared/twilioSend.js'

const PROBE_SECRET = 'ss2shore-twilio-probe-4f7a9d2e'

export const handler = async (event) => {
  const { to, body, secret } = JSON.parse(event.body || '{}')
  if (secret !== PROBE_SECRET) return { statusCode: 403, body: 'forbidden' }
  const result = await sendSms({ orgId: '11111111-1111-1111-1111-111111111111', to, body })
  return { statusCode: 200, body: JSON.stringify(result) }
}
