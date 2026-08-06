import { admin } from './_shared/supabaseAdmin.js'
import { askClaude } from './_shared/anthropic.js'

const ORG_ID = process.env.ORG_ID || '11111111-1111-1111-1111-111111111111'

const REPLY_SYSTEM = `You are drafting an email reply on behalf of Ship2Shore, a TWIC-escorted vehicle pickup/delivery and port-access service.

You will be given the FULL conversation thread and the CURRENT STATUS OF THE CUSTOMER'S JOB ON FILE. Before drafting, actually use both:

1. Re-read the entire thread and the job status block first. Track everything the customer has already told you or that is already on file (BL/billing number, delivery order, cleared status, payment status, etc.).
2. NEVER ask for something that is already present anywhere in the thread OR already on file in the job status block -- re-reading it there means it was already provided, even if it was a few messages back.
3. If the customer's latest message provides information that was previously asked for, or the job status block shows something just became available (a BL/billing number, a delivery order, a confirmation), your reply MUST explicitly acknowledge receipt of that specific thing by name and state the concrete next step -- do not default to asking another question. Example: "Thank you -- got the delivery order for TWIC-18009207479. I'll be submitting this to NATSS for the gate pass and will update you once that's issued."
4. Only ask a question if the specific thing you'd ask for is genuinely absent from both the thread and the job status block.

Write a short, professional, friendly reply. Do not invent specific prices, dates, or commitments that aren't already in the thread or on file -- ask a clarifying question instead, but only for things actually missing per rule 4. Sign off as "Ship2Shore Dispatch". Output only the email body text, no subject line, no markdown.`

const QUALIFY_SYSTEM = `You summarize a brand-new inbound customer email in one concise sentence for a dispatcher's CRM notes: what service they appear to want (e.g. TWIC vehicle escort, port pickup/dropoff, which port if mentioned) and any other useful detail. Output only that one sentence, no preamble.`

// The job status the reply-drafting prompt is missing without this: whether
// a BL/billing number or delivery order is already on file, so the draft
// stops asking for things the customer (or dispatcher) already provided --
// possibly through a channel other than this email thread, like the
// delivery-order upload link, which the thread alone would never reveal.
async function fetchJobStatus(contactId) {
  const { data: opp } = await admin
    .from('opportunities')
    .select('title, bl_number, billing_number, cleared, paid, payment_status, stages(name)')
    .eq('contact_id', contactId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!opp) return 'No open job on file for this contact yet.'

  const { count: doCount } = await admin
    .from('attachments')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', contactId)
    .eq('kind', 'delivery_order')

  return [
    `Job: ${opp.title || '(untitled)'}`,
    `Stage: ${opp.stages?.name || 'unknown'}`,
    `BL/billing number on file: ${opp.bl_number || opp.billing_number || 'NOT yet provided'}`,
    `Delivery order on file: ${doCount > 0 ? 'Yes' : 'No'}`,
    `Customs cleared: ${opp.cleared ? 'Yes' : 'No'}`,
    `Payment status: ${opp.payment_status}`,
  ].join('\n')
}

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
      // Full thread, not just the latest few messages -- otherwise
      // something resolved earlier in a long thread (a BL number given on
      // message 2 of 12) drops out of context and gets asked for again.
      const { data: recent, error: msgErr } = await admin
        .from('messages')
        .select('id, direction, body, status, created_at')
        .eq('conversation_id', convo.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (msgErr || !recent || recent.length === 0) continue

      const latest = recent[0]
      if (latest.direction !== 'inbound') continue // customer isn't waiting on a reply

      const history = recent.slice().reverse()
        .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Ship2Shore'}: ${m.body}`)
        .join('\n\n')

      const jobStatus = await fetchJobStatus(convo.contact_id)

      let draftBody
      try {
        draftBody = await askClaude({
          system: REPLY_SYSTEM,
          prompt: `Current job status on file:\n${jobStatus}\n\nFull conversation thread so far:\n\n${history}\n\nDraft the reply to the customer's latest message.`,
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
