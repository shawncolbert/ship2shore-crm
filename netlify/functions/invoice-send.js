import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { sendCustomerEmail } from './_shared/email.js'
import { resolveInvoicePaymentOptions, buildInvoicePaymentOptionsHtml } from './_shared/invoicePaymentOptions.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function siteOrigin(event) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`
}

// Stripe's API is form-encoded, not JSON -- URLSearchParams handles the
// bracket-notation nested keys fine as long as they're built as flat
// "line_items[0][price_data][currency]"-style strings.
async function createStripePaymentLink({ invoice, publicUrl }) {
  const cents = Math.round(Number(invoice.total) * 100)
  const params = new URLSearchParams()
  params.set('line_items[0][price_data][currency]', 'usd')
  params.set('line_items[0][price_data][unit_amount]', String(cents))
  params.set('line_items[0][price_data][product_data][name]', `Invoice ${invoice.invoice_number}`)
  params.set('line_items[0][quantity]', '1')
  params.set('metadata[invoice_id]', invoice.id)
  params.set('after_completion[type]', 'redirect')
  params.set('after_completion[redirect][url]', publicUrl)

  const res = await fetch('https://api.stripe.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })
  const data = await res.json()
  if (!res.ok) throw new Error('Stripe error: ' + (data.error?.message || JSON.stringify(data)))
  return { id: data.id, url: data.url }
}

function invoiceEmailHtml({ invoice, publicUrl, paymentOptions }) {
  const money = (n) => `$${Number(n || 0).toFixed(2)}`
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <p>You have a new invoice: <strong>${invoice.invoice_number}</strong></p>
      <p>Amount due: <strong>${money(invoice.amount_due)}</strong>${invoice.due_date ? ` — due ${invoice.due_date}` : ''}</p>
      ${buildInvoicePaymentOptionsHtml(paymentOptions, invoice.amount_due)}
      <p style="margin:20px 0 4px;font-size:13px;color:#666;">
        ${paymentOptions.length ? 'Or view' : 'View'} the full invoice any time: <a href="${publicUrl}">${publicUrl}</a>
      </p>
    </div>
  `
}

// Marks an invoice as sent, generates a live Stripe payment link if Stripe
// is configured for this deployment (STRIPE_SECRET_KEY) and enabled for this
// invoice, and emails the customer from the org's own connected Gmail
// account with whichever payment options (Stripe, a pasted Wave Checkout
// link, and/or the org's Zelle/Venmo/Cash App/Apple Pay handles) were
// checked on this invoice. None of these are required -- a not-yet-connected
// Stripe account, or an invoice with every option unchecked, never blocks
// sending; the customer just gets a plain "View Invoice" link instead, and
// the caller (InvoiceDetail.jsx) makes that state clearly visible, never a
// silent gap.
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
  if (!invoice.bill_to_email) return json(400, { error: 'Bill To email is required to send an invoice.' })

  const publicUrl = `${siteOrigin(event)}/invoice/${invoice.id}`
  const stripeWanted = invoice.payment_options?.stripe !== false
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY)

  let stripeUrl = invoice.stripe_payment_link_url || null
  let paymentLinkId = invoice.stripe_payment_link_id || null
  if (stripeWanted && stripeConfigured) {
    try {
      const link = await createStripePaymentLink({ invoice, publicUrl })
      stripeUrl = link.url
      paymentLinkId = link.id
    } catch (e) {
      // A Stripe hiccup shouldn't block sending the invoice itself --
      // the customer still gets a valid "View Invoice" link either way.
      stripeUrl = null
    }
  } else if (!stripeWanted) {
    stripeUrl = null
  }

  const { error: updErr } = await admin.from('invoices').update({
    status: invoice.status === 'paid' ? 'paid' : 'sent',
    sent_at: new Date().toISOString(),
    stripe_payment_link_url: stripeUrl,
    stripe_payment_link_id: paymentLinkId,
    updated_at: new Date().toISOString(),
  }).eq('id', invoice.id)
  if (updErr) return json(500, { error: updErr.message })

  const { data: paymentSettings } = await admin
    .from('payment_settings').select('*').eq('org_id', orgId).maybeSingle()
  const paymentOptions = resolveInvoicePaymentOptions({ invoice: { ...invoice, stripe_payment_link_url: stripeUrl }, paymentSettings, stripeUrl })

  let emailSent = false
  let emailError = null
  try {
    await sendCustomerEmail({
      orgId,
      to: invoice.bill_to_email,
      subject: `Invoice ${invoice.invoice_number} — ${Number(invoice.amount_due).toFixed(2)} due`,
      body: `You have a new invoice (${invoice.invoice_number}). View it here: ${publicUrl}`,
      html: invoiceEmailHtml({ invoice, publicUrl, paymentOptions }),
      contactId: invoice.contact_id,
    })
    emailSent = true
  } catch (e) {
    emailError = String(e.message || e)
  }

  return json(200, {
    ok: true, status: 'sent',
    stripeConfigured: stripeWanted && stripeConfigured && Boolean(stripeUrl),
    paymentOptionsSent: paymentOptions.map((o) => o.label),
    paymentLinkUrl: stripeUrl, publicUrl, emailSent, emailError,
  })
}
