import { admin } from './_shared/supabaseAdmin.js'
import { sendCustomerEmail } from './_shared/email.js'

// Runs daily (see netlify.toml). Every job that's reached Delivered (or
// past it -- Invoiced/Paid -- for anything that got there before this
// automation existed) and hasn't had a review-request email yet gets one:
// thank the customer, ask for a Google review if the org has a link set
// (Settings > Appearance), and ask for a referral. Marks
// review_request_sent_at so it never sends twice, even if a job sits in
// Delivered for weeks before moving to Paid.
export const handler = async () => {
  const { data: orgs, error: orgErr } = await admin.from('organizations').select('id, name, google_review_link')
  if (orgErr) { console.error('❌ send-review-requests: could not list orgs:', orgErr); return { statusCode: 200, body: 'ok' } }

  for (const org of orgs || []) {
    try {
      await sendForOrg(org)
    } catch (e) {
      console.error(`❌ send-review-requests failed for org ${org.id}:`, e)
    }
  }
  return { statusCode: 200, body: 'ok' }
}

async function sendForOrg(org) {
  const { data: stages } = await admin
    .from('stages').select('id, name, pipeline_id, position')
    .in('name', ['Delivered', 'Invoiced', 'Paid'])
  const deliveredOrLaterIds = (stages || []).map((s) => s.id)
  if (!deliveredOrLaterIds.length) return

  const { data: jobs, error: jobsErr } = await admin
    .from('opportunities')
    .select('id, title, contact_id, contacts!opportunities_contact_id_fkey(full_name, email)')
    .eq('org_id', org.id)
    .in('stage_id', deliveredOrLaterIds)
    .neq('status', 'cancelled')
    .is('review_request_sent_at', null)
  if (jobsErr) { console.error('❌ send-review-requests: could not list jobs:', jobsErr); return }

  for (const job of jobs || []) {
    const email = job.contacts?.email
    if (!email) continue // no email on file -- nothing to send, leave it for a manual ask

    const reviewLine = org.google_review_link
      ? `If you have a minute, a Google review really helps us out: ${org.google_review_link}`
      : null
    const body = [
      `Hi ${job.contacts?.full_name || 'there'},`,
      '',
      `Thanks again for trusting ${org.name || 'us'} with your vehicle. We hope everything went smoothly!`,
      reviewLine,
      '',
      "If you know anyone else who needs vehicle transport or a port escort, we'd really appreciate the referral.",
      '',
      'Thanks,',
      org.name || 'The team',
    ].filter(Boolean).join('\n')

    try {
      await sendCustomerEmail({
        orgId: org.id, to: email, subject: `How did we do?${job.title ? ` — ${job.title}` : ''}`,
        body, contactId: job.contact_id,
      })
      await admin.from('opportunities').update({ review_request_sent_at: new Date().toISOString() }).eq('id', job.id)
    } catch (e) {
      console.error(`❌ send-review-requests: email failed for job ${job.id}:`, e)
    }
  }
}
