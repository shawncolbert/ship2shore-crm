import { admin } from './supabaseAdmin.js'
import { orgGoogleAccessToken, buildRaw, gmailSend } from './google.js'

// Deliberately separate from _shared/email.js's sendCustomerEmail -- a
// prospect isn't a customer, and mixing cold outreach into the org's own
// support Inbox thread view (which sendCustomerEmail also writes to) would
// bury real customer conversations under prospecting noise. This only ever
// sends and returns; nothing gets logged to messages/conversations. The
// caller (outreach-sequence-sender.js) is what writes the actual audit
// trail, to outreach_sends.
//
// CAN-SPAM by construction: every send gets an unsubscribe link and the
// org's own physical business address appended, using fields
// (invoice_business_name/invoice_business_address) that already exist on
// organizations for invoicing -- no new setup step for the org.
export async function sendOutreachEmail({ orgId, to, subject, body, unsubscribeToken }) {
  const { data: org } = await admin
    .from('organizations')
    .select('name, invoice_business_name, invoice_business_address')
    .eq('id', orgId)
    .maybeSingle()

  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || ''
  const unsubscribeUrl = `${siteUrl}/.netlify/functions/outreach-unsubscribe?token=${unsubscribeToken}`
  const businessName = org?.invoice_business_name || org?.name || ''
  const address = org?.invoice_business_address || ''

  const footerLines = [
    '',
    '---',
    [businessName, address].filter(Boolean).join(' — '),
    `Don't want to hear from us again? Unsubscribe: ${unsubscribeUrl}`,
  ].filter(Boolean)
  const fullBody = `${body}\n${footerLines.join('\n')}`

  const { accessToken: at, email: from } = await orgGoogleAccessToken(orgId, admin)
  const sent = await gmailSend(at, buildRaw({ from, to, subject, body: fullBody }))
  return { id: sent.id }
}
