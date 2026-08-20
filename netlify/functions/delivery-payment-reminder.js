import { admin } from './_shared/supabaseAdmin.js'
import { sendCustomerEmail } from './_shared/email.js'
import { orgGoogleAccessToken, buildRaw, gmailSend } from './_shared/google.js'

const money = (n) => `$${Number(n || 0).toFixed(2)}`

// The Pacific calendar date a timestamptz falls on, as YYYY-MM-DD --
// avoids DST offset math entirely by letting Intl do the timezone
// conversion, then just comparing date strings.
function pacificDateStr(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

// Scheduled daily: the morning before a job's scheduled delivery, checks
// whether its balance invoice is actually paid yet -- "get paid before or
// at delivery" only works if someone's chasing it the day before, not
// finding out at the tailgate. Fetches a generous 3-day window from the DB
// (cheap, small table) and does the exact "is this tomorrow, Pacific"
// check in JS rather than fighting DST in a SQL date range.
export const handler = async () => {
  const now = new Date()
  const tomorrowStr = pacificDateStr(new Date(now.getTime() + 24 * 3600 * 1000))
  const windowEnd = new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString()

  const { data: candidates, error } = await admin
    .from('opportunities')
    .select('id, org_id, title, value, deposit_amount, scheduled_at, contact_id, contacts(full_name, email)')
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', windowEnd)
    .neq('status', 'cancelled')
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) }

  const dueTomorrow = (candidates || []).filter((o) => pacificDateStr(new Date(o.scheduled_at)) === tomorrowStr)

  let reminded = 0
  let skipped = 0
  const orgNameCache = new Map()

  for (const opp of dueTomorrow) {
    // The balance invoice (not the deposit) is what has to clear before
    // delivery -- a job with no balance invoice yet counts as unpaid too.
    const { data: invoices } = await admin
      .from('invoices')
      .select('id, invoice_number, status, amount_due, kind')
      .eq('opportunity_id', opp.id)
      .neq('kind', 'deposit')
      .order('created_at', { ascending: false })
      .limit(1)
    const balanceInvoice = invoices?.[0]
    if (balanceInvoice?.status === 'paid') { skipped++; continue }

    const amountDue = balanceInvoice ? Number(balanceInvoice.amount_due) : (Number(opp.value) || 0) - (Number(opp.deposit_amount) || 0)
    if (amountDue <= 0) { skipped++; continue }

    if (!orgNameCache.has(opp.org_id)) {
      const { data: org } = await admin.from('organizations').select('name').eq('id', opp.org_id).maybeSingle()
      orgNameCache.set(opp.org_id, org?.name || 'Dispatch')
    }
    const orgName = orgNameCache.get(opp.org_id)
    const whenLabel = new Date(opp.scheduled_at).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short',
    })

    // Customer nudge, if there's an email on file.
    if (opp.contacts?.email) {
      try {
        await sendCustomerEmail({
          orgId: opp.org_id,
          to: opp.contacts.email,
          subject: `Balance due before tomorrow's delivery — ${money(amountDue)}`,
          body:
            `Hi ${opp.contacts.full_name?.split(/\s+/)[0] || 'there'},\n\n` +
            `Your vehicle is scheduled for delivery on ${whenLabel} Pacific. The remaining balance of ${money(amountDue)} needs to be paid before the vehicle comes off the truck.\n\n` +
            `${balanceInvoice ? `Invoice: ${balanceInvoice.invoice_number}\n\n` : ''}` +
            `Please take care of this today so delivery isn't held up tomorrow.\n\n` +
            `Thank you,\n${orgName}`,
          contactId: opp.contact_id,
        })
      } catch { /* one contact's email hiccup shouldn't block the internal alert below */ }
    }

    // Internal alert to the org's own inbox, regardless of whether the
    // customer has an email on file -- this is the one that actually
    // stops the driver from releasing an unpaid vehicle.
    try {
      const { accessToken, email: orgEmail } = await orgGoogleAccessToken(opp.org_id, admin)
      await gmailSend(accessToken, buildRaw({
        from: orgEmail,
        to: orgEmail,
        subject: `Unpaid balance — delivery tomorrow: ${opp.contacts?.full_name || opp.title || 'Job'}`,
        body:
          `Delivery scheduled for ${whenLabel} Pacific and the balance isn't paid yet.\n\n` +
          `Customer: ${opp.contacts?.full_name || '—'}\n` +
          `Job: ${opp.title || '—'}\n` +
          `Balance due: ${money(amountDue)}\n` +
          `${balanceInvoice ? `Invoice: ${balanceInvoice.invoice_number} (${balanceInvoice.status})` : 'No balance invoice created yet.'}`,
      }))
    } catch { /* no Gmail connected for this org -- customer nudge above still went out */ }

    reminded++
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, checkedTomorrow: dueTomorrow.length, reminded, skipped }) }
}
