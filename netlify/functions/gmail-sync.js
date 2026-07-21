import { admin } from './_shared/supabaseAdmin.js'
import {
  googleAccessToken, gmailList, gmailGet, headerVal, emailFrom, extractText,
} from './_shared/google.js'

// Scheduled: pulls recent Gmail messages to/from known contacts into the inbox.
export const handler = async () => {
  const org = process.env.ORG_ID || '11111111-1111-1111-1111-111111111111'
  const owner = (process.env.GMAIL_ADDRESS || '').toLowerCase()

  try {
    const at = await googleAccessToken()
    const ids = await gmailList(at, 'newer_than:2d -in:chats', 100)

    const { data: contacts } = await admin
      .from('contacts').select('id, email').eq('org_id', org).not('email', 'is', null)
    const byEmail = new Map((contacts || []).map((c) => [c.email.toLowerCase(), c.id]))

    let added = 0
    for (const { id } of ids) {
      const { data: exists } = await admin
        .from('messages').select('id').eq('provider_msg_id', id).limit(1).maybeSingle()
      if (exists) continue

      const msg = await gmailGet(at, id)
      const from = emailFrom(headerVal(msg.payload, 'From'))
      const to = emailFrom(headerVal(msg.payload, 'To'))
      const dateHdr = headerVal(msg.payload, 'Date')
      const when = dateHdr ? new Date(dateHdr).toISOString() : new Date().toISOString()

      const inbound = from !== owner
      const contactEmail = inbound ? from : to
      const contactId = byEmail.get(contactEmail)
      if (!contactId) continue // v1: only sync threads with known contacts

      const body = (extractText(msg.payload) || msg.snippet || '').slice(0, 8000)

      const { data: conv } = await admin.from('conversations')
        .upsert({ org_id: org, contact_id: contactId, channel: 'email' }, { onConflict: 'org_id,contact_id,channel' })
        .select('id').single()

      await admin.from('messages').insert({
        org_id: org, conversation_id: conv.id, direction: inbound ? 'inbound' : 'outbound',
        channel: 'email', body, from_addr: from, to_addr: to,
        provider: 'gmail', provider_msg_id: id, status: 'received', created_at: when,
      })
      await admin.from('conversations')
        .update({ last_message_at: when, unread: inbound }).eq('id', conv.id)
      added++
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, scanned: ids.length, added }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e.message || e) }) }
  }
}
