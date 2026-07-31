import { admin } from './_shared/supabaseAdmin.js'
import { askClaude } from './_shared/anthropic.js'

const ORG_ID = process.env.ORG_ID || '11111111-1111-1111-1111-111111111111'

const REPLY_SYSTEM = `You are drafting an email reply on behalf of Ship2Shore, a TWIC-escorted vehicle pickup/delivery and port-access service. Write a short, professional, friendly reply to the customer's latest message, using the prior thread for context. Do not invent specific prices, dates, or commitments that aren't already in the thread -- ask a clarifying question instead if something is missing. Sign off as "Ship2Shore Dispatch". Output only the email body text, no subject line, no markdown.`

const QUALIFY_SYSTEM = `You summarize a brand-new inbound customer email in one concise sentence for a dispatcher's CRM notes: what service they appear to want (e.g. TWIC vehicle escort, port pickup/dropoff, which port if mentioned) and any other useful detail. Output only that one sentence, no preamble.`

// Scheduled: for every email conversation where the customer sent the last
// message, draft (never send) a suggested reply for a human to review. Also
// suggests a one-line lead-qualification note on a contact's very first
// inbound message, if they don't already have one. Never touches
// opportunities or stages -- suggestion only, everywhere.
export const handler = async () => {
  try {
    const { data: convos, error: convErr } = await admin
      .from('conversations')
      .select('id, contact_id, contacts(email, notes)')
      .eq('org_id', ORG_ID)
      .eq('channel', 'email')
    if (convErr) throw convErr

    let drafted = 0
    let qualified = 0

    for (const convo of convos || []) {
      const { data: recent, error: msgErr } = await admin
        .from('messages')
        .select('id, direction, body, status, created_at')
        .eq('conversation_id', convo.id)
        .order('created_at', { ascending: false })
        .limit(8)
      if (msgErr || !recent || recent.length === 0) continue

      const latest = recent[0]
      if (latest.direction !== 'inbound') continue // customer isn't waiting on a reply

      const history = recent.slice().reverse()
        .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Ship2Shore'}: ${m.body}`)
        .join('\n\n')

      let draftBody
      try {
        draftBody = await askClaude({
          system: REPLY_SYSTEM,
          prompt: `Thread so far:\n\n${history}\n\nDraft the reply to the customer's latest message.`,
        })
      } catch {
        continue // skip this conversation this run rather than fail the whole batch
      }
      if (!draftBody) continue

      // Only one live draft per conversation at a time.
      await admin.from('messages').delete().eq('conversation_id', convo.id).eq('status', 'draft')

      await admin.from('messages').insert({
        org_id: ORG_ID,
        conversation_id: convo.id,
        direction: 'outbound',
        channel: 'email',
        body: draftBody,
        from_addr: process.env.GMAIL_ADDRESS || null,
        to_addr: convo.contacts?.email || null,
        provider: 'gmail',
        ai_generated: true,
        status: 'draft',
      })
      drafted++

      // First-ever inbound message from this contact, and no notes yet --
      // suggest a lead-qualification note (never enforced/overwritten).
      if (recent.length === 1 && !convo.contacts?.notes) {
        try {
          const note = await askClaude({ system: QUALIFY_SYSTEM, prompt: latest.body || '', maxTokens: 150 })
          if (note) {
            await admin.from('contacts')
              .update({ notes: `[AI suggested] ${note}` })
              .eq('id', convo.contact_id)
              .is('notes', null)
            qualified++
          }
        } catch {
          // qualification note is a nice-to-have; a failure here shouldn't block drafting
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, conversations: convos?.length || 0, drafted, qualified }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e.message || e) }) }
  }
}
