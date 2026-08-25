import { admin } from './_shared/supabaseAdmin.js'
import { askClaude } from './_shared/anthropic.js'

// Scheduled daily. Drafts (never sends) milestone messages for photography
// jobs -- wedding countdown reminders and real-estate turnaround check-ins --
// the same "AI drafts it into the Inbox, a human reviews and sends" pattern
// ai-draft-reply.js already uses, so there's no second review queue to build
// or learn. Runs across any org with project_type set on a job, not
// hardcoded to one tenant, same reasoning as invoice-reminders.js. Each of
// the four checks below is idempotent via its own *_drafted_at column, so a
// retry or a slow invocation never drafts the same message twice.

const DAY_MS = 86400000
const daysUntil = (iso) => iso ? Math.floor((new Date(iso).getTime() - Date.now()) / DAY_MS) : null
const daysSince = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS) : null

async function draftMessage({ orgId, contactId, subjectContext, systemPrompt, userPrompt, fromAddrCache }) {
  let body
  try {
    body = await askClaude({ system: systemPrompt, prompt: userPrompt, maxTokens: 400 })
  } catch {
    return false
  }
  if (!body) return false

  const { data: contact } = await admin.from('contacts').select('email').eq('id', contactId).maybeSingle()
  if (!contact?.email) return false

  let { data: convo } = await admin
    .from('conversations').select('id').eq('org_id', orgId).eq('contact_id', contactId).eq('channel', 'email').maybeSingle()
  if (!convo) {
    const { data: created, error } = await admin
      .from('conversations').insert({ org_id: orgId, contact_id: contactId, channel: 'email' }).select('id').single()
    if (error) return false
    convo = created
  }

  if (!fromAddrCache.has(orgId)) {
    const { data: gmailRow } = await admin.from('gmail_oauth_tokens').select('email').eq('org_id', orgId).maybeSingle()
    fromAddrCache.set(orgId, gmailRow?.email || null)
  }

  await admin.from('messages').insert({
    org_id: orgId,
    conversation_id: convo.id,
    direction: 'outbound',
    channel: 'email',
    body,
    from_addr: fromAddrCache.get(orgId),
    to_addr: contact.email,
    provider: 'gmail',
    ai_generated: true,
    status: 'draft',
  })
  return true
}

export const handler = async () => {
  const { data: jobs, error } = await admin
    .from('opportunities')
    .select('id, org_id, contact_id, title, scheduled_at, shot_completed_at, gallery_link, project_type, custom_fields, shot_checkin_drafted_at, gallery_delivery_drafted_at, wedding_reminder_60d_drafted_at, wedding_reminder_14d_drafted_at, contacts(full_name)')
    .not('project_type', 'is', null)
    .neq('status', 'cancelled')
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) }

  let drafted = 0
  const orgNameCache = new Map()
  const fromAddrCache = new Map()
  const orgName = async (orgId) => {
    if (!orgNameCache.has(orgId)) {
      const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).maybeSingle()
      orgNameCache.set(orgId, org?.name || 'the studio')
    }
    return orgNameCache.get(orgId)
  }

  for (const job of jobs || []) {
    const clientName = job.contacts?.full_name || 'there'
    const oName = await orgName(job.org_id)

    // Real estate: 24 hours after the shoot, a warm check-in + turnaround-time note.
    if (job.project_type === 'real_estate' && job.shot_completed_at && !job.shot_checkin_drafted_at) {
      if (daysSince(job.shot_completed_at) >= 1) {
        const ok = await draftMessage({
          orgId: job.org_id, contactId: job.contact_id, fromAddrCache,
          systemPrompt: `You draft a short, warm follow-up email from ${oName} to a real estate agent client, one day after their listing photo shoot. Thank them, confirm images are being processed, and give a general (not overly specific) sense that a gallery is coming soon. Under 100 words. Plain text, no markdown, no subject line, just the email body. Sign off with the studio name.`,
          userPrompt: `Client: ${clientName}. Property: ${job.title || 'the listing'}.`,
        })
        if (ok) { await admin.from('opportunities').update({ shot_checkin_drafted_at: new Date().toISOString() }).eq('id', job.id); drafted++ }
      }
    }

    // Real estate: gallery link just added -- draft the delivery email.
    if (job.project_type === 'real_estate' && job.gallery_link && !job.gallery_delivery_drafted_at) {
      const ok = await draftMessage({
        orgId: job.org_id, contactId: job.contact_id, fromAddrCache,
        systemPrompt: `You draft a short, professional delivery email from ${oName} to a real estate agent client whose listing photo gallery is ready. Include the gallery link exactly as given, thank them, and mention they're welcome to reach out with any questions. Under 100 words. Plain text, no markdown, no subject line, just the email body. Sign off with the studio name.`,
        userPrompt: `Client: ${clientName}. Property: ${job.title || 'the listing'}. Gallery link: ${job.gallery_link}`,
      })
      if (ok) { await admin.from('opportunities').update({ gallery_delivery_drafted_at: new Date().toISOString() }).eq('id', job.id); drafted++ }
    }

    // Wedding: T-minus 60 days -- payment/questionnaire reminder.
    if (job.project_type === 'wedding' && !job.wedding_reminder_60d_drafted_at) {
      const d = daysUntil(job.scheduled_at)
      if (d !== null && d <= 60 && d >= 0) {
        const ok = await draftMessage({
          orgId: job.org_id, contactId: job.contact_id, fromAddrCache,
          systemPrompt: `You draft a short, friendly email from ${oName} to a couple whose wedding is 60 days away. Remind them (gently, not pushy) about any remaining balance/payment and their wedding-day questionnaire, so details are locked in well ahead of time. Under 110 words. Plain text, no markdown, no subject line, just the email body. Sign off with the studio name.`,
          userPrompt: `Couple: ${clientName}. Wedding: ${job.title || 'their wedding'}${job.custom_fields?.venue ? `, venue ${job.custom_fields.venue}` : ''}.`,
        })
        if (ok) { await admin.from('opportunities').update({ wedding_reminder_60d_drafted_at: new Date().toISOString() }).eq('id', job.id); drafted++ }
      }
    }

    // Wedding: T-minus 14 days -- shot list check-in.
    if (job.project_type === 'wedding' && !job.wedding_reminder_14d_drafted_at) {
      const d = daysUntil(job.scheduled_at)
      if (d !== null && d <= 14 && d >= 0) {
        const ok = await draftMessage({
          orgId: job.org_id, contactId: job.contact_id, fromAddrCache,
          systemPrompt: `You draft a short, warm email from ${oName} to a couple two weeks out from their wedding. Ask if they have a shot list or any must-have photos/family groupings they want captured, and confirm the timeline is still on track. Under 110 words. Plain text, no markdown, no subject line, just the email body. Sign off with the studio name.`,
          userPrompt: `Couple: ${clientName}. Wedding: ${job.title || 'their wedding'}${job.custom_fields?.venue ? `, venue ${job.custom_fields.venue}` : ''}.`,
        })
        if (ok) { await admin.from('opportunities').update({ wedding_reminder_14d_drafted_at: new Date().toISOString() }).eq('id', job.id); drafted++ }
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, checked: jobs?.length || 0, drafted }) }
}
