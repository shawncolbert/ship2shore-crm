import { admin } from './supabaseAdmin.js'

// Per-org Twilio credentials -- each org owns its own account SID, auth
// token, and phone number (Outreach settings), same isolation principle as
// Gmail/Telegram: one org's SMS sequence can never go out under another
// org's number.
export async function getOrgTwilioConfig(orgId) {
  const { data } = await admin
    .from('organizations').select('twilio_account_sid, twilio_auth_token, twilio_phone_number').eq('id', orgId).maybeSingle()
  return {
    accountSid: data?.twilio_account_sid || null,
    authToken: data?.twilio_auth_token || null,
    fromNumber: data?.twilio_phone_number || null,
  }
}

// Every send appends a STOP notice -- TCPA requires an opt-out be honored,
// and telling the recipient how up front is standard carrier-filtering
// practice (unlabeled marketing texts get flagged/blocked more often).
// Actual STOP handling lives in twilio-sms-webhook.js, not here.
export async function sendSms({ orgId, to, body }) {
  const { accountSid, authToken, fromNumber } = await getOrgTwilioConfig(orgId)
  if (!accountSid || !authToken || !fromNumber) return { sent: false, reason: 'Twilio not configured' }

  const fullBody = `${body}\n\nReply STOP to opt out.`
  const params = new URLSearchParams({ To: to, From: fromNumber, Body: fullBody })

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('❌ twilioSend: send failed', data)
      return { sent: false, reason: data.message || `HTTP ${res.status}` }
    }
    return { sent: true, sid: data.sid }
  } catch (e) {
    console.error('❌ twilioSend: threw', e)
    return { sent: false, reason: e.message }
  }
}
