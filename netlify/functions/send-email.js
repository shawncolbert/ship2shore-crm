import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { googleAccessToken, buildRaw, gmailSend } from './_shared/google.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const org = await orgForUser(user.id)
  if (!org) return json(403, { error: 'No org membership' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { conversationId, contactId, to, subject, body } = payload
  if (!to || !body) return json(400, { error: 'Missing "to" or "body"' })

  const from = process.env.GMAIL_ADDRESS
  try {
    const at = await googleAccessToken()
    const sent = await gmailSend(at, buildRaw({ from, to, subject: subject || '(no subject)', body }))

    let convId = conversationId
    if (!convId) {
      let cId = contactId
      if (!cId) {
        const { data: c } = await admin.from('contacts')
          .select('id').eq('org_id', org).eq('email', String(to).toLowerCase()).maybeSingle()
        cId = c?.id
      }
      const { data: conv } = await admin.from('conversations')
        .upsert({ org_id: org, contact_id: cId, channel: 'email' }, { onConflict: 'org_id,contact_id,channel' })
        .select('id').single()
      convId = conv.id
    }

    await admin.from('messages').insert({
      org_id: org, conversation_id: convId, direction: 'outbound', channel: 'email',
      body, from_addr: from, to_addr: to, provider: 'gmail', provider_msg_id: sent.id, status: 'sent',
    })
    await admin.from('conversations')
      .update({ last_message_at: new Date().toISOString(), unread: false }).eq('id', convId)

    return json(200, { ok: true, id: sent.id, conversationId: convId })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
