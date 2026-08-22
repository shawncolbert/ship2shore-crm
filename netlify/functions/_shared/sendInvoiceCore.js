import { admin } from './supabaseAdmin.js'
import { sendCustomerEmail } from './email.js'
import { resolveInvoicePaymentOptions, buildInvoicePaymentOptionsHtml } from './invoicePaymentOptions.js'

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
// is configured and enabled for this invoice, and emails the customer from
// the org's own connected Gmail account with whichever payment options were
// checked. Shared by the dispatcher-triggered "Send invoice" button
// (invoice-send.js) and the customer-triggered contract-signing flow
// (contract-sign.js), so a deposit invoice created automatically when a
// contract is signed goes out exactly the same way a manually sent one does
// -- one implementation, not two that can drift apart.
export async function sendInvoiceCore({ invoice, orgId, event }) {
  if (!invoice.bill_to_email) return { ok: false, error: 'Bill To email is required to send an invoice.' }

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
    } catch {
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
  if (updErr) return { ok: false, error: updErr.message }

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

  return {
    ok: true, status: 'sent',
    stripeConfigured: stripeWanted && stripeConfigured && Boolean(stripeUrl),
    paymentOptionsSent: paymentOptions.map((o) => o.label),
    paymentLinkUrl: stripeUrl, publicUrl, emailSent, emailError,
  }
}
