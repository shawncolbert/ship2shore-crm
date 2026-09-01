import { admin } from './supabaseAdmin.js'
import { sendCustomerEmail } from './email.js'
import { resolveInvoicePaymentOptions, buildInvoicePaymentOptionsHtml } from './invoicePaymentOptions.js'

function siteOrigin(event) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`
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

// Marks an invoice as sent and emails the customer from the org's own
// connected Gmail account with whichever payment options were checked.
// Shared by the dispatcher-triggered "Send invoice" button (invoice-send.js)
// and the customer-triggered contract-signing flow (contract-sign.js), so a
// deposit invoice created automatically when a contract is signed goes out
// exactly the same way a manually sent one does -- one implementation, not
// two that can drift apart.
export async function sendInvoiceCore({ invoice, orgId, event }) {
  if (!invoice.bill_to_email) return { ok: false, error: 'Bill To email is required to send an invoice.' }

  const publicUrl = `${siteOrigin(event)}/invoice/${invoice.id}`
  const { data: paymentSettings } = await admin
    .from('payment_settings').select('*').eq('org_id', orgId).maybeSingle()

  const { error: updErr } = await admin.from('invoices').update({
    status: invoice.status === 'paid' ? 'paid' : 'sent',
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', invoice.id)
  if (updErr) return { ok: false, error: updErr.message }

  const paymentOptions = resolveInvoicePaymentOptions({ invoice, paymentSettings })

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
    paymentOptionsSent: paymentOptions.map((o) => o.label),
    publicUrl, emailSent, emailError,
  }
}
