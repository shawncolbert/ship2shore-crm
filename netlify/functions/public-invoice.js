import { admin } from './_shared/supabaseAdmin.js'
import { resolveInvoicePaymentOptions } from './_shared/invoicePaymentOptions.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Public, unauthenticated invoice page -- the customer clicks a link from
// their email, no CRM login involved. Reads via the service-role client
// (invoices/invoice_line_items RLS is org-members-only) but only ever
// returns exactly the fields the customer-facing preview needs -- never
// internal notes about other jobs, other invoices, or anything else in the
// org's account.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { id } = payload
  if (!id) return json(400, { error: 'Missing invoice id' })

  const { data: invoice, error: invErr } = await admin
    .from('invoices')
    .select('id, org_id, invoice_number, po_number, bill_to_name, bill_to_address, bill_to_phone, bill_to_email, ship_to_name, ship_to_address, ship_to_phone, invoice_date, due_date, status, notes, subtotal, total, amount_due, wave_checkout_url, payment_options, paid_at, payment_method')
    .eq('id', id)
    .maybeSingle()
  if (invErr) return json(500, { error: invErr.message })
  if (!invoice) return json(404, { error: 'Invoice not found.' })

  const [{ data: lineItems }, { data: org }, { data: paymentSettings }] = await Promise.all([
    admin.from('invoice_line_items').select('description, quantity, unit_price').eq('invoice_id', id).order('sort_order', { ascending: true }),
    admin.from('organizations').select('name, logo_url, invoice_business_name, invoice_business_address, invoice_business_phone, invoice_business_website').eq('id', invoice.org_id).maybeSingle(),
    admin.from('payment_settings').select('*').eq('org_id', invoice.org_id).maybeSingle(),
  ])

  const paymentOptions = resolveInvoicePaymentOptions({ invoice, paymentSettings })

  const { org_id, payment_options, ...publicInvoice } = invoice
  return json(200, {
    invoice: publicInvoice,
    lineItems: lineItems || [],
    businessInfo: org || null,
    paymentOptions,
  })
}
