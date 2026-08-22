import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { sendInvoiceCore } from './_shared/sendInvoiceCore.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Marks an invoice as sent and emails the customer -- see sendInvoiceCore.js
// for the Stripe link + email logic itself (shared with the contract-signing
// flow, which sends a deposit invoice the same way once a customer signs).
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const { invoiceId } = body
  if (!invoiceId) return json(400, { error: 'Missing invoiceId' })

  const { data: invoice, error: invErr } = await admin
    .from('invoices').select('*').eq('id', invoiceId).eq('org_id', orgId).maybeSingle()
  if (invErr) return json(500, { error: invErr.message })
  if (!invoice) return json(404, { error: 'Invoice not found.' })

  const result = await sendInvoiceCore({ invoice, orgId, event })
  if (!result.ok) return json(400, { error: result.error })
  return json(200, result)
}
