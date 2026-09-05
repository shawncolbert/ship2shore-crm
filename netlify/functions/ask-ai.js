import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { askClaude } from './_shared/anthropic.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Same locked-rule shape as ai-draft-reply.js's REPLY_SYSTEM -- this widget
// is a second, deliberately lower-privilege surface (floating on every
// page, draft-only) next to the full-page /agent assistant, which can
// already create/update/send for real. Ask AI never does; these rules are
// what keep it that way regardless of how the question is worded.
const GUARDRAILS = `You are "Ask AI", a read-only assistant embedded in ${'{orgName}'}'s dispatch CRM.

Locked rules, not suggestions:
1. You can only report and draft. NEVER state or imply that an action was taken -- you did not send an email, move a pipeline stage, create an invoice, or confirm a booking, even if asked to. If asked to do one of those, say you can draft it for a human to review and send/approve, not that it's done.
2. NEVER guess at a fact that isn't in the data given to you -- driver availability, whether a truck is free, an ETA, a price. If it's not in the data below, say plainly that it isn't known and suggest checking Pipeline/Dispatch directly, rather than inventing an answer that sounds helpful.
3. State numbers exactly as given in the data -- don't round in a way that changes the meaning, don't estimate a total that isn't already computed for you.
4. Keep answers short and direct -- this is a small floating chat panel, not a report.`

function orgSystemPrompt(orgName) {
  return GUARDRAILS.replace('{orgName}', orgName || 'this organization')
}

// -- Data-question mode -------------------------------------------------

function startOfRollingWeek() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
}

// Cheap baseline every question gets, regardless of what it's actually
// asking -- keeps the answer grounded even when the keyword match below
// misses, and costs three small indexed queries.
async function fetchSnapshot(orgId) {
  const since = startOfRollingWeek()

  const [{ count: newLeads }, { data: stageRows }, { data: invoiceRows }] = await Promise.all([
    admin.from('contacts').select('id', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', since),
    admin.from('opportunities')
      .select('value, stages(name)')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .neq('status', 'cancelled'),
    admin.from('invoices')
      .select('invoice_number, bill_to_name, amount_due, due_date, contacts(full_name)')
      .eq('org_id', orgId)
      .neq('status', 'paid')
      .order('due_date', { ascending: true }),
  ])

  const byStage = new Map()
  for (const row of stageRows || []) {
    const name = row.stages?.name || 'Unknown'
    const cur = byStage.get(name) || { count: 0, value: 0 }
    cur.count += 1
    cur.value += Number(row.value) || 0
    byStage.set(name, cur)
  }
  const pipelineLines = [...byStage.entries()]
    .map(([name, { count, value }]) => `  - ${name}: ${count} job${count === 1 ? '' : 's'}, $${value.toLocaleString()} total value`)
    .join('\n') || '  (no open jobs)'

  const today = new Date().toISOString().slice(0, 10)
  const unpaid = invoiceRows || []
  const overdue = unpaid.filter((i) => i.due_date && i.due_date < today)
  const totalDue = unpaid.reduce((sum, i) => sum + (Number(i.amount_due) || 0), 0)
  const invoiceLines = unpaid.slice(0, 8)
    .map((i) => `  - ${i.invoice_number || '(no number)'} -- ${i.contacts?.full_name || i.bill_to_name || 'unknown'}: $${Number(i.amount_due || 0).toLocaleString()} due ${i.due_date || 'no due date set'}${i.due_date && i.due_date < today ? ' (OVERDUE)' : ''}`)
    .join('\n') || '  (none unpaid)'

  return [
    `New leads in the last 7 days: ${newLeads ?? 0}`,
    '',
    'Pipeline, by stage (excludes cancelled/completed jobs):',
    pipelineLines,
    '',
    `Unpaid invoices: ${unpaid.length} totaling $${totalDue.toLocaleString()} (${overdue.length} overdue)`,
    invoiceLines,
  ].join('\n')
}

// "Lightweight intent matching" per the brief -- a few keyword buckets
// deciding which EXTRA, more specific query to run on top of the snapshot
// above, not a classifier. Good enough for a floating Q&A widget; a real
// intent model would be overkill for what's a handful of query shapes.
async function fetchIntentExtra(orgId, question) {
  const q = question.toLowerCase()

  if (/\bbook|schedul|upcoming|this week|today|tomorrow\b/.test(q)) {
    const since = startOfRollingWeek()
    const { data } = await admin
      .from('opportunities')
      .select('title, scheduled_at, created_at, contacts(full_name), stages(name)')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .neq('status', 'cancelled')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10)
    if (!data?.length) return null
    return 'Recent jobs (created in the last 7 days):\n' + data
      .map((o) => `  - ${o.title || '(untitled)'} -- ${o.contacts?.full_name || 'unknown contact'}, stage: ${o.stages?.name || 'unknown'}${o.scheduled_at ? `, scheduled ${new Date(o.scheduled_at).toDateString()}` : ''}`)
      .join('\n')
  }

  return null
}

async function handleDataQuestion({ orgId, orgName, question }) {
  const [snapshot, extra] = await Promise.all([
    fetchSnapshot(orgId),
    fetchIntentExtra(orgId, question),
  ])

  const context = extra ? `${snapshot}\n\n${extra}` : snapshot

  const answer = await askClaude({
    system: orgSystemPrompt(orgName),
    prompt: `Current CRM data snapshot:\n\n${context}\n\nDispatcher's question: ${question}\n\nAnswer using only the data above.`,
    maxTokens: 400,
  })

  return { answer, isDraft: false }
}

// -- Contact-context mode -------------------------------------------------

const DRAFT_INTENT = /\bdraft|write|follow.?up|reply|respond|email them|message them|send them\b/i

async function fetchContactContext(orgId, contactId) {
  const { data: contact } = await admin
    .from('contacts')
    .select('id, full_name, email, phone, notes, segment')
    .eq('id', contactId)
    .eq('org_id', orgId) // admin client bypasses RLS -- this check IS the tenant boundary here
    .maybeSingle()
  if (!contact) return null

  const { data: opp } = await admin
    .from('opportunities')
    .select('title, value, confirmed_price, bl_number, billing_number, scheduled_at, payment_status, stages(name)')
    .eq('contact_id', contactId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: invoices } = await admin
    .from('invoices')
    .select('invoice_number, status, amount_due, due_date')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(5)

  // Full thread, same reasoning as ai-draft-reply.js's fetchJobStatus: something
  // resolved early in a long thread shouldn't drop out of context here either.
  const { data: convo } = await admin
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('channel', 'email')
    .maybeSingle()
  let thread = 'No email thread on file for this contact.'
  if (convo) {
    const { data: messages } = await admin
      .from('messages')
      .select('direction, body, created_at')
      .eq('conversation_id', convo.id)
      .order('created_at', { ascending: false })
      .limit(30)
    if (messages?.length) {
      thread = messages.slice().reverse()
        .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Us'}: ${m.body}`)
        .join('\n\n')
    }
  }

  const quote = opp?.confirmed_price ?? opp?.value
  const jobStatus = opp
    ? [
        `Job: ${opp.title || '(untitled)'}`,
        `Stage: ${opp.stages?.name || 'unknown'}`,
        `BL/billing number on file: ${opp.bl_number || opp.billing_number || 'NOT yet provided'}`,
        `Payment status: ${opp.payment_status || 'unknown'}`,
        `Quote on file: ${quote ? `$${Number(quote).toFixed(2)}` : 'NOT yet set -- do not state a price'}`,
        `Scheduled date on file: ${opp.scheduled_at ? new Date(opp.scheduled_at).toDateString() : 'NOT yet set -- do not state an ETA'}`,
      ].join('\n')
    : 'No open job on file for this contact.'

  const invoiceLines = (invoices || []).length
    ? invoices.map((i) => `  - ${i.invoice_number || '(no number)'}: ${i.status}, $${Number(i.amount_due || 0).toLocaleString()} due${i.due_date ? ` ${i.due_date}` : ''}`).join('\n')
    : '  (no invoices on file)'

  return {
    contact,
    text: [
      `Contact: ${contact.full_name || '(no name on file)'}${contact.segment ? ` (${contact.segment})` : ''}`,
      `Email: ${contact.email || 'none on file'} · Phone: ${contact.phone || 'none on file'}`,
      contact.notes ? `Notes: ${contact.notes}` : null,
      '',
      jobStatus,
      '',
      'Invoices:',
      invoiceLines,
      '',
      'Email thread:',
      thread,
    ].filter(Boolean).join('\n'),
  }
}

async function handleContactQuestion({ orgId, orgName, contactId, question }) {
  const ctx = await fetchContactContext(orgId, contactId)
  if (!ctx) return { error: 'Contact not found for this organization.', status: 404 }

  const isDraft = DRAFT_INTENT.test(question)

  const system = isDraft
    ? `${orgSystemPrompt(orgName)}\n\nYou are drafting a suggested reply for a human to review and send themselves -- you are not sending it. Never invent a price, date, or BL/billing number that isn't already on file below; ask a clarifying question in the draft instead if something is genuinely missing. Output only the message body, no subject line, no preamble like "Here's a draft:".`
    : `${orgSystemPrompt(orgName)}\n\nAnswer the dispatcher's question about this one contact using only the information below.`

  const answer = await askClaude({
    system,
    prompt: `${ctx.text}\n\n${isDraft ? 'Request' : 'Question'}: ${question}`,
    maxTokens: 500,
  })

  return { answer, isDraft }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const question = String(body.question || '').trim()
  const contactId = body.contactId || null
  if (!question) return json(400, { error: 'question is required' })

  // orgId always comes from the authenticated session above, never from the
  // client -- the brief's input shape includes orgId, but trusting a
  // client-supplied tenant id is exactly the class of bug that caused the
  // old global Telegram/Gmail cross-tenant leaks earlier in this CRM's
  // history. This widget derives it the same way every other function here does.
  try {
    const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).maybeSingle()
    const orgName = org?.name || 'Dispatch'

    const result = contactId
      ? await handleContactQuestion({ orgId, orgName, contactId, question })
      : await handleDataQuestion({ orgId, orgName, question })

    if (result.error) return json(result.status || 400, { error: result.error })
    return json(200, { answer: result.answer, isDraft: result.isDraft })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
