import { admin } from './supabaseAdmin.js'
import { sendInboxSms } from './twilioSend.js'

class ConsentError extends Error {
  constructor(message) { super(message); this.statusCode = 403 }
}

// The general reply-box send path (send-sms.js) -- gated hard on
// sms_consent, same principle as Prospecting's opt-in-only SMS steps. This
// is checked here, not just in the UI, since the UI hiding the compose box
// is a convenience, not the actual guarantee -- the guarantee lives here.
export async function sendCustomerSms({ orgId, to, body, contactId, conversationId }) {
  let cId = contactId
  let contact
  if (cId) {
    const { data } = await admin.from('contacts').select('id, sms_consent').eq('id', cId).maybeSingle()
    contact = data
  } else {
    const { data } = await admin.from('contacts').select('id, sms_consent').eq('org_id', orgId).eq('phone', to).maybeSingle()
    contact = data
    cId = contact?.id
  }
  if (!contact?.sms_consent) {
    throw new ConsentError('This contact hasn\'t opted in to text messages yet -- use "Ask to text" first.')
  }

  const result = await sendInboxSms({ orgId, to, body })
  if (!result.sent) throw new Error(result.reason || 'SMS send failed')

  let convId = conversationId
  if (!convId) {
    const { data: conv } = await admin
      .from('conversations')
      .upsert({ org_id: orgId, contact_id: cId, channel: 'sms' }, { onConflict: 'org_id,contact_id,channel' })
      .select('id')
      .single()
    convId = conv.id
  }

  await admin.from('messages').insert({
    org_id: orgId,
    conversation_id: convId,
    direction: 'outbound',
    channel: 'sms',
    body,
    from_addr: null,
    to_addr: to,
    provider: 'twilio',
    provider_msg_id: result.sid,
    status: 'sent',
  })
  await admin.from('conversations').update({ last_message_at: new Date().toISOString(), unread: false }).eq('id', convId)

  return { id: result.sid, conversationId: convId }
}

// The one message that's allowed to go out BEFORE consent exists -- it's
// the request for consent itself. Doesn't touch sms_consent; that only
// flips true once the contact actually replies (see twilio-sms-webhook.js),
// same "the reply IS the consent" principle Prospecting's SMS opt-in uses.
export async function sendConsentRequest({ orgId, contactId }) {
  const { data: contact } = await admin.from('contacts').select('id, phone').eq('id', contactId).maybeSingle()
  if (!contact?.phone) throw new Error('This contact has no phone number on file.')

  const body = 'Reply YES to get updates about your booking by text.'
  const result = await sendInboxSms({ orgId, to: contact.phone, body })
  if (!result.sent) throw new Error(result.reason || 'SMS send failed')

  const { data: conv } = await admin
    .from('conversations')
    .upsert({ org_id: orgId, contact_id: contactId, channel: 'sms' }, { onConflict: 'org_id,contact_id,channel' })
    .select('id')
    .single()

  await admin.from('messages').insert({
    org_id: orgId, conversation_id: conv.id, direction: 'outbound', channel: 'sms',
    body, from_addr: null, to_addr: contact.phone, provider: 'twilio',
    provider_msg_id: result.sid, status: 'sent',
  })
  await admin.from('conversations').update({ last_message_at: new Date().toISOString(), unread: false }).eq('id', conv.id)

  return { ok: true, conversationId: conv.id }
}
