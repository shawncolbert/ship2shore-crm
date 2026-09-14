import { admin } from './_shared/supabaseAdmin.js'

const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt-out'])

const twiml = () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/xml' },
  body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
})

// Public, unauthenticated by necessity -- this is Twilio's own webhook URL,
// called directly by Twilio's platform on every inbound SMS to one of our
// orgs' numbers. Twilio itself already intercepts STOP at the carrier level
// for most numbers, but we don't rely on that -- do_not_contact is the one
// source of truth every send checks, so a STOP has to land there regardless
// of what Twilio does on its side.
export const handler = async (event) => {
  const params = new URLSearchParams(event.body || '')
  const from = params.get('From')
  const to = params.get('To')
  const body = (params.get('Body') || '').trim()
  if (!from || !to) return twiml()

  const { data: org } = await admin
    .from('organizations').select('id').eq('twilio_phone_number', to).maybeSingle()
  if (!org) return twiml()

  const isStop = STOP_WORDS.has(body.toLowerCase())

  if (isStop) {
    const { data: already } = await admin
      .from('do_not_contact').select('id').eq('org_id', org.id).eq('phone', from).maybeSingle()
    if (!already) {
      await admin.from('do_not_contact').insert({ org_id: org.id, phone: from, reason: 'sms_stop' })
    }
    const { data: matched } = await admin
      .from('prospects').update({ status: 'do_not_contact' }).eq('org_id', org.id).eq('phone', from).select('id')
    const prospectIds = (matched || []).map((p) => p.id)
    if (prospectIds.length) {
      await admin.from('outreach_enrollments').update({ status: 'stopped' }).eq('org_id', org.id).in('prospect_id', prospectIds)
    }
    return twiml()
  }

  // Any other reply opens the gate: SMS sequence steps only ever fire
  // once a prospect has replied, so this is what lets a queued SMS step
  // actually send instead of skipping forever.
  await admin.from('prospects').update({ status: 'replied' }).eq('org_id', org.id).eq('phone', from)

  return twiml()
}
