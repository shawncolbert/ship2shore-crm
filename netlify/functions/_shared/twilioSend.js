import { admin } from './supabaseAdmin.js'

// Per-org Twilio credentials -- each org owns its own account SID, auth
// token, and phone number(s), same isolation principle as Gmail/Telegram:
// one org's SMS can never go out under another org's number.
//
// Two logical "from" numbers share one Twilio account: twilio_phone_number
// (Prospecting's cold-outreach lane) and inbox_twilio_phone_number (the
// Inbox lane, real customers). inboxFromNumber falls back to the
// prospecting number when no dedicated one has been purchased yet, so the
// Inbox lane can go live before a second number exists -- filling in
// inbox_twilio_phone_number later switches it over with no code change.
export async function getOrgTwilioConfig(orgId) {
  const { data } = await admin
    .from('organizations')
    .select('twilio_account_sid, twilio_auth_token, twilio_phone_number, inbox_twilio_phone_number')
    .eq('id', orgId).maybeSingle()
  return {
    accountSid: data?.twilio_account_sid || null,
    authToken: data?.twilio_auth_token || null,
    fromNumber: data?.twilio_phone_number || null,
    inboxFromNumber: data?.inbox_twilio_phone_number || data?.twilio_phone_number || null,
  }
}

// Every send appends a STOP notice -- TCPA requires an opt-out be honored,
// and telling the recipient how up front is standard carrier-filtering
// practice (unlabeled marketing texts get flagged/blocked more often).
// Actual STOP handling lives in twilio-sms-webhook.js, not here.
// `fromNumber` overrides which of the org's numbers sends -- omit it for
// Prospecting's default (twilio_phone_number); pass inboxFromNumber for
// the Inbox lane (see sendInboxSms below).
export async function sendSms({ orgId, to, body, fromNumber }) {
  const config = await getOrgTwilioConfig(orgId)
  const { accountSid, authToken } = config
  const from = fromNumber || config.fromNumber
  if (!accountSid || !authToken || !from) return { sent: false, reason: 'Twilio not configured' }

  const fullBody = `${body}\n\nReply STOP to opt out.`
  const params = new URLSearchParams({ To: to, From: from, Body: fullBody })

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

// Convenience wrapper for the Inbox lane -- resolves inboxFromNumber so
// callers (send-sms.js, ask-to-text.js) don't each have to look it up.
export async function sendInboxSms({ orgId, to, body }) {
  const { inboxFromNumber } = await getOrgTwilioConfig(orgId)
  return sendSms({ orgId, to, body, fromNumber: inboxFromNumber })
}
