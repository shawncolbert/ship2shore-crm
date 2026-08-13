import { admin } from './supabaseAdmin.js'
import { orgGoogleAccessToken, buildRaw, gmailSend } from './google.js'

// Sends a real email via Gmail and logs it into messages/conversations so it
// shows up in the inbox thread, same as any other outbound email. Sends as
// the calling org's OWN connected Gmail account (orgGoogleAccessToken) --
// never a single global account, which would mean every org's payment
// requests/document requests went out under Ship2Shore's identity instead
// of their own.
export async function sendCustomerEmail({ orgId, to, subject, body, html, contactId, conversationId }) {
  const { accessToken: at, email: from } = await orgGoogleAccessToken(orgId, admin)
  const sent = await gmailSend(at, buildRaw({ from, to, subject: subject || '(no subject)', body, html }))

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
