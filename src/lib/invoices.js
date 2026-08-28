import { supabase, fetchMyOrgId } from './supabase'
import { uploadCardAsset } from './businessCard'

/* ------------------------------------------------------------------ */
/* Business info shown on every invoice header                         */
/* ------------------------------------------------------------------ */

export async function fetchInvoiceBusinessInfo() {
  const { data, error } = await supabase
    .from('organizations')
    .select('name, logo_url, tagline, invoice_business_name, invoice_business_address, invoice_business_phone, invoice_business_website, invoice_business_ein')
    .single()
  if (error) throw error
  return data
}

export async function saveInvoiceBusinessInfo(patch) {
  const orgId = await fetchMyOrgId()
  const update = {
    invoice_business_name: patch.invoice_business_name?.trim() || null,
    invoice_business_address: patch.invoice_business_address?.trim() || null,
    invoice_business_phone: patch.invoice_business_phone?.trim() || null,
    invoice_business_website: patch.invoice_business_website?.trim() || null,
    invoice_business_ein: patch.invoice_business_ein?.trim() || null,
  }
  // logo_url and tagline live on organizations already (used by the app's
  // own sidebar branding and the "Enter CRM" front door) -- only touched
  // here if the caller explicitly passed them, so this function stays safe
  // to call from contexts that don't manage those.
  if ('logo_url' in patch) update.logo_url = patch.logo_url || null
  if ('tagline' in patch) update.tagline = patch.tagline?.trim() || null
  const { error } = await supabase.from('organizations').update(update).eq('id', orgId)
  if (error) throw error
}

// Uploads to the same card-assets bucket the digital business cards use --
// 'invoice-logo' is just a storage-path namespace here, not a real card id.
export async function uploadInvoiceLogo(file) {
  const orgId = await fetchMyOrgId()
  return uploadCardAsset(orgId, 'invoice-logo', file)
}

/* ------------------------------------------------------------------ */
/* Totals                                                              */
/* ------------------------------------------------------------------ */

// No partial payments in this pass -- amount_due is either the full total
// (draft/sent/overdue) or 0 (paid).
export function computeTotals(lineItems) {
  const subtotal = lineItems.reduce((sum, li) => sum + (Number(li.quantity) || 0) * (Number(li.unit_price) || 0), 0)
  return { subtotal, total: subtotal }
}

/* ------------------------------------------------------------------ */
/* List / read                                                         */
/* ------------------------------------------------------------------ */

export async function fetchInvoices() {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, invoice_date, due_date, total, amount_due, paid_at, payment_method, contacts(full_name, company)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchInvoice(id) {
  const [{ data: invoice, error: invErr }, { data: lineItems, error: liErr }] = await Promise.all([
    supabase.from('invoices').select('*, contacts(id, full_name, company, phone, email)').eq('id', id).single(),
    supabase.from('invoice_line_items').select('*').eq('invoice_id', id).order('sort_order', { ascending: true }),
  ])
  if (invErr) throw invErr
  if (liErr) throw liErr
  return { invoice, lineItems: lineItems || [] }
}

/* ------------------------------------------------------------------ */
/* Create / update                                                     */
/* ------------------------------------------------------------------ */

// lineItems: [{ service_id, description, quantity, unit_price }]
export async function createInvoice({ fields, lineItems }) {
  const orgId = await fetchMyOrgId()
  const { data: { user } } = await supabase.auth.getUser()
  const { subtotal, total } = computeTotals(lineItems)

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      org_id: orgId,
      created_by: user?.id || null,
      contact_id: fields.contact_id || null,
      po_number: fields.po_number?.trim() || null,
      bill_to_name: fields.bill_to_name?.trim() || null,
      bill_to_address: fields.bill_to_address?.trim() || null,
      bill_to_phone: fields.bill_to_phone?.trim() || null,
      bill_to_email: fields.bill_to_email?.trim() || null,
      ship_to_name: fields.ship_to_name?.trim() || null,
      ship_to_address: fields.ship_to_address?.trim() || null,
      ship_to_phone: fields.ship_to_phone?.trim() || null,
      ship_from_name: fields.ship_from_name?.trim() || null,
      ship_from_address: fields.ship_from_address?.trim() || null,
      ship_from_phone: fields.ship_from_phone?.trim() || null,
      invoice_date: fields.invoice_date || new Date().toISOString().slice(0, 10),
      due_date: fields.due_date || null,
      notes: fields.notes?.trim() || null,
      subtotal, total, amount_due: total,
      status: 'draft',
      wave_checkout_url: fields.wave_checkout_url?.trim() || null,
      wave_checkout_link_id: fields.wave_checkout_link_id || null,
      // Zelle used to be forced on here regardless of what the caller passed
      // -- Shawn 2026-08-28: it's a normal checkbox now, same as every other
      // method, not a policy the invoice enforces on its own.
      payment_options: fields.payment_options || { stripe: true },
      opportunity_id: fields.opportunity_id || null,
      kind: fields.kind === 'deposit' ? 'deposit' : 'invoice',
      reminder_enabled: !!fields.reminder_enabled,
      reminder_interval_days: fields.reminder_enabled ? Number(fields.reminder_interval_days) || 7 : null,
    })
    .select('*')
    .single()
  if (invErr) throw invErr

  await replaceLineItems(orgId, invoice.id, lineItems)
  return fetchInvoice(invoice.id)
}

export async function updateInvoice(id, { fields, lineItems }) {
  const orgId = await fetchMyOrgId()
  const { subtotal, total } = computeTotals(lineItems)

  const { error: invErr } = await supabase
    .from('invoices')
    .update({
      contact_id: fields.contact_id || null,
      po_number: fields.po_number?.trim() || null,
      bill_to_name: fields.bill_to_name?.trim() || null,
      bill_to_address: fields.bill_to_address?.trim() || null,
      bill_to_phone: fields.bill_to_phone?.trim() || null,
      bill_to_email: fields.bill_to_email?.trim() || null,
      ship_to_name: fields.ship_to_name?.trim() || null,
      ship_to_address: fields.ship_to_address?.trim() || null,
      ship_to_phone: fields.ship_to_phone?.trim() || null,
      ship_from_name: fields.ship_from_name?.trim() || null,
      ship_from_address: fields.ship_from_address?.trim() || null,
      ship_from_phone: fields.ship_from_phone?.trim() || null,
      invoice_date: fields.invoice_date || new Date().toISOString().slice(0, 10),
      due_date: fields.due_date || null,
      notes: fields.notes?.trim() || null,
      subtotal, total,
      // A paid invoice's amount_due stays 0 even if line items are edited
      // afterward -- editing history, not reopening a closed invoice.
      amount_due: fields.status === 'paid' ? 0 : total,
      wave_checkout_url: fields.wave_checkout_url?.trim() || null,
      wave_checkout_link_id: fields.wave_checkout_link_id || null,
      // See createInvoice -- Zelle is a normal toggleable option now, not forced.
      payment_options: fields.payment_options || { stripe: true },
      reminder_enabled: !!fields.reminder_enabled,
      reminder_interval_days: fields.reminder_enabled ? Number(fields.reminder_interval_days) || 7 : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (invErr) throw invErr

  await replaceLineItems(orgId, id, lineItems)
  return fetchInvoice(id)
}

async function replaceLineItems(orgId, invoiceId, lineItems) {
  const { error: delErr } = await supabase.from('invoice_line_items').delete().eq('invoice_id', invoiceId)
  if (delErr) throw delErr
  const rows = lineItems
    .filter((li) => li.description?.trim())
    .map((li, i) => ({
      org_id: orgId,
      invoice_id: invoiceId,
      service_id: li.service_id || null,
      description: li.description.trim(),
      quantity: Number(li.quantity) || 0,
      unit_price: Number(li.unit_price) || 0,
      line_total: (Number(li.quantity) || 0) * (Number(li.unit_price) || 0),
      sort_order: i,
    }))
  if (rows.length === 0) return
  const { error: insErr } = await supabase.from('invoice_line_items').insert(rows)
  if (insErr) throw insErr
}

export async function deleteInvoice(id) {
  const { error } = await supabase.from('invoices').delete().eq('id', id)
  if (error) throw error
}

// A job can be done (vehicle picked up / service performed) before the
// invoice is paid, so this is its own marker, separate from payment status.
// Also drops a line into the customer's own Timeline (the `activities` feed
// already rendered on ContactDetail.jsx) -- the same ledger that already
// tracks delivery orders and other paperwork for that contact.
export async function markInvoiceComplete(id) {
  const orgId = await fetchMyOrgId()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: invoice, error: fetchErr } = await supabase
    .from('invoices')
    .select('id, invoice_number, contact_id, opportunity_id')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr

  const { error } = await supabase
    .from('invoices')
    .update({ completed_at: new Date().toISOString(), completed_by: user?.id || null })
    .eq('id', id)
  if (error) throw error

  if (invoice.contact_id) {
    const { error: actErr } = await supabase.from('activities').insert({
      org_id: orgId,
      contact_id: invoice.contact_id,
      opportunity_id: invoice.opportunity_id || null,
      actor_id: user?.id || null,
      type: 'status_change',
      body: `Job completed — Invoice ${invoice.invoice_number} marked done.`,
    })
    if (actErr) throw actErr
  }

  return fetchInvoice(id)
}

export async function unmarkInvoiceComplete(id) {
  const { error } = await supabase.from('invoices').update({ completed_at: null, completed_by: null }).eq('id', id)
  if (error) throw error
}

// Direct status flip for the Completed Jobs grid's inline dropdown -- draft/
// sent/overdue only. Marking Paid goes through markInvoicePaidManually
// instead, since that also asks how it was paid and stamps paid_at.
export async function setInvoiceStatus(id, status) {
  const { error } = await supabase
    .from('invoices')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Completed Jobs -- spreadsheet-style report                          */
/* ------------------------------------------------------------------ */

export async function fetchCompletedJobs() {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total, amount_due, paid_at, payment_method, completed_at, invoice_date, contacts(full_name, company, phone, email)')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Not every payment arrives through Stripe (cash, check, Venmo in person,
// or a Stripe payment link hasn't been connected yet) -- this lets a
// dispatcher record that manually rather than the invoice being stuck
// showing a balance forever. Automatic Stripe payments go through the
// webhook instead, which sets the same fields.
//
// Moving the linked job to the Paid stage and emailing the customer a
// receipt both happen server-side now (trg_notify_invoice_paid ->
// invoice-paid-webhook), triggered by the status flip itself -- so they
// fire the same way no matter how an invoice ends up paid, not just this
// one manual path.
export async function markInvoicePaidManually(id, { paymentMethod }) {
  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'paid',
      amount_due: 0,
      paid_at: new Date().toISOString(),
      payment_method: paymentMethod?.trim() || 'Manual',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Zelle payment auto-matching review queue                            */
/* ------------------------------------------------------------------ */
// gmail-sync (every 15 min) detects "Zelle payment received" emails in the
// org's connected Gmail and tries to match them to an open invoice by
// amount + sender name -- an unambiguous match gets marked paid straight
// away there. Anything it couldn't safely resolve on its own lands here as
// 'pending' for a one-click confirm instead of guessing which job got paid.

export async function fetchZellePaymentFlags() {
  const { data, error } = await supabase
    .from('zelle_payments')
    .select('id, amount, sender_name, memo, invoice_id, opportunity_id, received_at, created_at, invoices(invoice_number, kind, bill_to_name, status)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Applies the same "mark paid" effect gmail-sync's auto-match path uses --
// invoice paid, and the linked job's Deposit/Final badge flipped -- then
// records the confirm on the zelle_payments row itself.
export async function confirmZellePaymentMatch(zelleId, invoiceId) {
  const { data: inv, error: invErr } = await supabase
    .from('invoices').select('id, kind, opportunity_id').eq('id', invoiceId).single()
  if (invErr) throw invErr

  const { error: updErr } = await supabase.from('invoices').update({
    status: 'paid', amount_due: 0, paid_at: new Date().toISOString(),
    payment_method: 'Zelle', updated_at: new Date().toISOString(),
  }).eq('id', invoiceId)
  if (updErr) throw updErr

  if (inv.opportunity_id) {
    const field = inv.kind === 'deposit' ? 'deposit_paid' : 'paid'
    await supabase.from('opportunities').update({ [field]: true }).eq('id', inv.opportunity_id)
  }

  const { error: zErr } = await supabase.from('zelle_payments').update({
    status: 'matched', auto_matched: false, invoice_id: invoiceId,
    opportunity_id: inv.opportunity_id || null, resolved_at: new Date().toISOString(),
  }).eq('id', zelleId)
  if (zErr) throw zErr
}

export async function dismissZellePaymentMatch(zelleId) {
  const { error } = await supabase
    .from('zelle_payments')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
    .eq('id', zelleId)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Send (status + Stripe payment link + email, via Netlify function)   */
/* ------------------------------------------------------------------ */

export async function sendInvoice(id) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/invoice-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ invoiceId: id }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not send that invoice.')
  return data
}

/* ------------------------------------------------------------------ */
/* Contact lookup for Bill To autofill                                 */
/* ------------------------------------------------------------------ */

// fetchServices() in lib/supabase.js deliberately omits `id` (nothing else
// needs it) -- line items need the real service id for their FK, so this
// gets its own query rather than widening that shared one.
export async function fetchServicesForInvoice() {
  const { data, error } = await supabase
    .from('services')
    .select('id, code, name, default_rate')
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

// Prefills a new invoice started from a pipeline card's Invoice button --
// mirrors fillBillToFromContact's shape (company/full_name/address/phone/
// email) plus the job's own title/value/billing number for the first line
// item, so the dispatcher isn't retyping what's already on the card.
export async function fetchOpportunityForInvoice(opportunityId) {
  const { data, error } = await supabase
    .from('opportunities')
    .select(`
      id, title, value, deposit_amount, escort_fee, billing_number, booking_number, contact_id,
      pickup_address, dropoff_address, vehicle, vehicle_year, vehicle_make, vehicle_model, vehicle_vin,
      contacts!contact_id(id, full_name, company, phone, email, custom_fields)
    `)
    .eq('id', opportunityId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchContactsForInvoice() {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, company, phone, email, custom_fields')
    .order('full_name', { ascending: true })
  if (error) throw error
  return data || []
}
