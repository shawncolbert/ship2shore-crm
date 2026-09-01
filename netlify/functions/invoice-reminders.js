import { admin } from './_shared/supabaseAdmin.js'
import { sendCustomerEmail } from './_shared/email.js'
import { resolveInvoicePaymentOptions, buildInvoicePaymentOptionsHtml } from './_shared/invoicePaymentOptions.js'

const money = (n) => `$${Number(n || 0).toFixed(2)}`

function siteOrigin() {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || null
}

function reminderEmailHtml({ invoice, orgName, publicUrl, paymentOptions }) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <p>This is a reminder that invoice <strong>${invoice.invoice_number}</strong> from ${orgName} is still unpaid.</p>
      <p>Amount due: <strong>${money(invoice.amount_due)}</strong>${invoice.due_date ? ` — was due ${invoice.due_date}` : ''}</p>
      ${buildInvoicePaymentOptionsHtml(paymentOptions, invoice.amount_due)}
      ${publicUrl ? `<p style="margin:20px 0 4px;font-size:13px;color:#666;">View the full invoice any time: <a href="${publicUrl}">${publicUrl}</a></p>` : ''}
    </div>
  `
}

// Scheduled daily: reminders are strictly opt-in (invoices.reminder_enabled,
// off by default -- see InvoiceDetail.jsx's "Payment reminders" section) and
// only ever fire while an invoice is still unpaid. Runs across every org --
// each invoice already carries its own org_id -- rather than one hardcoded
// tenant. Idempotent via last_reminder_sent_at, so re-running (or Netlify
// retrying a slow invocation) never double-sends the same reminder.
export const handler = async () => {
  const { data: due, error } = await admin
    .from('invoices')
    .select('*, contacts(email)')
    .eq('reminder_enabled', true)
    .neq('status', 'paid')
    .not('sent_at', 'is', null)
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) }

  let sent = 0
  let skipped = 0
  const orgNameCache = new Map()
  const paymentSettingsCache = new Map()
  const origin = siteOrigin()

  for (const invoice of due || []) {
    const intervalDays = invoice.reminder_interval_days || 7
    const base = invoice.last_reminder_sent_at || invoice.sent_at
    const daysSince = (Date.now() - new Date(base).getTime()) / 86400000
    if (daysSince < intervalDays) { skipped++; continue }

    const to = invoice.bill_to_email || invoice.contacts?.email
    if (!to) { skipped++; continue }

    if (!orgNameCache.has(invoice.org_id)) {
      const { data: org } = await admin.from('organizations').select('name').eq('id', invoice.org_id).maybeSingle()
      orgNameCache.set(invoice.org_id, org?.name || 'Dispatch')
    }
    if (!paymentSettingsCache.has(invoice.org_id)) {
      const { data: ps } = await admin.from('payment_settings').select('*').eq('org_id', invoice.org_id).maybeSingle()
      paymentSettingsCache.set(invoice.org_id, ps)
    }
    const orgName = orgNameCache.get(invoice.org_id)
    const paymentOptions = resolveInvoicePaymentOptions({
      invoice, paymentSettings: paymentSettingsCache.get(invoice.org_id),
    })
    const publicUrl = origin ? `${origin}/invoice/${invoice.id}` : null

    try {
      await sendCustomerEmail({
        orgId: invoice.org_id,
        to,
        subject: `Reminder: Invoice ${invoice.invoice_number} — ${money(invoice.amount_due)} due`,
        body: `Reminder: invoice ${invoice.invoice_number} from ${orgName} is still unpaid. Amount due: ${money(invoice.amount_due)}.${publicUrl ? ` View it here: ${publicUrl}` : ''}`,
        html: reminderEmailHtml({ invoice, orgName, publicUrl, paymentOptions }),
        contactId: invoice.contact_id,
      })
      await admin.from('invoices').update({ last_reminder_sent_at: new Date().toISOString() }).eq('id', invoice.id)
      sent++
    } catch {
      skipped++ // a Gmail hiccup for one invoice shouldn't block the rest of the batch
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, checked: due?.length || 0, sent, skipped }) }
}
