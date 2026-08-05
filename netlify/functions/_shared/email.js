import { admin } from './supabaseAdmin.js'
import { googleAccessToken, buildRaw, gmailSend } from './google.js'

// Sends a real email via Gmail and logs it into messages/conversations so it
// shows up in the inbox thread, same as any other outbound email.
export async function sendCustomerEmail({ orgId, to, subject, body, contactId, conversationId }) {
  const from = process.env.GMAIL_ADDRESS
  const at = await googleAccessToken()
  const sent = await gmailSend(at, buildRaw({ from, to, subject: subject || '(no subject)', body }))

  let convId = conversationId
  if (!convId) {
    let cId = contactId
    if (!cId) {
      const { data: c } = await admin
        .from('contacts')
        .select('id')
        .eq('org_id', orgId)
        .eq('email', String(to).toLowerCase())
        .maybeSingle()
      cId = c?.id
    }
    const { data: conv } = await admin
      .from('conversations')
      .upsert({ org_id: orgId, contact_id: cId, channel: 'email' }, { onConflict: 'org_id,contact_id,channel' })
      .select('id')
      .single()
    convId = conv.id
  }

  await admin.from('messages').insert({
    org_id: orgId,
    conversation_id: convId,
    direction: 'outbound',
    channel: 'email',
    body,
    from_addr: from,
    to_addr: to,
    provider: 'gmail',
    provider_msg_id: sent.id,
    status: 'sent',
  })
  await admin.from('conversations').update({ last_message_at: new Date().toISOString(), unread: false }).eq('id', convId)

  return { id: sent.id, conversationId: convId }
}
