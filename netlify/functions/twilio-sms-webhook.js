import { admin } from './_shared/supabaseAdmin.js'

const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt-out'])

const twiml = () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/xml' },
  body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
})

// Public, unauthenticated by necessity -- this is Twilio's own webhook URL,
// called directly by Twilio's platform on every inbound SMS to one of our
// orgs' numbers.
//
// Handles inbound for BOTH Prospecting (cold-outreach SMS, matched against
// `prospects`) and the Inbox lane (real customers, matched against
// `contacts`) in one place. That's not by choice -- Twilio only lets one
// webhook URL be configured per phone number, and until a dedicated second
// number is purchased for the Inbox lane, both features share one number
// (see organizations.inbox_twilio_phone_number's fallback in
// _shared/twilioSend.js). Once a separate number exists, this can split
// into two webhooks, each pointed at by Twilio for its own number.
export const handler = async (event) => {
  const params = new URLSearchParams(event.body || '')
  const from = params.get('From')
  const to = params.get('To')
  const body = (params.get('Body') || '').trim()
  if (!from || !to) return twiml()

  const { data: org } = await admin
    .from('organizations').select('id')
    .or(`twilio_phone_number.eq.${to},inbox_twilio_phone_number.eq.${to}`)
    .maybeSingle()
  if (!org) return twiml()

  const isStop = STOP_WORDS.has(body.toLowerCase())

  if (isStop) {
    // Prospecting side: suppress permanently, same as before.
    const { data: already } = await admin
      .from('do_not_contact').select('id').eq('org_id', org.id).eq('phone', from).maybeSingle()
    if (!already) {
      await admin.from('do_not_contact').insert({ org_id: org.id, phone: from, reason: 'sms_stop' })
    }
    const { data: matched } = await admin
      .from('prospects').update({ status: 'do_not_contact', sms_opted_in: false }).eq('org_id', org.id).eq('phone', from).select('id')
    const prospectIds = (matched || []).map((p) => p.id)
    if (prospectIds.length) {
      await admin.from('outreach_enrollments').update({ status: 'stopped' }).eq('org_id', org.id).in('prospect_id', prospectIds)
    }
    // Inbox side: STOP is honored universally regardless of which "program"
    // the recipient thinks they're replying to -- a customer who says STOP
    // doesn't keep getting texted just because they'd separately consented.
    await admin.from('contacts').update({ sms_consent: false }).eq('org_id', org.id).eq('phone', from)
    return twiml()
  }

  // Prospecting side: any other reply opens the gate for cold-outreach SMS
  // steps -- sms_opted_in is what a sequence step checks, and this webhook
  // is the only place allowed to set it. Only an actual inbound text counts.
  await admin.from('prospects').update({ status: 'replied', sms_opted_in: true }).eq('org_id', org.id).eq('phone', from)

  // Inbox side: log the message into that contact's SMS thread if this
  // number belongs to one of our contacts. Texting in at all counts as
  // consent if it wasn't already given -- same "the reply IS the consent"
  // principle as the Ask-to-text flow, just triggered by an unprompted text
  // instead of our own consent-request message.
  const { data: contact } = await admin
    .from('contacts').select('id, sms_consent').eq('org_id', org.id).eq('phone', from).maybeSingle()
  if (contact) {
    const { data: conv } = await admin
      .from('conversations')
      .upsert({ org_id: org.id, contact_id: contact.id, channel: 'sms' }, { onConflict: 'org_id,contact_id,channel' })
      .select('id')
      .single()
    await admin.from('messages').insert({
      org_id: org.id, conversation_id: conv.id, direction: 'inbound', channel: 'sms',
      body, from_addr: from, to_addr: to, provider: 'twilio', status: 'received',
    })
    await admin.from('conversations').update({ last_message_at: new Date().toISOString(), unread: true }).eq('id', conv.id)
    if (!contact.sms_consent) {
      await admin.from('contacts').update({ sms_consent: true, sms_consent_at: new Date().toISOString() }).eq('id', contact.id)
    }
  }

  return twiml()
}
